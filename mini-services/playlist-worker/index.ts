import archiver from 'archiver';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  AUDIO_BITRATES, AUDIO_FORMATS, MIME_BY_EXT, QUALITY_HEIGHTS, VIDEO_FORMATS,
  deleteFileQuiet, extractInfo, hydrateEntries, resolveBinaries, saveCookiesFile,
  type AudioBitrate, type MediaFormat, type QualityHeight,
} from './engine';
import {
  JobInputError, TMP_DIR, boot, cancelJob, createJob, deleteJob, getJob,
  jobStats, listJobs, retryJob,
} from './store';

/**
 * Playlist Worker — long-running playlist/queue downloads on a dedicated
 * service so heavy media work never blocks the main web server.
 *
 * Routes (all under /pw, reached via the gateway with ?XTransformPort=3030):
 *   GET    /pw/health
 *   POST   /pw/info            {url, cookies?}
 *   POST   /pw/jobs            {entries[], format, quality, bitrate, title?, sourceUrl?, cookies?}
 *   GET    /pw/jobs
 *   GET    /pw/jobs/:id
 *   POST   /pw/jobs/:id/cancel
 *   POST   /pw/jobs/:id/retry
 *   DELETE /pw/jobs/:id
 *   GET    /pw/jobs/:id/zip
 *   GET    /pw/file/:jobId/:index      (?inline=1 supported, Range requests honored)
 */

const PORT = 3030;

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function errorJson(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function readJson(req: Request, maxBytes = 2 * 1024 * 1024): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sanitizeDispositionName(name: string): string {
  const cleaned = name.replace(/[\r\n"\\]/g, '').replace(/[/\\?%*:|<>]/g, '_').trim();
  return (cleaned || 'file').slice(0, 150);
}

function contentDisposition(fileName: string, inline: boolean): string {
  const type = inline ? 'inline' : 'attachment';
  const ascii = sanitizeDispositionName(fileName).replace(/[^\x20-\x7E]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleInfo(body: Record<string, unknown>): Promise<Response> {
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) return errorJson('Enter a valid URL starting with http:// or https://.');
  const cookiesRaw = typeof body.cookies === 'string' ? body.cookies : '';
  const cookiesPath = cookiesRaw ? await saveCookiesFile(cookiesRaw, TMP_DIR) : null;
  if (cookiesRaw && !cookiesPath) {
    return errorJson('The cookies file could not be parsed. Export cookies in Netscape format (cookies.txt) and paste its full contents.');
  }
  try {
    const info = await extractInfo(url, cookiesPath);
    // Hydrate missing titles/durations so the UI shows a meaningful list
    await hydrateEntries(info.entries, cookiesPath);
    return json(info);
  } catch (err) {
    return errorJson(err instanceof Error ? err.message : 'Could not inspect that URL.', 422);
  } finally {
    await deleteFileQuiet(cookiesPath);
  }
}

async function handleCreateJob(body: Record<string, unknown>): Promise<Response> {
  const format = body.format as MediaFormat;
  const quality = (body.quality ?? 'best') as QualityHeight;
  const bitrate = (body.bitrate ?? 'best') as AudioBitrate;
  if (![...VIDEO_FORMATS, ...AUDIO_FORMATS].includes(format)) return errorJson('Unknown output format.');
  if (!QUALITY_HEIGHTS.includes(quality)) return errorJson('Unknown quality.');
  if (!AUDIO_BITRATES.includes(bitrate)) return errorJson('Unknown audio bitrate.');

  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  const entries: Array<{ url: string; title: string | null }> = [];
  for (const e of rawEntries) {
    if (e && typeof e === 'object') {
      const rec = e as Record<string, unknown>;
      const url = typeof rec.url === 'string' ? rec.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) continue;
      entries.push({ url, title: typeof rec.title === 'string' && rec.title ? rec.title : null });
    }
  }

  const cookiesRaw = typeof body.cookies === 'string' ? body.cookies : '';
  const cookiesPath = cookiesRaw ? await saveCookiesFile(cookiesRaw, TMP_DIR) : null;
  if (cookiesRaw && !cookiesPath) {
    return errorJson('The cookies file could not be parsed. Export cookies in Netscape format (cookies.txt) and paste its full contents.');
  }

  try {
    const job = await createJob({
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Playlist',
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
      format,
      quality,
      bitrate,
      cookiesPath,
      entries,
    });
    if (cookiesPath) {
      const { jobCookies } = await import('./store');
      jobCookies.set(job.id, cookiesPath);
    }
    return json({ jobId: job.id, total: job.videos.length }, 201);
  } catch (err) {
    await deleteFileQuiet(cookiesPath);
    if (err instanceof JobInputError) return errorJson(err.message, 400);
    return errorJson(err instanceof Error ? err.message : 'Could not create the job.', 500);
  }
}

interface TaskView {
  i: number;
  title: string;
  state: string;
  progress: number;
  phase: string | null;
  speed: string | null;
  eta: number | null;
  error: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  ext: string | null;
  fileUrl: string | null;
}

function taskViews(jobId: string, job: ReturnType<typeof getJob>): TaskView[] {
  if (!job) return [];
  return job.videos.map((v) => ({
    i: v.i,
    title: v.title,
    state: v.state,
    progress: Math.round(v.progress),
    phase: v.phase,
    speed: v.speed,
    eta: v.eta,
    error: v.error,
    fileName: v.fileName,
    sizeBytes: v.sizeBytes,
    ext: v.ext,
    fileUrl: v.state === 'completed' && v.fileName ? `/pw/file/${jobId}/${v.i}` : null,
  }));
}

async function handleFile(req: Request, jobId: string, indexStr: string): Promise<Response> {
  const job = getJob(jobId);
  if (!job) return errorJson('Job not found.', 404);
  const index = parseInt(indexStr, 10);
  const task = job.videos[index];
  if (!task || task.state !== 'completed' || !task.fileName) return errorJson('File not available.', 404);
  const filePath = path.join(job.dir, task.fileName);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return errorJson('File no longer exists (it may have expired).', 410);
  }
  const mime = MIME_BY_EXT[task.ext ?? ''] ?? 'application/octet-stream';
  const inline = new URL(req.url).searchParams.get('inline') === '1';
  const baseHeaders: Record<string, string> = {
    'Content-Type': mime,
    'Content-Disposition': contentDisposition(task.fileName, inline),
    'Accept-Ranges': 'bytes',
  };

  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      }
      end = Math.min(end, stat.size - 1);
      const stream = (await import('node:fs')).createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': String(end - start + 1),
        },
      });
    }
  }

  const stream = (await import('node:fs')).createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(stat.size) },
  });
}

