import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import type { MediaFileRecord, MediaKind, ProbeResult } from '@/lib/types';

/**
 * Temporary media storage with automatic TTL cleanup.
 *
 * Files live in `<project>/storage/{uploads,results}` and every row in the
 * MediaFile table carries an `expiresAt` timestamp. A background sweeper
 * removes expired files + rows so user data is never retained unnecessarily.
 */

export const STORAGE_DIR = path.join(process.cwd(), 'storage');
export const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
export const RESULTS_DIR = path.join(STORAGE_DIR, 'results');

export const UPLOAD_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const RESULT_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250 MB
export const MAX_REMOTE_BYTES = 600 * 1024 * 1024; // 600 MB

export const ALLOWED_UPLOAD_EXT = new Set([
  // video
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'gif', 'ogv', '3gp', 'flv', 'wmv', 'ts', 'mpg', 'mpeg',
  // audio
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'amr', 'aiff',
  // image
  'png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'tiff', 'tif',
  // subtitle
  'srt', 'vtt', 'ass',
]);

export function ensureStorageDirs(): Promise<void> {
  return (async () => {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.mkdir(RESULTS_DIR, { recursive: true });
  })();
}

/** Sanitize a user supplied filename: strip paths/control chars, cap length. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._ ()\-\[\]&'#+~,]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const trimmed = cleaned.length > 120 ? cleaned.slice(-120) : cleaned;
  return trimmed || 'file';
}

export function getExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function isAllowedUploadName(name: string): boolean {
  return ALLOWED_UPLOAD_EXT.has(getExtension(name));
}

/** Guess mime from extension (used when the client doesn't provide a type). */
export function mimeFromName(name: string): string {
  const ext = getExtension(name);
  const map: Record<string, string> = {
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', m4v: 'video/x-m4v', gif: 'image/gif', ogv: 'video/ogg',
    '3gp': 'video/3gpp', flv: 'video/x-flv', wmv: 'video/x-ms-wmv', ts: 'video/mp2t',
    mpg: 'video/mpeg', mpeg: 'video/mpeg',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
    flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus',
    wma: 'audio/x-ms-wma', amr: 'audio/amr', aiff: 'audio/aiff',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    avif: 'image/avif', bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff',
    srt: 'application/x-subrip', vtt: 'text/vtt', ass: 'text/x-ssa',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function fileDirFor(kind: MediaKind): string {
  return kind === 'result' ? RESULTS_DIR : UPLOADS_DIR;
}

export function absolutePathFor(record: { kind: MediaKind | string; storedName: string }): string {
  return path.join(fileDirFor(record.kind as MediaKind), record.storedName);
}

/** Stream a readable web stream to disk, enforcing a max size. */
export async function saveStreamToFile(
  body: ReadableStream<Uint8Array>,
  destPath: string,
  maxBytes: number
): Promise<number> {
  const { Readable } = await import('stream');
  const { pipeline } = await import('stream/promises');
  const fsMod = await import('fs');

  let written = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      written += chunk.byteLength;
      if (written > maxBytes) {
        ctrl.error(new Error(`FILE_TOO_LARGE:${maxBytes}`));
      } else {
        ctrl.enqueue(chunk);
      }
    },
  });
  const nodeStream = Readable.fromWeb(body.pipeThrough(counter) as never);
  await pipeline(nodeStream, fsMod.createWriteStream(destPath));
  return written;
}

export function toMediaFileRecord(row: {
  id: string; kind: string; originalName: string; sizeBytes: number; mime: string;
  metaJson: string | null; operation: string | null; sourceUrl: string | null;
  sourceType: string | null; createdAt: Date; expiresAt: Date | null;
}): MediaFileRecord {
  let meta: ProbeResult | null = null;
  if (row.metaJson) {
    try { meta = JSON.parse(row.metaJson) as ProbeResult; } catch { meta = null; }
  }
  return {
    id: row.id,
    kind: row.kind as MediaKind,
    originalName: row.originalName,
    sizeBytes: row.sizeBytes,
    mime: row.mime,
    meta,
    operation: row.operation,
    sourceUrl: row.sourceUrl,
    sourceType: row.sourceType,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

/** Create a MediaFile DB row for a file already written to disk. */
export async function registerStoredFile(opts: {
  kind: MediaKind;
  storedName: string;
  originalName: string;
  sizeBytes: number;
  mime: string;
  meta?: ProbeResult | null;
  operation?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  ttlMs?: number;
}): Promise<MediaFileRecord> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? (opts.kind === 'result' ? RESULT_TTL_MS : UPLOAD_TTL_MS)));
  const row = await db.mediaFile.create({
    data: {
      id,
      kind: opts.kind,
      storedName: opts.storedName,
      originalName: opts.originalName,
      sizeBytes: opts.sizeBytes,
      mime: opts.mime,
      metaJson: opts.meta ? JSON.stringify(opts.meta) : null,
      operation: opts.operation ?? null,
      sourceUrl: opts.sourceUrl ?? null,
      sourceType: opts.sourceType ?? null,
      expiresAt,
    },
  });
  return toMediaFileRecord(row);
}

/** Delete a stored file and its DB row (best effort). */
export async function deleteStoredFile(id: string): Promise<boolean> {
  const row = await db.mediaFile.findUnique({ where: { id } });
  if (!row) return false;
  try { await fs.unlink(absolutePathFor(row)); } catch { /* already gone */ }
  await db.mediaFile.delete({ where: { id } }).catch(() => undefined);
  return true;
}

// ---------------------------------------------------------------------------
// Background TTL sweeper (singleton across dev hot reloads)
// ---------------------------------------------------------------------------

const sweeperKey = '__mediaStorageSweeper__' as const;
type SweeperGlobal = typeof globalThis & { [sweeperKey]?: NodeJS.Timeout };

export function startStorageSweeper(): void {
  const g = globalThis as SweeperGlobal;
  if (g[sweeperKey]) return;
  const sweep = async () => {
    try {
      const expired = await db.mediaFile.findMany({ where: { expiresAt: { lt: new Date() } } });
      for (const row of expired) {
        try { await fs.unlink(absolutePathFor(row)); } catch { /* ignore */ }
      }
      if (expired.length > 0) {
        await db.mediaFile.deleteMany({ where: { id: { in: expired.map((r) => r.id) } } });
      }
    } catch {
      // database may not be ready during startup; ignore
    }
  };
  const timer = setInterval(sweep, 10 * 60 * 1000);
  timer.unref?.();
  g[sweeperKey] = timer;
  // run shortly after boot rather than synchronously
  setTimeout(sweep, 5_000).unref?.();
}

/** Manual sweep (Settings page button). Returns number of removed files. */
export async function sweepNow(): Promise<number> {
  const expired = await db.mediaFile.findMany({ where: { expiresAt: { lt: new Date() } } });
  for (const row of expired) {
    try { await fs.unlink(absolutePathFor(row)); } catch { /* ignore */ }
  }
  if (expired.length > 0) {
    await db.mediaFile.deleteMany({ where: { id: { in: expired.map((r) => r.id) } } });
  }
  return expired.length;
}
