import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

/**
 * yt-dlp + ffmpeg engine for playlist downloading.
 *
 * - Real progress parsed from yt-dlp --progress-template output (no fake bars).
 * - Format strategy table: every advertised format maps to concrete
 *   yt-dlp format selectors / ffmpeg post-processing steps.
 * - Human-readable error mapping so the UI can honestly explain
 *   bot-protection / auth requirements instead of failing silently.
 */

export const VIDEO_FORMATS = ['mp4', 'webm', 'mkv', 'mov'] as const;
export const AUDIO_FORMATS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'] as const;
export type MediaFormat = (typeof VIDEO_FORMATS)[number] | (typeof AUDIO_FORMATS)[number];

export const QUALITY_HEIGHTS = ['best', '2160', '1440', '1080', '720', '480', '360', '240', '144'] as const;
export type QualityHeight = (typeof QUALITY_HEIGHTS)[number];

export const AUDIO_BITRATES = ['best', '320', '256', '192', '128', '96'] as const;
export type AudioBitrate = (typeof AUDIO_BITRATES)[number];

const FFMPEG = '/usr/bin/ffmpeg';
const FFPROBE = '/usr/bin/ffprobe';
const YTDLP_CANDIDATES = ['/home/z/.venv/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];
let resolvedYtDlp: string | null = null;

export function ytDlpPath(): string {
  return resolvedYtDlp ?? YTDLP_CANDIDATES[0];
}

export async function resolveBinaries(): Promise<{ ytDlp: string | null; ffmpeg: boolean }> {
  for (const candidate of YTDLP_CANDIDATES) {
    try {
      await fs.access(candidate);
      resolvedYtDlp = candidate;
      return { ytDlp: candidate, ffmpeg: true };
    } catch { /* try next */ }
  }
  // fall back to PATH
  resolvedYtDlp = 'yt-dlp';
  return { ytDlp: 'yt-dlp', ffmpeg: true };
}

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export interface PlaylistEntry {
  i: number;
  id: string | null;
  url: string;
  title: string | null;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
}

export interface InfoResult {
  kind: 'playlist' | 'single';
  title: string | null;
  uploader: string | null;
  webpageUrl: string;
  count: number;
  entries: PlaylistEntry[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Low-level process runner
// ---------------------------------------------------------------------------

interface ProcResult {
  code: number | null;
  stdout: string;
  stderrTail: string;
  timedOut: boolean;
}

export interface KillHandle {
  kill: () => void;
  promise: Promise<ProcResult>;
}

function spawnProcess(bin: string, args: string[]): KillHandle {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let settled = false;

  const promise = new Promise<ProcResult>((resolve) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => { stdout += d; if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000); });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => { stderr += d; if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ code: -1, stdout, stderrTail: `${stderr}\n${err.message}`.slice(-4000), timedOut });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderrTail: stderr.slice(-4000), timedOut });
    });
  });

  return {
    kill: () => { timedOut = true; try { child.kill('SIGKILL'); } catch { /* gone */ } },
    promise,
  };
}

async function runUntil(bin: string, args: string[], timeoutMs: number): Promise<ProcResult> {
  const handle = spawnProcess(bin, args);
  const timer = setTimeout(() => handle.kill(), timeoutMs);
  try {
    return await handle.promise;
  } finally {
    clearTimeout(timer);
  }
}

/** Run yt-dlp with a live line callback on both stdout and stderr. */
function runYtdlpLive(
  args: string[],
  onLine: (line: string, stream: 'out' | 'err') => void
): KillHandle {
  const child = spawn(ytDlpPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let timedOut = false;
  let settled = false;

  const promise = new Promise<ProcResult>((resolve) => {
    const pump = (rl: NodeJS.ReadableStream, stream: 'out' | 'err') => {
      rl.on('line', (line: string) => onLine(line.trim(), stream));
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    pump(createInterface({ input: child.stdout }), 'out');
    const errRl = createInterface({ input: child.stderr });
    pump(errRl, 'err');
    errRl.on('line', (line: string) => { stderr += line + '\n'; if (stderr.length > 100_000) stderr = stderr.slice(-50_000); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ code: -1, stdout: '', stderrTail: `${stderr}\n${err.message}`.slice(-4000), timedOut });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout: '', stderrTail: stderr.slice(-4000), timedOut });
    });
  });

  return {
    kill: () => { timedOut = true; try { child.kill('SIGKILL'); } catch { /* gone */ } },
    promise,
  };
}

// ---------------------------------------------------------------------------
// Cookies handling
// ---------------------------------------------------------------------------

