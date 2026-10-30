import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { RESULTS_DIR, absolutePathFor, registerStoredFile, RESULT_TTL_MS, ensureStorageDirs } from '@/lib/storage';
import { runFfmpeg, probeMedia, type RunResult } from '@/lib/media/ffmpeg';
import type { JobSnapshot, JobState, JobResult } from '@/lib/types';

/**
 * In-process media job manager.
 *
 * - FIFO queue with bounded concurrency so long FFmpeg runs never block the
 *   web server or other requests.
 * - Real progress parsed from ffmpeg `-progress` output (no fake percentages).
 * - Cancellation, per-job timeouts, structured failures.
 * - Completed results are probed and registered in the database with a TTL.
 */

const MAX_CONCURRENCY = 2;
const JOB_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_JOBS_IN_MEMORY = 200;

interface JobRuntime {
  id: string;
  type: string;
  label: string;
  state: JobState;
  progress: number;
  speed: string | null;
  etaSeconds: number | null;
  error: string | null;
  result: JobResult | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  // runtime-only
  totalDuration: number; // estimated output duration for progress %
  kill: (() => void) | null;
  filePath: string | null; // where the result will be written
  resultExt: string;
  operation: string;
  sourceUrl: string | null; // when set, completion is written to download history
  onDone?: () => void;
}

type JobGlobal = typeof globalThis & {
  __mediaJobManager__?: JobManagerState;
  __mediaJobWorkMap__?: Map<string, (ctx: { filePath: string; job: JobRuntime }) => Promise<void>>;
};

interface JobManagerState {
  jobs: Map<string, JobRuntime>;
  queue: string[];
  active: number;
}

const g = globalThis as JobGlobal;
const state: JobManagerState =
  g.__mediaJobManager__ ?? (g.__mediaJobManager__ = { jobs: new Map(), queue: [], active: 0 });