async function handleZip(jobId: string): Promise<Response> {
  const job = getJob(jobId);
  if (!job) return errorJson('Job not found.', 404);
  const done = job.videos.filter((v) => v.state === 'completed' && v.fileName);
  if (done.length === 0) return errorJson('No completed files to zip yet.', 409);

  const archive = archiver('zip', { store: true }); // media is already compressed
  archive.on('warning', (err) => console.warn('[playlist-worker] zip warning:', err.message));
  archive.on('error', (err) => console.error('[playlist-worker] zip error:', err.message));
  for (const v of done) {
    const filePath = path.join(job.dir, v.fileName!);
    try {
      await fs.access(filePath);
      archive.file(filePath, { name: v.fileName! });
    } catch { /* file vanished — skip */ }
  }
  // append entries first, then start finalization; the response consumes the stream
  void archive.finalize();
  const zipName = `${sanitizeDispositionName(job.title || 'playlist')}.zip`;
  return new Response(Readable.toWeb(archive) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition(zipName, false),
    },
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function handle(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const method = req.method;
  if (!pathname.startsWith('/pw/') && pathname !== '/pw') return errorJson('Not found', 404);
  const parts = pathname.split('/').filter(Boolean); // ['pw', ...]

  try {
    if (parts[1] === 'health' && method === 'GET') {
      const bins = await resolveBinaries();
      return json({ ok: true, service: 'playlist-worker', ytDlp: bins.ytDlp, ffmpeg: bins.ffmpeg });
    }

    if (parts[1] === 'info' && method === 'POST') {
      const body = await readJson(req);
      if (!body) return errorJson('Invalid request body.');
      return await handleInfo(body);
    }

    if (parts[1] === 'jobs') {
      if (parts.length === 2) {
        if (method === 'GET') {
          return json({
            jobs: listJobs().map((j) => ({
              id: j.id, title: j.title, format: j.format, state: j.state,
              createdAt: j.createdAt, finishedAt: j.finishedAt, ...jobStats(j),
            })),
          });
        }
        if (method === 'POST') {
          const body = await readJson(req);
          if (!body) return errorJson('Invalid request body.');
          return await handleCreateJob(body);
        }
      }
      if (parts.length === 3 && method === 'GET') {
        const job = getJob(parts[2]);
        if (!job) return errorJson('Job not found.', 404);
        return json({
          id: job.id, title: job.title, format: job.format, quality: job.quality,
          bitrate: job.bitrate, state: job.state, createdAt: job.createdAt,
          finishedAt: job.finishedAt, hasCookies: job.hasCookies, error: job.error,
          ...jobStats(job),
          videos: taskViews(job.id, job),
        });
      }
      if (parts.length === 4 && parts[3] === 'cancel' && method === 'POST') {
        const ok = await cancelJob(parts[2]);
        return ok ? json({ ok: true }) : errorJson('Job not found or not active.', 404);
      }
      if (parts.length === 4 && parts[3] === 'retry' && method === 'POST') {
        const job = await retryJob(parts[2]);
        return job ? json({ ok: true, jobId: job.id }) : errorJson('Job not found.', 404);
      }
      if (parts.length === 4 && parts[3] === 'zip' && method === 'GET') {
        return await handleZip(parts[2]);
      }
      if (parts.length === 3 && method === 'DELETE') {
        const ok = await deleteJob(parts[2]);
        return ok ? json({ ok: true }) : errorJson('Job not found.', 404);
      }
    }

    if (parts[1] === 'file' && parts.length === 4 && method === 'GET') {
      return await handleFile(req, parts[2], parts[3]);
    }

    return errorJson('Not found', 404);
  } catch (err) {
    console.error('[playlist-worker] unhandled error:', err);
    return errorJson('Internal worker error.', 500);
  }
}

void boot();

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: handle,
});

console.log(`[playlist-worker] listening on http://127.0.0.1:${PORT}`);
