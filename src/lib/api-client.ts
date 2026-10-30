'use client';

import type {
  MediaFileRecord, JobSnapshot, ConvertSettings, UrlProbeResult,
  ImageOps, Edl, EdlOutputFormat, ProbeResult,
  HlsAnalyzeResult, HlsDownloadInput,
} from '@/lib/types';

/**
 * Typed browser-side API client for all modules.
 * - uploadFile: XHR with real upload progress
 * - pollJob: interval polling of /api/jobs/[id]
 * - download helpers for results and remote URLs
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function handleJson<T>(res: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch { /* non-json */ }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Upload (XHR for progress)
// ---------------------------------------------------------------------------

export function uploadFile(
  file: File,
  onProgress?: (percent: number, speedMbps: number | null) => void,
  signal?: AbortSignal
): Promise<{ file: MediaFileRecord }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/media/upload?name=${encodeURIComponent(file.name)}`);
    xhr.responseType = 'json';
    let lastTime = 0;
    let lastLoaded = 0;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const now = performance.now();
        const speedMbps = lastTime ? (e.loaded - lastLoaded) / 1024 / 1024 / ((now - lastTime) / 1000) : null;
        lastTime = now;
        lastLoaded = e.loaded;
        onProgress((e.loaded / e.total) * 100, speedMbps);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as { file: MediaFileRecord });
      } else {
        reject(new ApiError(xhr.response?.error ?? `Upload failed (${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Network error during upload.', 0));
    xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0));
    if (signal) {
      signal.addEventListener('abort', () => xhr.abort());
    }
    xhr.send(file);
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function getJob(id: string): Promise<JobSnapshot> {
  const res = await fetch(`/api/jobs/${id}`);
  const data = await handleJson<{ job: JobSnapshot }>(res);
  return data.job;
}

export async function cancelJob(id: string): Promise<void> {
  await fetch(`/api/jobs/${id}/cancel`, { method: 'POST' });
}

export function pollJob(
  id: string,
  onUpdate: (job: JobSnapshot) => void,
  intervalMs = 700
): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const job = await getJob(id);
      if (stopped) return;
      onUpdate(job);
      if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') return;
    } catch {
      if (stopped) return;
      onUpdate({
        id, type: 'unknown', state: 'failed', progress: 0, speed: null, etaSeconds: null,
        label: '', error: 'Lost connection to the server.', result: null, createdAt: 0,
        startedAt: null, finishedAt: null,
      });
      return;
    }
    timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return { stop: () => { stopped = true; if (timer) clearTimeout(timer); } };
}

export function resultDownloadUrl(jobId: string): string {
  return `/api/jobs/${jobId}/result`;
}

// ---------------------------------------------------------------------------
// Convert / tools / edl
// ---------------------------------------------------------------------------

export async function startConvert(fileId: string, settings: ConvertSettings): Promise<JobSnapshot> {
  const res = await fetch('/api/media/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, settings }),
  });
  const data = await handleJson<{ job: JobSnapshot }>(res);
  return data.job;
}

export async function startTool(
  op: string,
  params: Record<string, unknown>
): Promise<JobSnapshot> {
  const res = await fetch('/api/media/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, params }),
  });
  const data = await handleJson<{ job: JobSnapshot }>(res);
  return data.job;
}

export async function startEdlRender(
  edl: Edl,
  format: EdlOutputFormat,
  projectName?: string
): Promise<JobSnapshot> {
  const res = await fetch('/api/media/edl-render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edl, format, projectName }),
  });
  const data = await handleJson<{ job: JobSnapshot }>(res);
  return data.job;
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

export async function processImage(
  file: File | Blob,
  fileName: string,
  ops: ImageOps
): Promise<{ file: MediaFileRecord; originalSize: number }> {
  const res = await fetch(
    `/api/media/image?name=${encodeURIComponent(fileName)}&ops=${encodeURIComponent(JSON.stringify(ops))}`,
    { method: 'POST', body: file }
  );
  return handleJson(res);
}

// ---------------------------------------------------------------------------
// URL downloader
// ---------------------------------------------------------------------------

export async function probeUrl(url: string): Promise<UrlProbeResult> {
  const res = await fetch('/api/media/probe-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return handleJson(res);
}

export interface UrlDownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  speedMbps: number | null;
  /** optional ETA in seconds (server-side jobs) */
  etaSeconds?: number | null;
}