function snapshot(job: JobRuntime): JobSnapshot {
  return {
    id: job.id,
    type: job.type,
    state: job.state,
    progress: Math.min(100, Math.max(0, Math.round(job.progress))),
    speed: job.speed,
    etaSeconds: job.etaSeconds,
    label: job.label,
    error: job.error,
    result: job.result,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function pruneOldJobs(): void {
  if (state.jobs.size <= MAX_JOBS_IN_MEMORY) return;
  const entries = [...state.jobs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const removable = entries.filter(([, j]) => j.state === 'completed' || j.state === 'failed' || j.state === 'cancelled');
  for (const [id] of removable.slice(0, state.jobs.size - MAX_JOBS_IN_MEMORY)) {
    state.jobs.delete(id);
  }
}

export function createJob(opts: {
  type: string;
  label: string;
  totalDuration: number;
  resultExt: string;
  operation: string;
  sourceUrl?: string | null;
}): JobRuntime {
  const id = randomUUID();
  const job: JobRuntime = {
    id,
    type: opts.type,
    label: opts.label,
    state: 'queued',
    progress: 0,
    speed: null,
    etaSeconds: null,
    error: null,
    result: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    totalDuration: Math.max(0.001, opts.totalDuration),
    kill: null,
    filePath: path.join(RESULTS_DIR, `${id}.${opts.resultExt}`),
    resultExt: opts.resultExt,
    operation: opts.operation,
    sourceUrl: opts.sourceUrl ?? null,
  };
  state.jobs.set(id, job);
  pruneOldJobs();
  state.queue.push(id);
  pump();
  return job;
}

/** Enqueue the actual ffmpeg work for a job created by `createJob`. */
export function attachWork(jobId: string, work: (ctx: { filePath: string; job: JobRuntime }) => Promise<void>): void {
  const job = state.jobs.get(jobId);
  if (!job) throw new Error('Job not found');
  job.onDone = () => {
    // executed when the job is dequeued
  };
  // Store the work closure on a module-level map keyed by id
  workMap.set(jobId, work);
}

const workMap: Map<string, (ctx: { filePath: string; job: JobRuntime }) => Promise<void>> =
  (g.__mediaJobWorkMap__ as Map<string, (ctx: { filePath: string; job: JobRuntime }) => Promise<void>>) ??
  ((g.__mediaJobWorkMap__ = new Map()) as Map<string, (ctx: { filePath: string; job: JobRuntime }) => Promise<void>>);

async function pump(): Promise<void> {
  while (state.active < MAX_CONCURRENCY) {
    // peek for the first job whose work closure has been attached;
    // only remove it from the queue once we actually execute it
    const nextId = state.queue.find((id) => state.jobs.has(id) && workMap.has(id));
    if (!nextId) return;
    state.queue = state.queue.filter((id) => id !== nextId);
    const job = state.jobs.get(nextId)!;
    const work = workMap.get(nextId)!;
    state.active++;
    // fire and forget; the queue keeps flowing
    void executeJob(job, work).finally(() => {
      state.active--;
      workMap.delete(nextId);
      pump();
    });
  }
}

async function executeJob(job: JobRuntime, work: (ctx: { filePath: string; job: JobRuntime }) => Promise<void>): Promise<void> {
  job.state = 'processing';
  job.startedAt = Date.now();
  try {
    await ensureStorageDirs();
    await work({ filePath: job.filePath!, job });
    if ((job.state as JobState) === 'cancelled') return; // cancelled mid-run

    // probe the produced file and register it
    const stat = await fs.stat(job.filePath!);
    const meta = await probeMedia(job.filePath!, stat.size).catch(() => null);
    const ext = job.resultExt;
    const mimeMap: Record<string, string> = {
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
      gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
      flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus', srt: 'application/x-subrip',
      vtt: 'text/vtt', ass: 'text/x-ssa', png: 'image/png', jpg: 'image/jpeg',
    };
    const originalBase = job.label.replace(/\.[A-Za-z0-9]+$/, '') || 'result';
    const safeBase = originalBase.slice(0, 80) || 'result';
    const record = await registerStoredFile({
      kind: 'result',
      storedName: path.basename(job.filePath!),
      originalName: `${safeBase}.${ext}`,
      sizeBytes: stat.size,
      mime: mimeMap[ext] ?? 'application/octet-stream',
      meta,
      operation: job.operation,
      ttlMs: RESULT_TTL_MS,
    });
    job.result = { fileId: record.id, name: record.originalName, sizeBytes: record.sizeBytes, mime: record.mime };
    job.progress = 100;
    job.state = 'completed';
    if (job.sourceUrl) void recordDownloadHistory(job, 'completed', record.originalName, stat.size, record.mime);
  } catch (err) {
    job.state = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    // clean up partial output
    if (job.filePath) await fs.unlink(job.filePath).catch(() => undefined);
    if (job.sourceUrl) void recordDownloadHistory(job, 'failed', null, null, null);
  } finally {
    job.finishedAt = Date.now();
    job.kill = null;
  }
}

export function getJob(id: string): JobSnapshot | null {
  const job = state.jobs.get(id);
  return job ? snapshot(job) : null;
}

export function cancelJob(id: string): boolean {
  const job = state.jobs.get(id);
  if (!job) return false;
  if (job.state === 'queued') {
    state.queue = state.queue.filter((q) => q !== id);
    job.state = 'cancelled';
    job.finishedAt = Date.now();
    workMap.delete(id);
    return true;
  }
  if (job.state === 'processing') {
    job.state = 'cancelled';
    job.error = 'Cancelled by user';
    job.kill?.();
    return true;
  }
  return false;
}

/**
 * Run an ffmpeg command inside a job with real progress reporting.
 * Throws on failure with the ffmpeg stderr tail.
 */
export async function runFfmpegInJob(
  job: JobRuntime,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<RunResult> {
  const { run, kill } = runFfmpeg(args, {
    timeoutMs: opts.timeoutMs ?? JOB_TIMEOUT_MS,
    onProgress: (seconds, speed) => {
      if (job.state === 'cancelled') return;
      const pct = (seconds / job.totalDuration) * 100;
      job.progress = Math.min(99, Math.max(0, pct));
      job.speed = speed;
      if (speed && Number(speed.replace('x', '')) > 0) {
        const factor = Number(speed.replace('x', ''));
        const remaining = job.totalDuration - seconds;
        job.etaSeconds = Math.max(0, Math.round(remaining / factor));
      }
    },
  });
  job.kill = kill;
  const res = await run;
  if (job.state === 'cancelled') {
    const err = new Error('Cancelled by user');
    throw err;
  }
  if (res.code !== 0) {
    const tail = res.stderrTail.split('\n').filter(Boolean).slice(-4).join(' | ');
    throw new Error(res.timedOut ? 'Processing timed out (15 min limit).' : `FFmpeg failed: ${tail || `exit code ${res.code}`}`);
  }
  return res;
}

/** Fire-and-forget download history row for URL-based jobs. */
async function recordDownloadHistory(
  job: JobRuntime,
  status: 'completed' | 'failed',
  fileName: string | null,
  sizeBytes: number | null,
  mime: string | null
): Promise<void> {
  try {
    await db.downloadRecord.create({
      data: {
        url: job.sourceUrl!.slice(0, 2000),
        platform: job.type === 'hls' ? 'hls' : job.type,
        fileName,
        sizeBytes,
        mime,
        status,
        error: status === 'failed' ? (job.error ?? 'Job failed').slice(0, 500) : null,
      },
    });
  } catch { /* history is best-effort */ }
}

/** Convenience: full pipeline — create job, attach ffmpeg work, enqueue. */
export function enqueueFfmpegJob(opts: {
  type: string;
  label: string;
  totalDuration: number;
  resultExt: string;
  operation: string;
  sourceUrl?: string | null;
  buildArgs: (ctx: { filePath: string }) => string[];
}): JobSnapshot {
  const job = createJob({
    type: opts.type,
    label: opts.label,
    totalDuration: opts.totalDuration,
    resultExt: opts.resultExt,
    operation: opts.operation,
    sourceUrl: opts.sourceUrl ?? null,
  });
  const args = opts.buildArgs({ filePath: job.filePath! });
  attachWork(job.id, async ({ filePath, job: j }) => {
    await runFfmpegInJob(j, args);
  });
  pump();
  return snapshot(job);
}

export async function getJobResultPath(id: string): Promise<string | null> {
  const job = state.jobs.get(id);
  if (!job || job.state !== 'completed' || !job.result) return null;
  const row = await db.mediaFile.findUnique({ where: { id: job.result.fileId } });
  if (!row) return null;
  return absolutePathFor(row);
}
