import dns from 'dns/promises';

/**
 * URL validation with SSRF protection.
 *
 * - Only http/https is accepted.
 * - DNS is resolved and every resolved address must be public.
 * - Private, loopback, link-local, CGNAT and multicast ranges are rejected.
 * - Only standard ports (80/443) are allowed.
 * - Credentials in URLs are rejected.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata.google.internal', 'instance-data', '169.254.169.254',
]);

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    // IPv6
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower === '::ffff:127.0.0.1') return true;
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('ff')) return true; // multicast
    // IPv4-mapped
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export interface UrlCheckResult {
  ok: boolean;
  error?: string;
  url?: URL;
}

export async function checkPublicHttpUrl(raw: string): Promise<UrlCheckResult> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are supported.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'URLs with embedded credentials are not allowed.' };
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    return { ok: false, error: 'Only standard ports (80/443) are allowed.' };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: 'This host is not allowed.' };
  }
  // plain IPv4 / IPv6 literal
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    if (isPrivateIp(hostname)) return { ok: false, error: 'Private and internal addresses are blocked for security.' };
  } else if (hostname.includes(':')) {
    if (isPrivateIp(hostname)) return { ok: false, error: 'Private and internal addresses are blocked for security.' };
  } else {
    try {
      const addrs = await dns.lookup(hostname, { all: true, verbatim: true });
      if (addrs.length === 0) return { ok: false, error: 'Could not resolve that hostname.' };
      for (const a of addrs) {
        if (isPrivateIp(a.address)) {
          return { ok: false, error: 'This domain resolves to a private address and is blocked for security.' };
        }
      }
    } catch {
      return { ok: false, error: 'Could not resolve that hostname. Check the URL and your connection.' };
    }
  }
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Platform detection for the downloaders
// ---------------------------------------------------------------------------

export interface PlatformInfo {
  id: string;
  name: string;
  category: 'video' | 'social' | 'media' | 'file';
  /** true when the platform serves direct media files we can stream */
  directCapable: boolean;
  note: string;
}

export const PLATFORMS: PlatformInfo[] = [
  { id: 'youtube', name: 'YouTube', category: 'video', directCapable: false, note: 'YouTube serves protected streams via DASH. Downloading is only possible for content you own (YouTube Studio) using authorized tooling — direct streaming download is not supported here.' },
  { id: 'tiktok', name: 'TikTok', category: 'social', directCapable: false, note: 'TikTok requires authenticated API access for media retrieval. Only direct public media file URLs can be downloaded.' },
  { id: 'instagram', name: 'Instagram', category: 'social', directCapable: false, note: 'Instagram requires authenticated access. Direct media file URLs (cdninstagram.com/fbcdn.net) can be downloaded.' },
  { id: 'facebook', name: 'Facebook', category: 'social', directCapable: false, note: 'Facebook requires authenticated access. Only direct public media file URLs can be downloaded.' },
  { id: 'x', name: 'X (Twitter)', category: 'social', directCapable: false, note: 'X media requires API authorization. Direct video.twimg.com / pbs.twimg.com file URLs can be downloaded.' },
  { id: 'vimeo', name: 'Vimeo', category: 'video', directCapable: false, note: 'Vimeo streams are delivered via protected manifests. Downloads require your own Vimeo account/API. Direct file URLs can be downloaded.' },
  { id: 'dailymotion', name: 'Dailymotion', category: 'video', directCapable: false, note: 'Dailymotion uses protected manifests. Only direct media file URLs can be downloaded.' },
  { id: 'reddit', name: 'Reddit', category: 'social', directCapable: true, note: 'Reddit often serves direct media (v.redd.it previews, i.redd.it images) which can be downloaded directly.' },
  { id: 'pinterest', name: 'Pinterest', category: 'social', directCapable: true, note: 'Pinterest images are usually served from direct CDN URLs (pinimg.com) and can be downloaded.' },
  { id: 'soundcloud', name: 'SoundCloud', category: 'media', directCapable: false, note: 'SoundCloud requires their API for track access. Direct CDN media URLs can be downloaded.' },
  { id: 'imgur', name: 'Imgur', category: 'media', directCapable: true, note: 'Imgur serves direct image/video CDN links that can be downloaded.' },
  { id: 'github', name: 'GitHub', category: 'file', directCapable: true, note: 'GitHub raw/release assets are direct downloads.' },
  { id: 'wikipedia', name: 'Wikipedia', category: 'file', directCapable: true, note: 'Wikimedia serves openly-licensed direct media files.' },
  { id: 'archive', name: 'Archive.org', category: 'media', directCapable: true, note: 'Internet Archive serves public-domain direct media files.' },
];

export function detectPlatform(url: URL): PlatformInfo {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const table: Array<[RegExp, string]> = [
    [/youtube\.com$|youtu\.be$|youtube-nocookie\.com$/, 'youtube'],
    [/tiktok\.com$|tiktokcdn\.com$/, 'tiktok'],
    [/instagram\.com$|cdninstagram\.com$|fbcdn\.net$/, 'instagram'],
    [/facebook\.com$|fb\.watch$|fbcdn\.net$/, 'facebook'],
    [/^(twitter|x)\.com$|twimg\.com$/, 'x'],
    [/vimeo\.com$|vimeocdn\.com$/, 'vimeo'],
    [/dailymotion\.com$|dai\.ly$/, 'dailymotion'],
    [/reddit\.com$|redd\.it$|redd\.it$/, 'reddit'],
    [/pinterest\.[a-z.]+$|pinimg\.com$/, 'pinterest'],
    [/soundcloud\.com$|sndcdn\.com$/, 'soundcloud'],
    [/imgur\.com$/, 'imgur'],
    [/github\.com$|githubusercontent\.com$/, 'github'],
    [/wikipedia\.org$|wikimedia\.org$/, 'wikipedia'],
    [/archive\.org$/, 'archive'],
  ];
  for (const [re, id] of table) {
    if (re.test(host)) {
      return PLATFORMS.find((p) => p.id === id)!;
    }
  }
  return {
    id: 'direct',
    name: 'Direct link',
    category: 'file',
    directCapable: true,
    note: 'Any publicly accessible direct media file URL can be downloaded.',
  };
}

export function categorizeByMime(contentType: string, urlPath: string): 'video' | 'audio' | 'image' | 'file' {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('video/') || ct.includes('matroska')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct.startsWith('image/')) return 'image';
  const ext = (urlPath.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? '').toLowerCase();
  if (['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'ts', 'ogv', '3gp'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'].includes(ext)) return 'image';
  return 'file';
}

export function fileNameFromUrl(url: URL, contentType: string): string {
  let name = decodeURIComponent(url.pathname.split('/').pop() ?? '').trim();
  if (!name || name.length > 150 || !/\.[A-Za-z0-9]{1,8}$/.test(name)) {
    const cat = categorizeByMime(contentType, url.pathname);
    const extMap: Record<string, string> = {
      video: 'mp4', audio: 'mp3', image: 'png', file: 'bin',
    };
    const ct = contentType.split(';')[0].trim();
    const extFromMime = ct.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? '';
    name = `media-${Date.now()}.${extFromMime.slice(0, 5) || extMap[cat]}`;
  }
  return name.replace(/[\\/]/g, '');
}
