import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { checkPublicHttpUrl } from '@/lib/media/url';

/**
 * HLS (HTTP Live Streaming) playlist utilities.
 *
 * - Parses master playlists (#EXT-X-STREAM-INF variants) and media playlists
 *   (#EXTINF segments) with real durations.
 * - For Twitch CDN-hosted VOD manifests (cloudfront / ttvnw / akamai), probes
 *   the sibling quality folders — including `audio_only/` — because Twitch
 *   mutes parts of some VODs in the muxed renditions while the separate
 *   audio-only rendition often remains unmuted. Muxing that track back in
 *   restores the original (unmuted) audio.
 */

export const HLS_UA = 'Mozilla/5.0 (compatible; MediaToolkit/1.0; HLS)';

export interface HlsRawVariant {
  url: string;
  label: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  bandwidth: number | null;
  codecs: string | null;
  isAudioOnly: boolean;
}

export interface MediaPlaylistInfo {
  duration: number;
  segmentCount: number;
  discontinuities: number;
  targetDuration: number | null;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export async function fetchHlsText(
  url: string,
  timeoutMs = 15_000
): Promise<{ text: string; contentType: string; finalUrl: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': HLS_UA, Accept: '*/*, application/vnd.apple.mpegurl, application/x-mpegURL' },
      redirect: 'follow',
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`The stream responded with HTTP ${res.status}.`);
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const text = await res.text();
    return { text, contentType, finalUrl: res.url || url };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('The stream took too long to respond.');
    }
    throw err instanceof Error ? err : new Error('Could not reach the stream URL.');
  } finally {
    clearTimeout(timer);
  }
}

export function looksLikeHlsText(text: string, contentType: string): boolean {
  if (contentType.includes('mpegurl')) return true;
  return text.slice(0, 512).trimStart().startsWith('#EXTM3U');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Parse key="value" / key=value attribute lists (quoted values may contain commas). */
function parseAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const colon = line.indexOf(':');
  if (colon < 0) return attrs;
  const body = line.slice(colon + 1);
  const re = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    attrs[m[1].toUpperCase()] = m[2].replace(/^"|"$/g, '');
  }
  return attrs;
}

export function resolveUrl(baseUrl: string, relative: string): string | null {
  try {
    return new URL(relative, baseUrl).toString();
  } catch {
    return null;
  }
}

const VIDEO_CODEC_RE = /\b(avc1|avc3|avc4|hvc1|hev1|vp08|vp09|av01|mp4v|h264|hevc|vp8|vp9|av1)\b/i;

export function parseMasterPlaylist(text: string, baseUrl: string): HlsRawVariant[] {
  const lines = text.split(/\r?\n/);
  const variants: HlsRawVariant[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttrs(line);
      let uri = '';
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j].trim();
        if (!candidate || candidate.startsWith('#')) continue;
        uri = candidate;
        i = j;
        break;
      }
      if (!uri) continue;
      const url = resolveUrl(baseUrl, uri);
      if (!url) continue;

      let width: number | null = null;
      let height: number | null = null;
      if (attrs.RESOLUTION) {
        const [w, h] = attrs.RESOLUTION.toLowerCase().split('x').map(Number);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          width = w;
          height = h;
        }
      }
      const fps = attrs['FRAME-RATE'] ? Math.round(Number(attrs['FRAME-RATE'])) || null : null;
      const codecs = attrs.CODECS || null;
      const isAudioOnly = codecs ? !VIDEO_CODEC_RE.test(codecs) : false;
      const bandwidth = attrs.BANDWIDTH ? Number(attrs.BANDWIDTH) || null : null;

      let label = attrs.NAME || '';
      if (!label) {
        label = height ? `${height}p${fps ?? ''}` : isAudioOnly ? 'audio-only' : `variant ${variants.length + 1}`;
      }
      if (isAudioOnly) label = attrs.NAME || 'audio-only';

      variants.push({ url, label, width, height, fps, bandwidth, codecs, isAudioOnly });
      continue;
    }

    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttrs(line);
      if (attrs.TYPE === 'AUDIO' && attrs.URI) {
        const url = resolveUrl(baseUrl, attrs.URI);
        if (!url) continue;
        variants.push({
          url,
          label: attrs.NAME || 'audio-only',
          width: null,
          height: null,
          fps: null,
          bandwidth: null,
          codecs: null,
          isAudioOnly: true,
        });
      }
    }
  }

  return variants;
}