/** Validate and persist a Netscape-format cookie file. Returns path or null. */
export async function saveCookiesFile(raw: string, tmpDir: string): Promise<string | null> {
  if (!raw || raw.length > 512 * 1024) return null;
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length === 0) return null;
  const looksValid = lines.every((l) => l.split('\t').length >= 6 || l.includes('\t'));
  if (!looksValid) return null;
  await fs.mkdir(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `cookies-${randomUUID()}.txt`);
  const body = ['# Netscape HTTP Cookie File', '# Generated by MediaForge playlist worker', ...lines].join('\n') + '\n';
  await fs.writeFile(file, body, 'utf8');
  return file;
}

export async function deleteFileQuiet(file: string | null): Promise<void> {
  if (!file) return;
  try { await fs.unlink(file); } catch { /* gone */ }
}

// ---------------------------------------------------------------------------
// URL / entry extraction
// ---------------------------------------------------------------------------

const BASE_ARGS = ['--no-warnings', '--ignore-config', '--no-color', '--socket-timeout', '25', '--retries', '3'];

function thumbnailOf(e: Record<string, unknown>): string | null {
  if (typeof e.thumbnail === 'string' && e.thumbnail) return e.thumbnail;
  const thumbs = e.thumbnails;
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    const last = thumbs[thumbs.length - 1] as Record<string, unknown>;
    if (typeof last?.url === 'string') return last.url;
  }
  return null;
}

function normalizeFlatEntry(e: Record<string, unknown>): PlaylistEntry | null {
  let url = typeof e.url === 'string' && e.url.startsWith('http') ? e.url : null;
  const id = typeof e.id === 'string' ? e.id : null;
  const ieKey = typeof e.ie_key === 'string' ? e.ie_key.toLowerCase() : '';
  if (!url && id) {
    if (ieKey.includes('youtube')) url = `https://www.youtube.com/watch?v=${id}`;
    else if (typeof e.webpage_url === 'string' && e.webpage_url.startsWith('http')) url = e.webpage_url;
  }
  if (!url) return null;
  return {
    i: 0,
    id,
    url,
    title: typeof e.title === 'string' && e.title ? e.title : null,
    duration: typeof e.duration === 'number' && Number.isFinite(e.duration) ? e.duration : null,
    thumbnail: thumbnailOf(e),
    uploader: (typeof e.uploader === 'string' && e.uploader) || (typeof e.channel === 'string' && e.channel) || null,
  };
}

/** Extract playlist or single-video info. Flat = fast (no per-video hits). */
export async function extractInfo(url: string, cookiesPath: string | null, timeoutMs = 120_000): Promise<InfoResult> {
  const args = [...BASE_ARGS, '--flat-playlist', '-J', ...(cookiesPath ? ['--cookies', cookiesPath] : []), '--', url];
  const res = await runUntil(ytDlpPath(), args, timeoutMs);
  if (res.code !== 0 && !res.stdout.trim()) {
    throw new Error(humanizeYtdlpError(res.stderrTail));
  }
  let data: Record<string, unknown>;
  try {
    const start = res.stdout.indexOf('{');
    data = JSON.parse(res.stdout.slice(start));
  } catch {
    throw new Error(humanizeYtdlpError(res.stderrTail || 'Could not parse the source response.'));
  }

  const webpageUrl = (typeof data.webpage_url === 'string' && data.webpage_url) || url;
  const title = typeof data.title === 'string' ? data.title : null;
  const uploader = (typeof data.uploader === 'string' && data.uploader) || (typeof data.channel === 'string' && data.channel) || null;
  const warnings: string[] = [];

  if (data._type === 'playlist') {
    const rawEntries = Array.isArray(data.entries) ? (data.entries as Record<string, unknown>[]) : [];
    const entries: PlaylistEntry[] = [];
    let skipped = 0;
    for (const e of rawEntries) {
      const norm = normalizeFlatEntry(e);
      if (norm) { norm.i = entries.length; entries.push(norm); } else skipped++;
    }
    if (skipped > 0) warnings.push(`${skipped} entr${skipped === 1 ? 'y' : 'ies'} could not be resolved and ${skipped === 1 ? 'was' : 'were'} skipped.`);
    if (entries.length === 0) throw new Error('The playlist exists but contains no downloadable entries.');
    return {
      kind: 'playlist',
      title: title ?? 'Playlist',
      uploader,
      webpageUrl,
      count: typeof data.playlist_count === 'number' ? data.playlist_count : entries.length,
      entries,
      warnings,
    };
  }

  // single media item
  return {
    kind: 'single',
    title: title ?? 'Media',
    uploader,
    webpageUrl,
    count: 1,
    entries: [{
      i: 0,
      id: typeof data.id === 'string' ? data.id : null,
      url: webpageUrl,
      title: title ?? null,
      duration: typeof data.duration === 'number' ? data.duration : null,
      thumbnail: thumbnailOf(data),
      uploader,
    }],
    warnings,
  };
}

