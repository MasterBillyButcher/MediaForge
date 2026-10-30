'use client';

/**
 * Browser client for the playlist-worker mini service (port 3030),
 * reached through the gateway with the XTransformPort query parameter.
 * All paths are relative per the platform gateway rules.
 */

export interface PlaylistEntryDto {
  i: number;
  id: string | null;
  url: string;
  title: string | null;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
}

export interface PlaylistInfoDto {
  kind: 'playlist' | 'single';
  title: string;
  uploader: string | null;
  webpageUrl: string;
  count: number;
  entries: PlaylistEntryDto[];
  warnings: string[];
}

export type TaskStateDto =
  | 'pending' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface PlaylistTaskDto {
  i: number;
  title: string;
  state: TaskStateDto;
  progress: number;
  phase: 'downloading' | 'processing' | null;
  speed: string | null;
  eta: number | null;
  error: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  ext: string | null;
  fileUrl: string | null;
}

export interface PlaylistJobDto {
  id: string;
  title: string;
  format: string;
  quality: string;
  bitrate: string;
  state: 'active' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  createdAt: number;
  finishedAt: number | null;
  hasCookies: boolean;
  error: string | null;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  activeCount: number;
  totalBytes: number;
  percent: number;
  videos: PlaylistTaskDto[];
}

export interface PlaylistJobSummaryDto {
  id: string;
  title: string;
  format: string;
  state: PlaylistJobDto['state'];
  createdAt: number;
  total: number;
  completed: number;
  failed: number;
  percent: number;
}

export interface CreateJobInputDto {
  title: string;
  sourceUrl: string | null;
  format: string;
  quality: string;
  bitrate: string;
  cookies?: string;
  entries: Array<{ url: string; title: string | null }>;
}

const PORT = 3030;

function withPort(p: string): string {
  return `${p}${p.includes('?') ? '&' : '?'}XTransformPort=${PORT}`;
}

async function handleJson<T>(res: Response): Promise<T> {
  let data: unknown = null;
  try { data = await res.json(); } catch { /* non-json */ }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export async function fetchPlaylistInfo(url: string, cookies?: string): Promise<PlaylistInfoDto> {
  const res = await fetch(withPort('/pw/info'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, ...(cookies ? { cookies } : {}) }),
  });
  return handleJson<PlaylistInfoDto>(res);
}

export async function createPlaylistJob(input: CreateJobInputDto): Promise<{ jobId: string; total: number }> {
  const res = await fetch(withPort('/pw/jobs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleJson<{ jobId: string; total: number }>(res);
}

export async function fetchPlaylistJob(id: string): Promise<PlaylistJobDto> {
  const res = await fetch(withPort(`/pw/jobs/${id}`));
  return handleJson<PlaylistJobDto>(res);
}

export async function fetchPlaylistJobs(): Promise<{ jobs: PlaylistJobSummaryDto[] }> {
  const res = await fetch(withPort('/pw/jobs'));
  return handleJson<{ jobs: PlaylistJobSummaryDto[] }>(res);
}

export async function cancelPlaylistJob(id: string): Promise<void> {
  const res = await fetch(withPort(`/pw/jobs/${id}/cancel`), { method: 'POST' });
  return handleJson<void>(res);
}

export async function retryPlaylistJob(id: string): Promise<void> {
  const res = await fetch(withPort(`/pw/jobs/${id}/retry`), { method: 'POST' });
  return handleJson<void>(res);
}

export async function deletePlaylistJob(id: string): Promise<void> {
  const res = await fetch(withPort(`/pw/jobs/${id}`), { method: 'DELETE' });
  return handleJson<void>(res);
}

export function playlistFileUrl(jobId: string, index: number): string {
  return withPort(`/pw/file/${jobId}/${index}`);
}

export function playlistZipUrl(jobId: string): string {
  return withPort(`/pw/jobs/${jobId}/zip`);
}

export const TERMINAL_JOB_STATES = new Set(['completed', 'cancelled', 'failed', 'interrupted']);

/** Rough size estimate for a single item (bytes) — clearly labelled as approximate in UI. */
export function estimateItemBytes(
  durationSec: number | null,
  format: string,
  quality: string,
  bitrate: string
): number | null {
  if (!durationSec || durationSec <= 0) return null;
  const videoMbps: Record<string, number> = {
    '2160': 45, '1440': 24, '1080': 8, '720': 5, '480': 2.5, '360': 1.2, '240': 0.7, '144': 0.4,
  };
  const audioKbps: Record<string, number> = {
    mp3: bitrate === 'best' ? 320 : Number(bitrate) || 192,
    m4a: bitrate === 'best' ? 256 : Number(bitrate) || 192,
    aac: bitrate === 'best' ? 256 : Number(bitrate) || 192,
    ogg: bitrate === 'best' ? 224 : Number(bitrate) || 160,
    opus: bitrate === 'best' ? 160 : Number(bitrate) || 128,
    wav: 1411,
    flac: 900,
  };
  let kbps: number;
  if (audioKbps[format] !== undefined) {
    kbps = audioKbps[format];
  } else {
    const v = quality === 'best' ? 8 : (videoMbps[quality] ?? 8);
    kbps = v * 1000 + 128;
  }
  return Math.round((kbps * 1000 * durationSec) / 8);
}
