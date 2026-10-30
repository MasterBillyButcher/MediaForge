import { NextRequest, NextResponse } from 'next/server';
import { checkPublicHttpUrl, detectPlatform, categorizeByMime, fileNameFromUrl } from '@/lib/media/url';
import { db } from '@/lib/db';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';
import { MAX_REMOTE_BYTES } from '@/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/media/download-url { url }
 *
 * Streams a publicly accessible direct media file through the server to the
 * client, with a hard size cap and SSRF-validated URL. The response carries
 * Content-Length (when known) so the browser can show real progress.
 * Every attempt is recorded in the download history.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`dl:${clientIpFromRequest(req)}`, { limit: 15, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many downloads. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  let body: { url?: string } | null = null;
  try { body = await req.json(); } catch { body = null; }
  const raw = (body?.url ?? '').trim();
  if (!raw) return NextResponse.json({ error: 'Please enter a URL.' }, { status: 400 });

  const check = await checkPublicHttpUrl(raw);
  if (!check.ok) {
    await record(raw, 'direct', null, null, null, 'failed', check.error ?? 'Invalid URL');
    return NextResponse.json({ error: check.error }, { status: 400 });
  }
  const url = check.url!;
  const platform = detectPlatform(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let res: globalThis.Response;
  try {
    res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MediaToolkit/1.0)', Accept: '*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    await record(raw, platform.id, null, null, null, 'failed', 'Could not reach the URL');
    return NextResponse.json({ error: 'Could not reach that URL.' }, { status: 502 });
  }
  clearTimeout(timer);

  const contentType = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0];
  const contentLength = res.headers.get('content-length');
  const size = contentLength ? parseInt(contentLength, 10) : null;

  if (!res.ok) {
    await record(raw, platform.id, null, size, contentType, 'failed', `Source responded ${res.status}`);
    return NextResponse.json({ error: `The source responded with HTTP ${res.status}.` }, { status: 502 });
  }
  if (contentType.includes('text/html')) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    await record(raw, platform.id, null, size, contentType, 'unsupported', 'HTML page, not a direct media file');
    return NextResponse.json(
      { error: 'That URL is a web page rather than a media file. Paste a direct media link (e.g. .mp4 / .mp3 / .png).' },
      { status: 415 }
    );
  }
  if (size != null && size > MAX_REMOTE_BYTES) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    await record(raw, platform.id, null, size, contentType, 'failed', 'File too large');
    return NextResponse.json(
      { error: `That file is ${Math.round(size / 1024 / 1024)} MB — the limit is ${Math.round(MAX_REMOTE_BYTES / 1024 / 1024)} MB.` },
      { status: 413 }
    );
  }
  if (!res.body) {
    await record(raw, platform.id, null, size, contentType, 'failed', 'Empty response body');
    return NextResponse.json({ error: 'The source returned an empty response.' }, { status: 502 });
  }

  const fileName = fileNameFromUrl(url, contentType);
  const category = categorizeByMime(contentType, url.pathname);

  // count bytes while streaming so oversized files are cut off server-side
  let sent = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      sent += chunk.byteLength;
      if (sent > MAX_REMOTE_BYTES) {
        ctrl.error(new Error('SIZE_LIMIT'));
      } else {
        ctrl.enqueue(chunk);
      }
    },
  });

  // record success (async, do not block the stream)
  void record(raw, platform.id, fileName, size, contentType, 'completed', null);

  return new NextResponse(res.body.pipeThrough(counter), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      ...(size != null ? { 'Content-Length': String(size) } : {}),
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      'X-Media-Category': category,
      'X-File-Name': encodeURIComponent(fileName),
    },
  });
}

async function record(
  url: string, platform: string, fileName: string | null, sizeBytes: number | null,
  mime: string | null, status: string, error: string | null
): Promise<void> {
  try {
    await db.downloadRecord.create({
      data: { url: url.slice(0, 2000), platform, fileName, sizeBytes: sizeBytes ?? null, mime, status, error },
    });
  } catch { /* history is best-effort */ }
}