/** Fetch metadata for one entry (title/duration/thumbnail). */
async function fetchSingleMeta(url: string, cookiesPath: string | null, timeoutMs = 30_000): Promise<Partial<PlaylistEntry> | null> {
  const args = [...BASE_ARGS, '--skip-download', '-J', ...(cookiesPath ? ['--cookies', cookiesPath] : []), '--', url];
  const res = await runUntil(ytDlpPath(), args, timeoutMs);
  if (res.code !== 0) return null;
  try {
    const start = res.stdout.indexOf('{');
    const data = JSON.parse(res.stdout.slice(start)) as Record<string, unknown>;
    return {
      title: typeof data.title === 'string' ? data.title : null,
      duration: typeof data.duration === 'number' ? data.duration : null,
      thumbnail: thumbnailOf(data),
      uploader: (typeof data.uploader === 'string' && data.uploader) || (typeof data.channel === 'string' && data.channel) || null,
    };
  } catch {
    return null;
  }
}

/**
 * Hydrate missing titles/durations in parallel with a time budget.
 * Entries beyond the cap keep placeholder titles — downloads still work.
 */
export async function hydrateEntries(
  entries: PlaylistEntry[],
  cookiesPath: string | null,
  budgetMs = 45_000,
  cap = 300,
  concurrency = 8
): Promise<void> {
  const need = entries.filter((e) => !e.title || e.duration == null).slice(0, cap);
  if (need.length === 0) return;
  const start = Date.now();
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      if (Date.now() - start > budgetMs) return;
      const idx = cursor++;
      if (idx >= need.length) return;
      const entry = need[idx];
      const meta = await fetchSingleMeta(entry.url, cookiesPath);
      if (meta) {
        entry.title = entry.title ?? meta.title;
        entry.duration = entry.duration ?? meta.duration;
        entry.thumbnail = entry.thumbnail ?? meta.thumbnail ?? null;
        entry.uploader = entry.uploader ?? meta.uploader ?? null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, need.length) }, worker));
}

// ---------------------------------------------------------------------------
// Error humanization
// ---------------------------------------------------------------------------

export function humanizeYtdlpError(stderrTail: string): string {
  const s = stderrTail.toLowerCase();
  if (s.includes('sign in to confirm') || s.includes('bot')) {
    return 'This source is protected by bot detection on cloud IPs. Add your own cookies (Advanced options) to use authorized access, or choose a source that permits direct download.';
  }
  if (s.includes('private video') || s.includes('private track')) return 'That media is private — it can only be accessed by its owner.';
  if (s.includes('members-only') || s.includes('join this channel')) return 'That media is members-only. Authorized (cookie) access with a membership is required.';
  if (s.includes('video unavailable') || s.includes('removed')) return 'That media is unavailable (removed or region-locked).';
  if (s.includes('unsupported url')) return 'That URL is not supported by the extraction engine.';
  if (s.includes('http error 429')) return 'The source is rate-limiting this server. Try again in a few minutes.';
  if (s.includes('http error 403')) return 'The source denied access (HTTP 403). Authorized cookies may be required.';
  if (s.includes('http error 404')) return 'The media was not found (HTTP 404).';
  if (s.includes('age') && s.includes('confirm')) return 'Age-restricted media requires authorized (cookie) access.';
  if (s.includes('not a valid url') || s.includes('unable to extract')) return 'That URL does not point to a recognizable media page.';
  const firstErr = stderrTail.split('\n').map((l) => l.trim()).find((l) => l.startsWith('ERROR:'));
  return firstErr ? firstErr.replace(/^ERROR:\s*/, '').slice(0, 300) : 'The download engine could not process this media.';
}

// ---------------------------------------------------------------------------
// Format strategy
// ---------------------------------------------------------------------------

interface FormatPlan {
  downloadArgs: string[];
  targetExt: string;
  needsMovRemux: boolean;
}

