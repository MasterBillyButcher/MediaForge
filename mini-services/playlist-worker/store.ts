import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  executeTask, hydrateEntries, deleteFileQuiet,
  type MediaFormat, type QualityHeight, type AudioBitrate, type PlaylistEntry, type JobExtras,
} from './engine';

/**
 * Playlist job store.
 *
 * - Jobs + per-video tasks with real states and progress.
 * - Global FIFO task pump with bounded concurrency (max 2 media downloads)
 *   so any number of videos can be queued without blocking the service.
 * - State persisted to disk (debounced) and reloaded on restart.
 * - TTL sweeper deletes old jobs and their files.
 */

// Persistent data root: PLAYLIST_STORAGE_ROOT (explicit) > MEDIA_DATA_DIR/playlist
// (single-volume deployments) > ./storage next to this file (local dev).
export const STORAGE_ROOT = process.env.PLAYLIST_STORAGE_ROOT
  ?? (process.env.MEDIA_DATA_DIR
    ? path.join(process.env.MEDIA_DATA_DIR, 'playlist')
    : path.join(import.meta.dir, 'storage'));
export const JOBS_DIR = path.join(STORAGE_ROOT, 'jobs');
export const TMP_DIR = path.join(STORAGE_ROOT, 'tmp');
export const JOB_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_ENTRIES_PER_JOB = 2000;
const GLOBAL_CONCURRENCY = 2;

export type TaskState = 'pending' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type JobState = 'active' | 'completed' | 'cancelled' | 'failed' | 'interrupted';

export interface VideoTask {
  i: number;
  url: string;
  title: string;
  state: TaskState;
  progress: number;
  phase: 'downloading' | 'processing' | null;
  speed: string | null;
  eta: number | null;
  error: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  ext: string | null;
}

export interface PlaylistJob {
  id: string;
  title: string;
  sourceUrl: string | null;
  format: MediaFormat;
  quality: QualityHeight;
  bitrate: AudioBitrate;
  extras: JobExtras | null;
  state: JobState;
  createdAt: number;
  finishedAt: number | null;
  hasCookies: boolean;
  error: string | null;
  videos: VideoTask[];
  dir: string;
}

interface PersistedJob {
  id: string;
  title: string;
  sourceUrl: string | null;
  format: MediaFormat;
  quality: QualityHeight;
  bitrate: AudioBitrate;
  extras: JobExtras | null;
  state: JobState;
  createdAt: number;
  finishedAt: number | null;
  hasCookies: boolean;
  error: string | null;
  videos: Array<Pick<VideoTask, 'i' | 'url' | 'title' | 'state' | 'error' | 'fileName' | 'sizeBytes' | 'ext'>>;
}

const g = globalThis as typeof globalThis & {
  __pwJobs?: Map<string, PlaylistJob>;
  __pwQueue?: string[]; // "jobId:index"
  __pwActive?: number;
  __pwDirty?: Set<string>;
  __pwKills?: Map<string, Map<number, () => void>>; // jobId -> taskIndex -> kill
  __pwFlushTimer?: NodeJS.Timeout;
  __pwSweepTimer?: NodeJS.Timeout;
  __pwPumpRunning?: boolean;
  __pwJobCookies?: Map<string, string>;
};

