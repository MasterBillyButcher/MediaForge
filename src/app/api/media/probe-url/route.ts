import { NextRequest, NextResponse } from 'next/server';
import { checkPublicHttpUrl, detectPlatform, categorizeByMime } from '@/lib/media/url';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';
import type { UrlProbeResult } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * POST /api/media/probe-url { url }
 *
 * Validates a URL with SSRF protection, detects the platform, and — for
 * direct media files — fetches metadata via a 1-byte ranged request.
 * Platform pages (YouTube, TikTok...) are honestly reported as non-direct
 * instead of pretending a download is possible.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`probe:${clientIpFromRequest(req)}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many requests. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  let body: { url?: string } | null = null;
  try { body = await req.json(); } catch { body = null; }
  const raw = (body?.url ?? '').trim();
  if (!raw) return NextResponse.json({ error: 'Please enter a URL.' }, { status: 400 });

  const check = await checkPublicHttpUrl(raw);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }
  const url = check.url!;

  const platform = detectPlatform(url);

  // Non-direct platforms: honest limitation response
  const isCdnHost = /(cdninstagram|fbcdn|twimg|pinimg|redd\.it|sndcdn|imgur|githubusercontent|wikimedia|archive\.org)/.test(url.hostname);
  if (!platform.directCapable && !isCdnHost) {
    const result: UrlProbeResult = {
      ok: true,
      direct: false,
      platform: platform.id,
      url: raw,
      note: platform.note,
    };
    return NextResponse.json(result);
  }

  // Try a ranged request to read content metadata without downloading everything
  let contentType = '';
  let sizeBytes: number | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Range: 'bytes=0-0', 'User-Agent': 'Mozilla/5.0 (compatible; MediaToolkit/1.0)' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);
    contentType = res.headers.get('content-type') ?? '';
    const contentRange = res.headers.get('content-range'); // "bytes 0-0/12345"
    if (contentRange) {
      const total = /\/(\d+)$/.exec(contentRange);
      if (total) sizeBytes = parseInt(total[1], 10);
    }
    if (sizeBytes == null) {
      const len = res.headers.get('content-length');
      if (len && res.status === 200) sizeBytes = parseInt(len, 10);
    }
    // consume + close immediately (we only wanted headers)
    try { await res.body?.cancel(); } catch { /* ignore */ }

    // HTML pages are not direct media files
    if (contentType.includes('text/html')) {
      const result: UrlProbeResult = {
        ok: true,
        direct: false,
        platform: platform.id,
        url: raw,
        note: 'That link is a web page, not a media file. Paste a direct link to a media file (e.g. ends with .mp4, .mp3, .png) or use a supported direct source.',
      };
      return NextResponse.json(result);
    }

    // HLS manifests are handled by the streaming engine, not as direct files
    const urlExt = (url.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? '').toLowerCase();
    if (urlExt === 'm3u8' || contentType.includes('mpegurl')) {
      const result: UrlProbeResult = {
        ok: true,
        direct: false,
        platform: 'hls',
        url: raw,
        note: 'HLS stream manifest detected — MediaForge parses the stream, lists the available qualities and (for Twitch VODs) offers the unmuted audio track.',
      };
      return NextResponse.json(result);
    }
  } catch {
    return NextResponse.json(
      { error: 'Could not reach that URL. Check the address and try again.' },
      { status: 502 }
    );
  }

  const category = categorizeByMime(contentType, url.pathname);
  const result: UrlProbeResult = {
    ok: true,
    direct: true,
    platform: platform.id,
    url: raw,
    contentType: contentType.split(';')[0] || 'application/octet-stream',
    sizeBytes,
    fileName: url.pathname.split('/').pop() || undefined,
    mediaCategory: category,
  };
  return NextResponse.json(result);
}