function buildFormatPlan(format: MediaFormat, height: QualityHeight, bitrate: AudioBitrate): FormatPlan {
  const h = height === 'best' ? '' : height;
  const cap = (extra: string) => (h ? `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b` : 'bv*+ba/b');

  if (format === 'mp4') {
    return {
      downloadArgs: ['-f', cap(''), '-S', `res,vcodec:h264,acodec:aac,ext:mp4:m4a`, '--merge-output-format', 'mp4'],
      targetExt: 'mp4',
      needsMovRemux: false,
    };
  }
  if (format === 'webm') {
    return {
      downloadArgs: ['-f', cap(''), '-S', `res,vcodec:vp9,acodec:opus,ext:webm:webm`, '--merge-output-format', 'webm'],
      targetExt: 'webm',
      needsMovRemux: false,
    };
  }
  if (format === 'mkv') {
    return {
      downloadArgs: ['-f', 'bv*+ba/b', '-S', 'res', '--merge-output-format', 'mkv'],
      targetExt: 'mkv',
      needsMovRemux: false,
    };
  }
  if (format === 'mov') {
    // download h264/aac-compatible then remux (or transcode) into MOV
    return {
      downloadArgs: ['-f', cap(''), '-S', `res,vcodec:h264,acodec:aac,ext:mp4:m4a`, '--merge-output-format', 'mp4'],
      targetExt: 'mov',
      needsMovRemux: true,
    };
  }
  // audio formats
  const lossless = format === 'wav' || format === 'flac';
  const q = lossless || bitrate === 'best' ? (format === 'mp3' ? '320K' : '') : `${bitrate}K`;
  const audioArgs = ['-f', 'ba/b', '-x', '--audio-format', format];
  if (q) audioArgs.push('--audio-quality', q);
  return { downloadArgs: audioArgs, targetExt: format, needsMovRemux: false };
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------

async function probeDuration(file: string): Promise<number | null> {
  const res = await runUntil(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], 20_000);
  try {
    const data = JSON.parse(res.stdout) as { format?: { duration?: string } };
    const d = data.format?.duration ? parseFloat(data.format.duration) : NaN;
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

interface FfmpegProgressHooks {
  onProgress: (pct: number) => void;
  registerKill: (k: () => void) => void;
}

/** Dedicated ffmpeg runner with live -progress parsing. */
function ffmpegRunLive(args: string[], hooks: FfmpegProgressHooks, durationSec: number | null, timeoutMs: number): Promise<ProcResult> {
  const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let settled = false;
  const promise = new Promise<ProcResult>((resolve) => {
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      const m = /^out_time_ms=(\d+)$/.exec(line.trim());
      if (m && durationSec && durationSec > 0) {
        const seconds = Number(m[1]) / 1_000_000; // out_time_ms is actually microseconds
        hooks.onProgress(Math.min(99, (seconds / durationSec) * 100));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => { stderr += d; if (stderr.length > 100_000) stderr = stderr.slice(-50_000); });
    child.on('error', (err) => { if (!settled) { settled = true; resolve({ code: -1, stdout: '', stderrTail: `${stderr}\n${err.message}`.slice(-3000), timedOut: false }); } });
    child.on('close', (code) => { if (!settled) { settled = true; resolve({ code, stdout: '', stderrTail: stderr.slice(-3000), timedOut: false }); } });
  });
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
  hooks.registerKill(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
  void promise.finally(() => clearTimeout(timer));
  return promise;
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

export interface TaskHooks {
  onProgress: (patch: { progress?: number; phase?: 'downloading' | 'processing'; speed?: string | null; eta?: number | null }) => void;
  isCancelled: () => boolean;
  registerKill: (k: (() => void) | null) => void;
}

export interface TaskOutput {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  ext: string;
}

const PCT = (s: string | undefined): number => {
  const n = parseFloat((s ?? '0').replace('%', '').trim());
  return Number.isFinite(n) ? n : 0;
};

export async function executeTask(opts: {
  jobDir: string;
  index: number;
  url: string;
  format: MediaFormat;
  height: QualityHeight;
  bitrate: AudioBitrate;
  cookiesPath: string | null;
  hooks: TaskHooks;
  timeoutMs?: number;
}): Promise<TaskOutput> {
  const { jobDir, index, url, format, height, bitrate, cookiesPath, hooks } = opts;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  await fs.mkdir(jobDir, { recursive: true });

  const plan = buildFormatPlan(format, height, bitrate);
  const prefix = `${String(index + 1).padStart(3, '0')} - `;
  const outTpl = path.join(jobDir, `${prefix}%(title).90B.%(ext)s`);

  const args = [
    ...BASE_ARGS,
    '--newline',
    '--no-playlist',
    '--no-mtime',
    '--concurrent-fragments', '4',
    '--ffmpeg-location', '/usr/bin',
    '--paths', jobDir,
    '--progress-template',
    `download:@@P|%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
    '--progress-template',
    `postprocess:@@C|%(progress._percent_str)s`,
    '--print', 'after_move:@@F|%(filepath)s',
    '--no-quiet',
    ...(cookiesPath ? ['--cookies', cookiesPath] : []),
    ...plan.downloadArgs,
    '-o', outTpl,
    '--', url,
  ];

  let filePath: string | null = null;
  let lastProgress = 0;

  const handle = runYtdlpLive(args, (line) => {
    if (hooks.isCancelled()) return;
    if (line.startsWith('@@P|')) {
      const [, pct, downloaded, total, speed, eta] = line.split('|');
      const p = PCT(pct);
      lastProgress = Math.max(lastProgress, p);
      let speedStr: string | null = null;
      if (speed && speed !== 'NA' && speed !== 'None') {
        const bps = parseFloat(speed);
        if (Number.isFinite(bps)) speedStr = bps > 1024 * 1024 ? `${(bps / 1024 / 1024).toFixed(1)} MB/s` : `${Math.round(bps / 1024)} KB/s`;
      }
      const etaNum = eta && eta !== 'NA' && eta !== 'Unknown' ? parseInt(eta, 10) : null;
      hooks.onProgress({ progress: Math.min(99, lastProgress), phase: 'downloading', speed: speedStr, eta: Number.isFinite(etaNum as number) ? etaNum : null });
    } else if (line.startsWith('@@C|')) {
      const pct = PCT(line.split('|')[1]);
      hooks.onProgress({ progress: Math.min(99, Math.max(95, pct)), phase: 'processing' });
    } else if (line.startsWith('@@F|')) {
      const p = line.slice(4).trim();
      if (p && p !== 'NA') filePath = p;
    }
  });

  hooks.registerKill(handle.kill);
  const timer = setTimeout(() => handle.kill(), timeoutMs);
  let res: ProcResult;
  try {
    res = await handle.promise;
  } finally {
    clearTimeout(timer);
    hooks.registerKill(null);
  }

  if (hooks.isCancelled()) throw new Error('CANCELLED');

  if (res.code !== 0 || !filePath) {
    // cleanup partial files for this task
    try {
      const files = await fs.readdir(jobDir);
      for (const f of files) {
        if (f.startsWith(prefix)) await fs.unlink(path.join(jobDir, f)).catch(() => undefined);
      }
    } catch { /* dir may not exist */ }
    throw new Error(humanizeYtdlpError(res.stderrTail));
  }

  const producedExt = path.extname(filePath).slice(1).toLowerCase() || plan.targetExt;
  let finalPath = filePath;
  let finalExt = producedExt;

  if (plan.needsMovRemux && producedExt !== 'mov') {
    const duration = await probeDuration(filePath);
    const movPath = filePath.slice(0, filePath.length - path.extname(filePath).length) + '.mov';
    hooks.onProgress({ phase: 'processing', progress: 95 });
    // try stream-copy remux first, fall back to transcode
    const remux = await ffmpegRunLive(['-y', '-i', filePath, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mov', movPath], { onProgress: () => undefined, registerKill: hooks.registerKill }, duration, 10 * 60 * 1000);
    if (remux.code === 0) {
      finalPath = movPath;
      finalExt = 'mov';
    } else {
      await fs.unlink(movPath).catch(() => undefined);
      const kb = bitrate === 'best' ? 192 : bitrate;
      const trans = await ffmpegRunLive(
        ['-y', '-i', filePath, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${kb}k`, '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', movPath],
        { onProgress: (pct) => hooks.onProgress({ phase: 'processing', progress: Math.min(99, Math.max(0, pct)) }), registerKill: hooks.registerKill },
        duration,
        20 * 60 * 1000
      );
      if (trans.code !== 0) {
        await fs.unlink(movPath).catch(() => undefined);
        const tail = trans.stderrTail.split('\n').filter(Boolean).slice(-3).join(' | ');
        throw new Error(`FFmpeg MOV conversion failed: ${tail}`);
      }
      finalPath = movPath;
      finalExt = 'mov';
    }
    await fs.unlink(filePath).catch(() => undefined);
  }

  const stat = await fs.stat(finalPath);
  hooks.onProgress({ progress: 100 });
  return {
    fileName: path.basename(finalPath),
    filePath: finalPath,
    sizeBytes: stat.size,
    ext: finalExt,
  };
}

export const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus',
};