const jobs: Map<string, PlaylistJob> = g.__pwJobs ?? (g.__pwJobs = new Map());
const queue: string[] = g.__pwQueue ?? (g.__pwQueue = []);
let active = g.__pwActive ?? (g.__pwActive = 0);
const dirty = g.__pwDirty ?? (g.__pwDirty = new Set());
const kills = g.__pwKills ?? (g.__pwKills = new Map());

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function jobFile(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

function toPersisted(job: PlaylistJob): PersistedJob {
  return {
    id: job.id, title: job.title, sourceUrl: job.sourceUrl, format: job.format,
    quality: job.quality, bitrate: job.bitrate, extras: job.extras, state: job.state,
    createdAt: job.createdAt, finishedAt: job.finishedAt, hasCookies: job.hasCookies,
    error: job.error,
    videos: job.videos.map((v) => ({
      i: v.i, url: v.url, title: v.title, state: v.state, error: v.error,
      fileName: v.fileName, sizeBytes: v.sizeBytes, ext: v.ext,
    })),
  };
}

async function flushJob(job: PlaylistJob): Promise<void> {
  try {
    await fs.mkdir(JOBS_DIR, { recursive: true });
    await fs.writeFile(jobFile(job.id), JSON.stringify(toPersisted(job)), 'utf8');
  } catch { /* best effort */ }
}

function markDirty(job: PlaylistJob): void {
  dirty.add(job.id);
}

function startFlushTimer(): void {
  if (g.__pwFlushTimer) return;
  g.__pwFlushTimer = setInterval(async () => {
    if (dirty.size === 0) return;
    const ids = [...dirty];
    dirty.clear();
    for (const id of ids) {
      const job = jobs.get(id);
      if (job) await flushJob(job);
    }
  }, 1500);
  g.__pwFlushTimer.unref?.();
}

async function bootRestore(): Promise<void> {
  try {
    await fs.mkdir(JOBS_DIR, { recursive: true });
    const files = (await fs.readdir(JOBS_DIR)).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const raw = await fs.readFile(path.join(JOBS_DIR, f), 'utf8');
        const p = JSON.parse(raw) as PersistedJob;
        const job: PlaylistJob = {
          ...p,
          extras: p.extras ?? null,
          dir: path.join(JOBS_DIR, p.id),
          videos: p.videos.map((v) => ({
            ...v,
            progress: v.state === 'completed' ? 100 : 0,
            phase: null,
            speed: null,
            eta: null,
            state: v.state === 'downloading' || v.state === 'processing' || v.state === 'pending'
              ? 'failed'
              : v.state,
            error: v.state === 'downloading' || v.state === 'processing' || v.state === 'pending'
              ? 'Interrupted by a service restart — retry the job.'
              : v.error,
          })),
        };
        if (job.state === 'active') job.state = 'interrupted';
        jobs.set(job.id, job);
      } catch { /* skip corrupted */ }
    }
  } catch { /* storage not ready */ }
}

// ---------------------------------------------------------------------------
// Sweeper
// ---------------------------------------------------------------------------

async function sweep(): Promise<void> {
  const now = Date.now();
  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
    for (const f of await fs.readdir(TMP_DIR)) {
      const full = path.join(TMP_DIR, f);
      const st = await fs.stat(full).catch(() => null);
      if (st && now - st.mtimeMs > 60 * 60 * 1000) await fs.unlink(full).catch(() => undefined);
    }
  } catch { /* ignore */ }
  for (const job of [...jobs.values()]) {
    const finished = job.finishedAt ?? (job.state === 'active' ? 0 : now);
    if (job.state !== 'active' && now - finished > JOB_TTL_MS) {
      await deleteJob(job.id);
    }
  }
}

function startSweeper(): void {
  if (g.__pwSweepTimer) return;
  g.__pwSweepTimer = setInterval(() => void sweep(), 10 * 60 * 1000);
  g.__pwSweepTimer.unref?.();
  setTimeout(() => void sweep(), 20_000).unref?.();
}

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

// per-job cookie file paths (kept only while the job is active)
const jobCookies: Map<string, string> = g.__pwJobCookies ?? (g.__pwJobCookies = new Map());

export interface CreateJobInput {
  title: string;
  sourceUrl: string | null;
  format: MediaFormat;
  quality: QualityHeight;
  bitrate: AudioBitrate;
  extras?: JobExtras | null;
  cookiesPath: string | null;
  entries: Array<Pick<PlaylistEntry, 'url' | 'title'>>;
}

export class JobInputError extends Error {}

