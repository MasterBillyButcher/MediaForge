import { NextResponse } from 'next/server';
import { spawnSync } from 'child_process';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Deployment self-diagnostic endpoint.
 *
 * Visit `/api/system/health` on any host to see whether the environment can
 * actually run MediaForge. All core features depend on:
 *   - ffmpeg / ffprobe   → conversion, toolbox, editor render, HLS muxing
 *   - yt-dlp             → playlist & platform downloads (playlist worker)
 *   - playlist worker    → long-running batch download service on :3030
 *   - writable database  → file listings + download history
 */

type Check = { ok: boolean; detail: string; hint: string | null };

function checkBinary(bin: string, args: string[]): Check {
  try {
    const res = spawnSync(bin, args, { encoding: 'utf8', timeout: 5000 });
    if (res.error || res.status !== 0) {
      return {
        ok: false,
        detail: res.error ? String(res.error) : `exit code ${res.status}`,
        hint: `Install "${bin}" and make sure it is on the server's PATH.`,
      };
    }
    const first = (res.stdout ?? '').split('\n')[0]?.trim() ?? '';
    return { ok: true, detail: first || `${bin} responded`, hint: null };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      hint: `Install "${bin}" and make sure it is on the server's PATH.`,
    };
  }
}

async function checkWorker(): Promise<Check> {
  const url = process.env.PLAYLIST_WORKER_INTERNAL_URL ?? 'http://127.0.0.1:3030/pw/health';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        ok: false,
        detail: `HTTP ${res.status} from ${url}`,
        hint: 'The playlist worker is running but returned an error. Check its logs.',
      };
    }
    return { ok: true, detail: 'reachable', hint: null };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      hint:
        'The playlist worker (port 3030) is not reachable. On Docker/single-host setups it must run ' +
        'next to the web app. Note: serverless platforms (Vercel/Netlify) cannot host it — deploy to ' +
        'Docker, Railway, Render, Fly.io or a VPS instead.',
    };
  }
}

async function checkDatabase(): Promise<Check> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, detail: 'writable', hint: null };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      hint:
        'Prisma could not open the SQLite database. Set DATABASE_URL (e.g. file:/app/db/custom.db), ' +
        'make sure the directory exists AND is writable, then run `bun run db:push`. ' +
        'Read-only filesystems (Vercel/Netlify serverless) cannot host the SQLite file.',
    };
  }
}

export async function GET() {
  const [ffmpeg, ffprobe, ytdlp, worker, database] = await Promise.all([
    Promise.resolve(checkBinary('ffmpeg', ['-version'])),
    Promise.resolve(checkBinary('ffprobe', ['-version'])),
    Promise.resolve(checkBinary('yt-dlp', ['--version'])),
    checkWorker(),
    checkDatabase(),
  ]);

  const checks = { ffmpeg, ffprobe, ytdlp, worker, database };
  const ok = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      ok,
      app: 'MediaForge',
      time: new Date().toISOString(),
      checks,
      note: ok
        ? 'All dependencies are available — every feature should work.'
        : 'Some dependencies are missing — see the hints above. Media features will fail until fixed.',
    },
    { status: ok ? 200 : 503 },
  );
}
