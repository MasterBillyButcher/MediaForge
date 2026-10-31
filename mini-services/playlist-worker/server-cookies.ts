import { promises as fs } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from './store';

/**
 * Server-side saved cookies ("remember my credentials on this server").
 *
 * - Stored under <STORAGE_ROOT>/cookies/ — inside the persistent data volume in
 *   Docker deployments (MEDIA_DATA_DIR) and gitignored in local dev.
 * - Used as an automatic fallback whenever an inspect/job/retry request arrives
 *   without cookies, so users paste cookies once instead of per download.
 * - The cookie file itself is NEVER returned through the API — only metadata
 *   (cookie count, domains, timestamp).
 */

const COOKIES_DIR = path.join(STORAGE_ROOT, 'cookies');
const COOKIES_FILE = path.join(COOKIES_DIR, 'saved.txt');
const META_FILE = path.join(COOKIES_DIR, 'meta.json');

export interface ServerCookiesStatus {
  saved: boolean;
  updatedAt: number | null;
  cookieCount: number | null;
  domains: string[] | null;
}

interface ParsedCookies {
  lines: string[];
  domains: string[];
  count: number;
}

const EMPTY_STATUS: ServerCookiesStatus = {
  saved: false,
  updatedAt: null,
  cookieCount: null,
  domains: null,
};

/**
 * Parse and validate a Netscape cookies.txt payload. Stricter than the
 * per-job temp-file check in engine.ts: every line must have all 7 Netscape
 * fields because this file backs *future* downloads, not just one.
 */
function parseNetscapeCookies(raw: string): ParsedCookies | null {
  if (!raw || raw.length > 512 * 1024) return null;
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return null;
  const domains = new Set<string>();
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 7) return null;
    const domain = cols[0].toLowerCase().replace(/^\./, '');
    if (!domain || !domain.includes('.')) return null;
    domains.add(domain);
  }
  return { lines, domains: [...domains].sort(), count: lines.length };
}

/** Save (or replace) the server-side cookies file. Throws with a user-facing message on invalid input. */
export async function saveServerCookies(raw: string): Promise<ServerCookiesStatus> {
  const parsed = parseNetscapeCookies(raw);
  if (!parsed) {
    throw new Error(
      'The cookies file could not be parsed. Export cookies in Netscape format (cookies.txt) and paste its full contents.'
    );
  }
  await fs.mkdir(COOKIES_DIR, { recursive: true });
  const body =
    ['# Netscape HTTP Cookie File', '# Saved by MediaForge — applied automatically to downloads', ...parsed.lines].join('\n') + '\n';
  // write-then-rename so a failed save never destroys the previous working cookies
  const tmp = `${COOKIES_FILE}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, COOKIES_FILE);
  // cookies are credentials — keep them owner-only where the filesystem supports it
  await fs.chmod(COOKIES_FILE, 0o600).catch(() => undefined);
  const meta = { updatedAt: Date.now(), cookieCount: parsed.count, domains: parsed.domains };
  await fs.writeFile(META_FILE, JSON.stringify(meta), 'utf8');
  console.log(`[playlist-worker] server cookies saved (${parsed.count} cookies, domains: ${parsed.domains.join(', ')})`);
  return { saved: true, ...meta };
}

/** Current saved-cookies status (metadata only — never the cookie contents). */
export async function serverCookiesStatus(): Promise<ServerCookiesStatus> {
  try {
    const meta = JSON.parse(await fs.readFile(META_FILE, 'utf8')) as {
      updatedAt?: number;
      cookieCount?: number;
      domains?: string[];
    };
    await fs.access(COOKIES_FILE);
    return {
      saved: true,
      updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : null,
      cookieCount: typeof meta.cookieCount === 'number' ? meta.cookieCount : null,
      domains: Array.isArray(meta.domains) ? meta.domains : null,
    };
  } catch {
    return EMPTY_STATUS;
  }
}

/** Path to the saved cookies file, or null when none is stored. */
export async function serverCookiesFilePath(): Promise<string | null> {
  try {
    await fs.access(COOKIES_FILE);
    return COOKIES_FILE;
  } catch {
    return null;
  }
}

/** Delete the saved cookies file + metadata. */
export async function clearServerCookies(): Promise<ServerCookiesStatus> {
  await fs.rm(COOKIES_DIR, { recursive: true, force: true }).catch(() => undefined);
  console.log('[playlist-worker] server cookies cleared');
  return EMPTY_STATUS;
}