export async function createJob(input: CreateJobInput): Promise<PlaylistJob> {
  if (!input.entries || !Array.isArray(input.entries) || input.entries.length === 0) {
    throw new JobInputError('Select at least one video to download.');
  }
  if (input.entries.length > MAX_ENTRIES_PER_JOB) {
    throw new JobInputError(`A job can hold at most ${MAX_ENTRIES_PER_JOB} videos (got ${input.entries.length}).`);
  }
  const id = randomUUID();
  const dir = path.join(JOBS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const job: PlaylistJob = {
    id,
    title: (input.title || 'Playlist').slice(0, 120),
    sourceUrl: input.sourceUrl,
    format: input.format,
    quality: input.quality,
    bitrate: input.bitrate,
    extras: input.extras ?? null,
    state: 'active',
    createdAt: Date.now(),
    finishedAt: null,
    hasCookies: !!input.cookiesPath,
    error: null,
    dir,
    videos: input.entries.map((e, idx) => ({
      i: idx,
      url: e.url,
      title: (e.title ?? `Track ${idx + 1}`).slice(0, 160),
      state: 'pending',
      progress: 0,
      phase: null,
      speed: null,
      eta: null,
      error: null,
      fileName: null,
      sizeBytes: null,
      ext: null,
    })),
  };
  jobs.set(id, job);
  markDirty(job);
  for (const v of job.videos) queue.push(`${id}:${v.i}`);
  pump();
  startFlushTimer();
  startSweeper();
  return job;
}

function pump(): void {
  if (g.__pwPumpRunning) return;
  g.__pwPumpRunning = true;
  void (async () => {
    try {
      for (;;) {
        if (active >= GLOBAL_CONCURRENCY) return;
        const key = queue.shift();
        if (!key) return;
        const [jobId, idxStr] = key.split(':');
        const idx = parseInt(idxStr, 10);
        const job = jobs.get(jobId);
        if (!job) continue;
        const task = job.videos[idx];
        if (!task) continue;
        if (job.state !== 'active' || task.state !== 'pending') continue;
        active++;
        void runTask(job, task).finally(() => {
          active--;
          pump();
        });
      }
    } finally {
      g.__pwPumpRunning = false;
      // re-check in case items arrived while finishing
      if (queue.length > 0 && active < GLOBAL_CONCURRENCY) pump();
    }
  })();
}

async function runTask(job: PlaylistJob, task: VideoTask): Promise<void> {
  task.state = 'downloading';
  task.progress = 0;
  task.error = null;
  markDirty(job);

  let cookiesPath: string | null = null;
  try {
    // cookie files are per-request; job cookies were written at creation
    cookiesPath = jobCookies.get(job.id) ?? null;
    const out = await executeTask({
      jobDir: job.dir,
      index: task.i,
      url: task.url,
      format: job.format,
      height: job.quality,
      bitrate: job.bitrate,
      cookiesPath,
      extras: job.extras ?? undefined,
      jobTitle: job.title,
      hooks: {
        onProgress: (patch) => {
          if (patch.progress !== undefined) task.progress = patch.progress;
          if (patch.phase) task.phase = patch.phase;
          if (patch.speed !== undefined) task.speed = patch.speed;
          if (patch.eta !== undefined) task.eta = patch.eta;
          markDirty(job);
        },
        isCancelled: () => job.state !== 'active',
        registerKill: (k) => {
          const m = kills.get(job.id) ?? new Map<number, () => void>();
          if (k) m.set(task.i, k); else m.delete(task.i);
          kills.set(job.id, m);
        },
      },
    });
    task.state = 'completed';
    task.progress = 100;
    task.phase = null;
    task.speed = null;
    task.eta = null;
    task.fileName = out.fileName;
    task.sizeBytes = out.sizeBytes;
    task.ext = out.ext;
    markDirty(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'CANCELLED' || job.state !== 'active') {
      task.state = 'cancelled';
      task.error = 'Cancelled';
    } else {
      task.state = 'failed';
      task.error = message.slice(0, 300);
    }
    task.progress = 0;
    task.phase = null;
    markDirty(job);
  } finally {
    // when every task reached a terminal state, close the job
    const pending = job.videos.some((v) => v.state === 'pending' || v.state === 'downloading' || v.state === 'processing');
    if (!pending && job.state === 'active') {
      const anyDone = job.videos.some((v) => v.state === 'completed');
      const allCancelled = job.videos.every((v) => v.state === 'cancelled');
      job.state = allCancelled ? 'cancelled' : (anyDone ? 'completed' : 'failed');
      if (job.state === 'failed') job.error = 'Every download failed. See per-video errors for details.';
      job.finishedAt = Date.now();
      markDirty(job);
      void finishJob(job);
    }
  }
}

async function finishJob(job: PlaylistJob): Promise<void> {
  // flush immediately and drop the per-job cookie file
  await flushJob(job);
  const c = jobCookies.get(job.id);
  if (c) {
    jobCookies.delete(job.id);
    await deleteFileQuiet(c);
  }
}

export function getJob(id: string): PlaylistJob | null {
  return jobs.get(id) ?? null;
}

export function listJobs(): PlaylistJob[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export interface JobStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  activeCount: number;
  totalBytes: number;
  percent: number;
}

export function jobStats(job: PlaylistJob): JobStats {
  const total = job.videos.length;
  let completed = 0;
  let failed = 0;
  let pending = 0;
  let activeCount = 0;
  let totalBytes = 0;
  let progressSum = 0;
  for (const v of job.videos) {
    if (v.state === 'completed') { completed++; totalBytes += v.sizeBytes ?? 0; progressSum += 100; }
    else if (v.state === 'failed') { failed++; progressSum += 0; }
    else if (v.state === 'pending') { pending++; }
    else { activeCount++; progressSum += v.progress; }
  }
  return {
    total, completed, failed, pending, activeCount, totalBytes,
    percent: total > 0 ? Math.round(progressSum / total) : 0,
  };
}

export async function cancelJob(id: string): Promise<boolean> {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.state !== 'active') return false;
  job.state = 'cancelled';
  const m = kills.get(job.id);
  if (m) for (const kill of m.values()) { try { kill(); } catch { /* ignore */ } }
  for (const v of job.videos) {
    if (v.state === 'pending') { v.state = 'cancelled'; v.error = 'Cancelled'; }
  }
  job.finishedAt = Date.now();
  markDirty(job);
  void finishJob(job);
  pump();
  return true;
}

