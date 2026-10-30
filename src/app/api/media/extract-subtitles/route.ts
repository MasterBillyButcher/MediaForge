import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { absolutePathFor, ensureStorageDirs, startStorageSweeper } from '@/lib/storage';
import { findSubtitleStreams, runFfmpeg } from '@/lib/media/ffmpeg';
import { registerStoredFile } from '@/lib/storage';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const BITMAP_SUBTITLES = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub']);

/**
 * POST /api/media/extract-subtitles { fileId, index? }
 * Extracts a text-based embedded subtitle track to .srt.
 * Bitmap subtitle formats are honestly reported as not extractable to text.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`subs:${clientIpFromRequest(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many requests. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  let body: { fileId?: string; index?: number } | null = null;
  try { body = await req.json(); } catch { body = null; }
  const fileId = body?.fileId;
  if (!fileId) return NextResponse.json({ error: 'fileId is required.' }, { status: 400 });

  const row = await db.mediaFile.findUnique({ where: { id: fileId } });
  if (!row) return NextResponse.json({ error: 'Source file not found — it may have expired.' }, { status: 404 });

  await ensureStorageDirs();
  startStorageSweeper();

  let streams;
  try {
    streams = await findSubtitleStreams(absolutePathFor(row));
  } catch {
    return NextResponse.json({ error: 'Could not analyze the file.' }, { status: 422 });
  }
  if (streams.length === 0) {
    return NextResponse.json(
      { error: 'This file has no embedded subtitle tracks. If subtitles come from a separate .srt file, you can edit it with the Subtitle tools instead.' },
      { status: 404 }
    );
  }

  const stream = body?.index != null ? streams.find((s) => s.index === body?.index) : streams[0];
  if (!stream) return NextResponse.json({ error: 'Selected subtitle track not found.' }, { status: 404 });
  if (BITMAP_SUBTITLES.has(stream.codec)) {
    return NextResponse.json(
      { error: `Track #${stream.index} is a bitmap subtitle format (${stream.codec}); text extraction is not possible for it.` },
      { status: 415 }
    );
  }

  const outPath = path.join('/tmp', `subs-${Date.now()}.srt`);
  const res = await runFfmpeg([
    '-i', absolutePathFor(row),
    '-map', `0:${stream.index}`,
    outPath,
  ], { timeoutMs: 60_000 }).run;

  if (res.code !== 0) {
    await fs.unlink(outPath).catch(() => undefined);
    return NextResponse.json({ error: 'Subtitle extraction failed — the track may be corrupted or non-text.' }, { status: 422 });
  }

  const stat = await fs.stat(outPath);
  const buf = await fs.readFile(outPath);
  await fs.unlink(outPath).catch(() => undefined);

  // store result
  const storedName = `${crypto.randomUUID()}.srt`;
  const { RESULTS_DIR } = await import('@/lib/storage');
  await fs.writeFile(`${RESULTS_DIR}/${storedName}`, buf);
  const record = await registerStoredFile({
    kind: 'result',
    storedName,
    originalName: row.originalName.replace(/\.[^.]+$/, '') + `.${stream.language}.srt`,
    sizeBytes: stat.size,
    mime: 'application/x-subrip',
    operation: 'subtitle-extract',
  });

  return NextResponse.json({
    file: record,
    availableTracks: streams,
  });
}
