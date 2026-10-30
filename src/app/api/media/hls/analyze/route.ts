import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';
import { checkPublicHttpUrl } from '@/lib/media/url';
import {
  discoverTwitchSiblingTracks, fetchHlsText, ffprobeHlsUrl, isTwitchCdnHost, looksLikeHlsText,
  parseMasterPlaylist, parseMediaPlaylist, titleFromHlsUrl,
} from '@/lib/media/hls';
import type { HlsAnalyzeResult, HlsVariantInfo } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/media/hls/analyze { url }
 *
 * Fetches and parses an HLS manifest:
 * - master playlists -> real variant list (resolutions, bandwidth, codecs)
 * - media playlists  -> real duration / segment count
 * - Twitch CDN manifests -> sibling-track discovery; if an `audio_only`
 *   rendition exists next to the muxed one it is offered as the unmuted
 *   audio source (Twitch mutes segments inside muxed renditions only).
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`hls-analyze:${clientIpFromRequest(req)}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many requests. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  let body: { url?: string } | null = null;
  try { body = await req.json(); } catch { body = null; }
  const raw = (body?.url ?? '').trim();
  if (!raw) return NextResponse.json({ error: 'Please enter a stream URL.' }, { status: 400 });

  const check = await checkPublicHttpUrl(raw);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  let text: string;
  let contentType: string;
  let finalUrl: string;
  try {
    const fetched = await fetchHlsText(check.url!.toString(), 15_000);
    text = fetched.text;
    contentType = fetched.contentType;
    finalUrl = fetched.finalUrl;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not reach the stream URL.' },
      { status: 502 }
    );
  }

  if (!looksLikeHlsText(text, contentType)) {
    return NextResponse.json({ ok: false, reason: 'not-hls' });
  }

  const isMaster = text.includes('#EXT-X-STREAM-INF');
  let finalUrlObj: URL;
  try { finalUrlObj = new URL(finalUrl); } catch { finalUrlObj = check.url!; }
  const isTwitch = isTwitchCdnHost(finalUrlObj.hostname) || text.includes('#EXT-X-TWITCH-INFO');
  const title = titleFromHlsUrl(finalUrlObj);

  const warnings: string[] = [];
  const variants: HlsVariantInfo[] = [];
  let duration: number | null = null;
  let segmentCount: number | null = null;
  let discontinuities = 0;
  const playlistType: 'master' | 'media' = isMaster ? 'master' : 'media';
  const unmutedAudio: { available: boolean; url: string | null } = { available: false, url: null };

  if (isMaster) {
    const parsed = parseMasterPlaylist(text, finalUrl);
    if (parsed.length === 0) {
      return NextResponse.json({ error: 'The manifest contains no playable variants.' }, { status: 422 });
    }

    // fetch the highest-bandwidth media playlist to learn the true duration
    const videoVariants = parsed.filter((v) => !v.isAudioOnly);
    const top = [...(videoVariants.length > 0 ? videoVariants : parsed)]
      .sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];

    if (top) {
      try {
        const sub = await fetchHlsText(top.url, 12_000);
        if (looksLikeHlsText(sub.text, sub.contentType) && !sub.text.includes('#EXT-X-STREAM-INF')) {
          const info = parseMediaPlaylist(sub.text);
          duration = info.duration > 0 ? info.duration : null;
          segmentCount = info.segmentCount;
          discontinuities = info.discontinuities;
        }
      } catch { /* duration stays unknown — not fatal */ }

      // Twitch: probe for an unmuted audio-only sibling rendition
      if (isTwitch) {
        try {
          const discovery = await discoverTwitchSiblingTracks(top.url, { audioOnlyOnly: true });
          if (discovery.audioOnlyUrl) {
            unmutedAudio.available = true;
            unmutedAudio.url = discovery.audioOnlyUrl;
          }
        } catch { /* discovery is best-effort */ }
      }
    }

    let id = 0;
    for (const v of [...(videoVariants.length > 0 ? videoVariants : parsed)].sort(
      (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0)
    )) {
      variants.push({
        id: id++,
        url: v.url,
        label: v.label,
        width: v.width,
        height: v.height,
        fps: v.fps,
        bandwidth: v.bandwidth,
        codecs: v.codecs,
        isAudioOnly: v.isAudioOnly,
        estimatedBytes: v.bandwidth && duration ? Math.round((v.bandwidth * duration) / 8) : null,
      });
    }
  } else {
    const info = parseMediaPlaylist(text);
    duration = info.duration > 0 ? info.duration : null;
    segmentCount = info.segmentCount;
    discontinuities = info.discontinuities;

    variants.push({
      id: 0,
      url: finalUrl,
      label: 'Source (original quality)',
      width: null,
      height: null,
      fps: null,
      bandwidth: null,
      codecs: null,
      isAudioOnly: false,
      estimatedBytes: null,
    });

    // Twitch CDN: discover sibling quality renditions + the audio-only track
    if (isTwitch) {
      try {
        const discovery = await discoverTwitchSiblingTracks(finalUrl);
        if (discovery.audioOnlyUrl) {
          unmutedAudio.available = true;
          unmutedAudio.url = discovery.audioOnlyUrl;
        }
        let id = variants.length;
        for (const q of discovery.qualities) {
          variants.push({
            id: id++,
            url: q.url,
            label: q.label,
            width: null,
            height: q.height,
            fps: q.fps,
            bandwidth: null,
            codecs: null,
            isAudioOnly: false,
            estimatedBytes: null,
          });
        }
      } catch { /* discovery is best-effort */ }
    }

    // real metadata via ffprobe (true bitrate / resolution) for honest size estimates
    try {
      const meta = await ffprobeHlsUrl(finalUrl);
      if (meta) {
        const source = variants[0];
        source.width = meta.width;
        source.height = meta.height;
        source.fps = meta.fps;
        source.bandwidth = meta.bandwidth;
        source.codecs = [meta.videoCodec, meta.audioCodec].filter(Boolean).join(', ') || null;
        if (meta.bandwidth && duration) {
          source.estimatedBytes = Math.round((meta.bandwidth * duration) / 8);
        }
      }
    } catch { /* best-effort */ }
  }

  if (isTwitch && unmutedAudio.available) {
    warnings.push(
      'Twitch mutes segments inside some VODs (DMCA). The unmuted audio-only rendition was found next to this stream — enable it below to restore the original sound.'
    );
  } else if (isTwitch) {
    warnings.push(
      'This Twitch VOD does not expose a separate unmuted audio track — the stream is downloaded as-is. Muted segments (if any) cannot be restored.'
    );
  }
  if (discontinuities > 0) {
    warnings.push(
      `The stream contains ${discontinuities} discontinuit${discontinuities === 1 ? 'y' : 'ies'} (ad breaks / muted blocks). FFmpeg stitches them into one continuous file.`
    );
  }
  if (duration == null) {
    warnings.push('Live or unlimited-duration manifest — the duration could not be determined.');
  }

  const result: HlsAnalyzeResult = {
    ok: true,
    kind: 'hls',
    playlistType,
    url: raw,
    resolvedUrl: finalUrl,
    title,
    isTwitch,
    duration,
    segmentCount,
    discontinuities,
    variants,
    unmutedAudio,
    warnings,
  };
  return NextResponse.json(result);
}