export function parseMediaPlaylist(text: string): MediaPlaylistInfo {
  let duration = 0;
  let segmentCount = 0;
  let discontinuities = 0;
  let targetDuration: number | null = null;
  let twitchTotalSecs: number | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      const value = parseFloat(line.slice(8).replace(/,.*/, ''));
      if (Number.isFinite(value)) duration += value;
    } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const value = Number(line.slice(22));
      if (Number.isFinite(value)) targetDuration = value;
    } else if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      discontinuities += 1;
    } else if (line.startsWith('#EXT-X-TWITCH-TOTAL-SECS:')) {
      const value = Number(line.slice(25));
      if (Number.isFinite(value) && value > 0) twitchTotalSecs = value;
    } else if (line && !line.startsWith('#')) {
      segmentCount += 1;
    }
  }

  if (duration <= 0 && twitchTotalSecs != null) duration = twitchTotalSecs;

  return {
    duration: Math.round(duration * 100) / 100,
    segmentCount,
    discontinuities,
    targetDuration,
  };
}

// ---------------------------------------------------------------------------
// ffprobe metadata (real bitrate / resolution for honest size estimates)
// ---------------------------------------------------------------------------

export interface HlsProbeMeta {
  width: number | null;
  height: number | null;
  fps: number | null;
  /** overall bitrate in bits per second (video + audio) */
  bandwidth: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

/** ffprobe an HLS URL (reads the manifest + first segments) for real metadata. */
export async function ffprobeHlsUrl(url: string, timeoutMs = 45_000): Promise<HlsProbeMeta | null> {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format', '-show_streams',
      '-analyzeduration', '10M', '-probesize', '10M',
      '-user_agent', HLS_UA,
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    let done = false;
    const finish = (value: HlsProbeMeta | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0 || !out) return finish(null);
      try {
        const data = JSON.parse(out) as {
          streams?: Array<Record<string, unknown>>;
          format?: Record<string, unknown>;
        };
        const streams = data.streams ?? [];
        const video = streams.find((s) => s.codec_type === 'video');
        const audio = streams.find((s) => s.codec_type === 'audio');
        const format = data.format ?? {};
        let fps: number | null = null;
        if (video) {
          const rawFps = String(video.avg_frame_rate ?? video.r_frame_rate ?? '0/1');
          const [num, den] = rawFps.split('/').map(Number);
          if (num > 0 && den > 0) fps = Math.round(num / den) || null;
        }
        finish({
          width: video ? Number(video.width) || null : null,
          height: video ? Number(video.height) || null : null,
          fps,
          // ffprobe's format.bit_rate is unreliable on partial HLS reads —
          // accept only sane values, otherwise the caller falls back to
          // resolution-based estimates
          bandwidth: Number(format.bit_rate ?? 0) > 100_000 ? Number(format.bit_rate) : null,
          videoCodec: video ? String(video.codec_name) : null,
          audioCodec: audio ? String(audio.codec_name) : null,
        });
      } catch {
        finish(null);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Twitch CDN helpers
// ---------------------------------------------------------------------------

export function isTwitchCdnHost(hostname: string): boolean {
  return /(^|\.)(cloudfront\.net|ttvnw\.net|twitchcdn\.net|akamaized\.net)$/i.test(hostname);
}

const TWITCH_QUALITY_FOLDERS = [
  'chunked', '1080p60', '1080p30', '936p60', '856p45', '720p60', '720p30', '720p',
  '480p30', '480p', '360p30', '360p', '160p30', '160p',
  'high', 'medium', 'low', 'mobile', 'worst', 'best',
] as const;

export interface TwitchSibling {
  url: string;
  label: string;
  height: number | null;
  fps: number | null;
  isAudioOnly: boolean;
  duration: number | null;
}

export interface TwitchDiscoveryResult {
  qualities: TwitchSibling[];
  audioOnlyUrl: string | null;
  audioOnlyDuration: number | null;
}

/**
 * Probe sibling quality/audio folders next to a Twitch CDN media playlist.
 * Given `.../{vod}/chunked/index-dvr.m3u8` this looks for
 * `.../{vod}/audio_only/index-dvr.m3u8`, `.../{vod}/720p30/index-dvr.m3u8`, etc.
 */
export async function discoverTwitchSiblingTracks(
  mediaUrl: string,
  opts: { audioOnlyOnly?: boolean } = {}
): Promise<TwitchDiscoveryResult> {
  const result: TwitchDiscoveryResult = { qualities: [], audioOnlyUrl: null, audioOnlyDuration: null };

  let u: URL;
  try {
    u = new URL(mediaUrl);
  } catch {
    return result;
  }
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return result;
  const fileName = segments[segments.length - 1];
  if (!/\.m3u8$/i.test(fileName)) return result;
  const currentFolder = segments[segments.length - 2];
  const baseDir = `${u.origin}${u.pathname.split('/').slice(0, -2).join('/')}`;

  const candidates: string[] = ['audio_only'];
  if (!opts.audioOnlyOnly) {
    for (const folder of TWITCH_QUALITY_FOLDERS) {
      if (folder !== currentFolder) candidates.push(folder);
    }
  }

  const probes = await Promise.allSettled(
    candidates.map(async (folder) => {
      const url = `${baseDir}/${folder}/${fileName}`;
      try {
        const { text } = await fetchHlsText(url, 9_000);
        if (!looksLikeHlsText(text, '')) return null;
        const info = parseMediaPlaylist(text);
        return { folder, url, text, info };
      } catch {
        return null;
      }
    })
  );

  for (const probe of probes) {
    if (probe.status !== 'fulfilled' || !probe.value) continue;
    const { folder, url, info } = probe.value;
    if (folder === 'audio_only') {
      if (!result.audioOnlyUrl) {
        result.audioOnlyUrl = url;
        result.audioOnlyDuration = info.duration || null;
      }
    } else {
      const match = /^(\d{3,4})p(\d{2})?$/.exec(folder);
      result.qualities.push({
        url,
        label: folder,
        height: match ? Number(match[1]) : null,
        fps: match?.[2] ? Number(match[2]) : null,
        isAudioOnly: false,
        duration: info.duration || null,
      });
    }
  }

  result.qualities.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return result;
}

/** Extract a human-ish title from an HLS URL (folder or file name). */
export function titleFromHlsUrl(u: URL): string {
  const segments = u.pathname.split('/').filter(Boolean);
  const generic = /^(index|index-dvr|index-unmuted|muted|unmuted|dvr|chunked|audio_only|\d{3,4}p\d{0,2}|high|medium|low|mobile|hls|m3u8)$/i;

  // walk from the end and take the first meaningful path segment
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = decodeURIComponent(segments[i]).replace(/\.m3u8$/i, '');
    if (!seg || generic.test(seg) || /^index/i.test(seg)) continue;
    const cleaned = seg.replace(/[_+.-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length < 3) continue;

    // long token soup (e.g. "9fa9c5cc..._beaststatsofficial_316452706284_..."):
    // pick the token with the most letters — usually the human-readable name
    if (cleaned.length > 40 && cleaned.includes(' ')) {
      const tokens = cleaned.split(' ');
      const best = tokens
        .map((t) => ({ t, letters: (t.match(/[a-zA-Z]/g) ?? []).length }))
        .sort((a, b) => b.letters - a.letters)[0];
      if (best && best.letters >= 5) return best.t.slice(0, 80);
    }
    return cleaned.slice(0, 80);
  }

  const file = (segments[segments.length - 1] ?? 'stream').replace(/\.m3u8$/i, '');
  return file.replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'stream';
}

/** Available bytes on the storage volume (best-effort, null when unsupported). */
export async function availableDiskBytes(): Promise<number | null> {
  try {
    const stats = await fs.statfs(process.cwd());
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/** Validate a candidate media/audio URL for the download route (re-check SSRF). */
export async function validateStreamUrl(raw: string): Promise<{ ok: boolean; error?: string; url?: URL }> {
  return checkPublicHttpUrl(raw);
}
