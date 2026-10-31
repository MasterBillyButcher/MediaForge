import archiver from 'archiver';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  AUDIO_BITRATES, AUDIO_FORMATS, MIME_BY_EXT, QUALITY_HEIGHTS, VIDEO_FORMATS,
  deleteFileQuiet, detectAria2c, extractInfo, hydrateEntries, resolveBinaries, saveCookiesFile,
  type AudioBitrate, type JobExtras, type MediaFormat, type QualityHeight,
} from './engine';
import {
  JobInputError, TMP_DIR, boot, cancelJob, createJob, deleteJob, getJob,
  jobStats, listJobs, retryJob, setJobCookies,
} from './store';
import {
  clearServerCookies, saveServerCookies, serverCookiesFilePath, serverCookiesStatus,
  type ServerCookiesStatus,
} from './server-cookies';

/**
 * Playlist Worker — long-running playlist/queue downloads on a dedicated
 * service so heavy media work never blocks the main web server.
 *
 * Routes (all under /pw, reached via the gateway with ?XTransformPort=3030):
 *   GET    /pw/health
 *   GET    /pw/cookies         → saved-cookies status (metadata only, never contents)
 *   POST   /pw/cookies         {cookies} — save/replace the server-side cookies file
 *   DELETE /pw/cookies         — remove the saved cookies
 *   POST   /pw/info            {url, cookies?}
 *   POST   /pw/jobs            {entries[], format, quality, bitrate, title?, sourceUrl?, cookies?}
 *   GET    /pw/jobs
 *   GET    /pw/jobs/:id
 *   POST   /pw/jobs/:id/cancel
 *   POST   /pw/jobs/:id/retry
 *   DELETE /pw/jobs/:id
 *   GET    /pw/jobs/:id/zip
 *   GET    /pw/file/:jobId/:index      (?inline=1 supported, Range requests honored)
 *
 * When a request carries no cookies, the saved server-side cookies file is
 * used automatically (see server-cookies.ts), so credentials are pasted once.
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
  // request cookies win; otherwise fall back to the saved server-side cookies
  const cookiesPath = cookiesRaw
    ? await saveCookiesFile(cookiesRaw, TMP_DIR)
    : await serverCookiesFilePath();
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
    // never delete the shared saved-cookies file — only per-request temp copies
    if (cookiesPath && cookiesPath.startsWith(TMP_DIR)) await deleteFileQuiet(cookiesPath);
  }
}

function parseExtras(body: Record<string, unknown>): JobExtras {
  const raw = body.extras && typeof body.extras === 'object'
    ? (body.extras as Record<string, unknown>) : {};
  const bool = (v: unknown) => v === true;
  return {
    sponsorBlock: bool(raw.sponsorBlock),
    embedSubs: bool(raw.embedSubs),
    subtitleLangs: typeof raw.subtitleLangs === 'string' ? raw.subtitleLangs.slice(0, 120) : '',
    albumTags: bool(raw.albumTags),
    aria2c: bool(raw.aria2c),
    extraArgs: typeof raw.extraArgs === 'string' ? raw.extraArgs.slice(0, 2000) : '',
  };
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
  // request cookies win; otherwise fall back to the saved server-side cookies
  const cookiesPath = cookiesRaw
    ? await saveCookiesFile(cookiesRaw, TMP_DIR)
    : await serverCookiesFilePath();
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
      extras: parseExtras(body),
      cookiesPath,
      entries,
    });
    if (cookiesPath) setJobCookies(job.id, cookiesPath);
    return json({ jobId: job.id, total: job.videos.length }, 201);
  } catch (err) {
    // only dispose per-request temp copies — the saved cookies file must survive
    if (cookiesPath && cookiesPath.startsWith(TMP_DIR)) await deleteFileQuiet(cookiesPath);
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

  // Bun-native file responses: Readable.toWeb(createReadStream()) stalls on
  // full-file transfers in Bun, while Bun.file streams reliably (sendfile).
  const bunFile = Bun.file(filePath);

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
      return new Response(bunFile.slice(start, end + 1), {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': String(end - start + 1),
        },
      });
    }
  }

  return new Response(bunFile, {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(stat.size) },
  });
}

interface ZipCacheState {
  promise: Promise<void> | null;
  fileCount: number;
}

// Zip bundles are materialized to a cache file inside the job dir (archiver →
// node write stream is reliable in Bun) and served with Bun.file. Streaming
// archiver straight into the Response body stalls in Bun.
const zipCache = new Map<string, ZipCacheState>();

async function buildZipBundle(jobId: string, job: NonNullable<ReturnType<typeof getJob>>): Promise<string> {
  const done = job.videos.filter((v) => v.state === 'completed' && v.fileName);
  const state = zipCache.get(jobId) ?? { promise: null, fileCount: -1 };

  // Rebuild when missing or when more files completed since the last build (e.g. after retry)
  if (state.promise && state.fileCount === done.length) {
    await state.promise;
    return path.join(job.dir, '__bundle.zip');
  }

  const zipPath = path.join(job.dir, '__bundle.zip');
  const build = (async () => {
    const { createWriteStream } = await import('node:fs');
    await new Promise<void>((resolve, reject) => {
      const archive = archiver('zip', { store: true }); // media is already compressed
      const out = createWriteStream(zipPath);
      const fail = (err: Error) => {
        archive.abort?.();
        out.destroy();
        fs.unlink(zipPath).catch(() => undefined);
        reject(err);
      };
      archive.on('error', fail);
      out.on('error', fail);
      out.on('finish', () => resolve());
      archive.pipe(out);
      for (const v of done) {
        const filePath = path.join(job.dir, v.fileName!);
        archive.file(filePath, { name: v.fileName! });
      }
      void archive.finalize();
    });
  })();

  state.promise = build;
  state.fileCount = done.length;
  zipCache.set(jobId, state);
  try {
    await build;
  } catch (err) {
    zipCache.delete(jobId);
    throw err;
  }
  return zipPath;
}

async function handleZip(jobId: string): Promise<Response> {
  const job = getJob(jobId);
  if (!job) return errorJson('Job not found.', 404);
  const done = job.videos.filter((v) => v.state === 'completed' && v.fileName);
  if (done.length === 0) return errorJson('No completed files to zip yet.', 409);

  let zipPath: string;
  try {
    zipPath = await buildZipBundle(jobId, job);
  } catch (err) {
    console.error('[playlist-worker] zip error:', err instanceof Error ? err.message : err);
    return errorJson('Could not build the ZIP bundle.', 500);
  }
  const zipName = `${sanitizeDispositionName(job.title || 'playlist')}.zip`;
  const stat = await fs.stat(zipPath).catch(() => null);
  if (!stat) return errorJson('Could not build the ZIP bundle.', 500);
  return new Response(Bun.file(zipPath), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(stat.size),
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
      return json({
        ok: true,
        service: 'playlist-worker',
        ytDlp: bins.ytDlp,
        ffmpeg: bins.ffmpeg,
        aria2c: await detectAria2c(),
        savedCookies: (await serverCookiesStatus()).saved,
      });
    }

    if (parts[1] === 'cookies' && parts.length === 2) {
      if (method === 'GET') {
        return json(await serverCookiesStatus());
      }
      if (method === 'POST') {
        const body = await readJson(req);
        if (!body) return errorJson('Invalid request body.');
        const raw = typeof body.cookies === 'string' ? body.cookies : '';
        if (!raw.trim()) return errorJson('Paste the cookies.txt contents to save.');
        try {
          const status: ServerCookiesStatus = await saveServerCookies(raw);
          return json(status);
        } catch (err) {
          return errorJson(err instanceof Error ? err.message : 'Could not save the cookies file.', 400);
        }
      }
      if (method === 'DELETE') {
        return json(await clearServerCookies());
      }
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
          bitrate: job.bitrate, extras: job.extras, state: job.state, createdAt: job.createdAt,
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
        // Optional JSON body {cookies} — lets a failed job be retried with fresh cookies
        // (e.g. after a YouTube bot-check wave). Invalid/absent body → plain retry.
        let cookies: string | null = null;
        try {
          const body = (await req.json()) as { cookies?: unknown } | null;
          if (body && typeof body.cookies === 'string' && body.cookies.trim()) cookies = body.cookies;
        } catch { /* no/invalid body — plain retry */ }
        if (cookies) {
          const p = await saveCookiesFile(cookies, TMP_DIR);
          setJobCookies(parts[2], p);
        } else {
          // no fresh cookies in the request — reuse the saved server-side cookies
          const saved = await serverCookiesFilePath();
          if (saved) setJobCookies(parts[2], saved);
        }
        const job = await retryJob(parts[2]);
        return job ? json({ ok: true, jobId: job.id, hasCookies: !!job.hasCookies }) : errorJson('Job not found.', 404);
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