/** Stream a remote media file through the server with real progress. */
export async function downloadUrl(
  url: string,
  onProgress: (p: UrlDownloadProgress) => void,
  signal?: AbortSignal
): Promise<{ blob: Blob; fileName: string; category: string }> {
  const res = await fetch('/api/media/download-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  const totalHeader = res.headers.get('Content-Length');
  const total = totalHeader ? parseInt(totalHeader, 10) : null;
  const fileName = decodeURIComponent(res.headers.get('X-File-Name') ?? 'media.bin');
  const category = res.headers.get('X-Media-Category') ?? 'file';

  const reader = res.body!.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  let lastTime = performance.now();
  let lastLoaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as unknown as BlobPart);
    received += value.byteLength;
    const now = performance.now();
    const speedMbps = (received - lastLoaded) / 1024 / 1024 / Math.max(0.001, (now - lastTime) / 1000);
    lastTime = now;
    lastLoaded = received;
    onProgress({
      receivedBytes: received,
      totalBytes: total,
      percent: total ? Math.min(100, (received / total) * 100) : null,
      speedMbps,
    });
  }
  return { blob: new Blob(chunks), fileName, category };
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---------------------------------------------------------------------------
// HLS (m3u8) streaming
// ---------------------------------------------------------------------------

export type HlsAnalyzeResponse =
  | HlsAnalyzeResult
  | { ok: false; reason: 'not-hls' };

/** Parse an HLS manifest (qualities, duration, Twitch unmuted-audio track). */
export async function analyzeHls(url: string): Promise<HlsAnalyzeResponse> {
  const res = await fetch('/api/media/hls/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return handleJson(res);
}

/** Start a server-side HLS download job (ffmpeg, stream copy, real progress). */
export async function startHlsDownload(
  input: HlsDownloadInput
): Promise<{ job: JobSnapshot }> {
  const res = await fetch('/api/media/hls/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: input.url,
      audioUrl: input.audioUrl ?? null,
      format: input.format,
      title: input.title ?? null,
      duration: input.duration ?? null,
      maxDurationSec: input.maxDurationSec ?? null,
      estimatedBytes: input.estimatedBytes ?? null,
    }),
  });
  return handleJson(res);
}

/** Quick client-side check whether a URL points at an HLS manifest. */
export function isHlsUrl(raw: string): boolean {
  return /\.m3u8([?#]|$)/i.test(raw.trim());
}

// ---------------------------------------------------------------------------
// History & files
// ---------------------------------------------------------------------------

export interface HistoryRecord {
  id: string;
  url: string;
  platform: string;
  fileName: string | null;
  sizeBytes: number | null;
  mime: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}

export async function fetchHistory(): Promise<HistoryRecord[]> {
  const res = await fetch('/api/history');
  const data = await handleJson<{ records: HistoryRecord[] }>(res);
  return data.records;
}

export async function deleteHistory(id?: string): Promise<void> {
  await fetch(`/api/history${id ? `?id=${id}` : ''}`, { method: 'DELETE' });
}

export async function fetchFiles(kind?: string): Promise<MediaFileRecord[]> {
  const res = await fetch(`/api/files${kind ? `?kind=${kind}` : ''}`);
  const data = await handleJson<{ files: MediaFileRecord[] }>(res);
  return data.files;
}

export async function deleteFile(id: string): Promise<void> {
  const res = await fetch(`/api/files/${id}`, { method: 'DELETE' });
  await handleJson(res);
}

// ---------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------

export async function extractSubtitles(
  fileId: string,
  index?: number
): Promise<{ file: MediaFileRecord; availableTracks: Array<{ index: number; codec: string; language: string }> }> {
  const res = await fetch('/api/media/extract-subtitles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, index }),
  });
  return handleJson(res);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function cleanupStorage(): Promise<number> {
  const res = await fetch('/api/system/cleanup', { method: 'POST' });
  const data = await handleJson<{ removed: number }>(res);
  return data.removed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function fileUrl(id: string, inline = false): string {
  return `/api/media/file/${id}${inline ? '?inline=1' : ''}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export type { ProbeResult };