export async function deleteJob(id: string): Promise<boolean> {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.state === 'active') await cancelJob(id);
  jobs.delete(id);
  try { await fs.rm(job.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { await fs.unlink(jobFile(id)); } catch { /* ignore */ }
  return true;
}

/** Attach or refresh the cookies file used by a job's tasks (retry with fresh cookies). */
export function setJobCookies(id: string, cookiesPath: string | null): void {
  if (!cookiesPath) return;
  jobCookies.set(id, cookiesPath);
  const job = jobs.get(id);
  if (job) job.hasCookies = true;
}

export async function retryJob(id: string): Promise<PlaylistJob | null> {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.state === 'active') return job;
  let retried = 0;
  for (const v of job.videos) {
    if (v.state === 'failed' || v.state === 'cancelled') {
      v.state = 'pending';
      v.error = null;
      v.progress = 0;
      v.phase = null;
      retried++;
      queue.push(`${job.id}:${v.i}`);
    }
  }
  if (retried === 0) return job;
  job.state = 'active';
  job.error = null;
  job.finishedAt = null;
  markDirty(job);
  pump();
  return job;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let booted = false;
export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  await bootRestore();
  startFlushTimer();
  startSweeper();
}

export function hydrateJobEntries(jobId: string, entries: PlaylistEntry[], cookiesPath: string | null): void {
  // reserved for future progressive hydration; currently hydration happens in /pw/info
  void jobId; void entries; void cookiesPath; void hydrateEntries;
}
