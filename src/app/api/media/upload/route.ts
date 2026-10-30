import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  UPLOADS_DIR, ensureStorageDirs, sanitizeFileName, getExtension, isAllowedUploadName,
  mimeFromName, saveStreamToFile, registerStoredFile, MAX_UPLOAD_BYTES, startStorageSweeper,
} from '@/lib/storage';
import { probeMedia } from '@/lib/media/ffmpeg';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';
import type { ProbeResult } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * Streaming file upload.
 * The client sends the raw file as the request body with `?name=` query.
 * (XHR upload progress works with raw bodies and avoids multipart buffering.)
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`upload:${clientIpFromRequest(req)}`, { limit: 40, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many uploads. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  const nameRaw = req.nextUrl.searchParams.get('name') ?? '';
  const name = sanitizeFileName(nameRaw);
  if (!name || name === 'file') {
    return NextResponse.json({ error: 'Missing file name (?name= parameter).' }, { status: 400 });
  }
  if (!isAllowedUploadName(name)) {
    return NextResponse.json(
      { error: `Unsupported file type ".${getExtension(name)}". Allowed: video, audio, image and subtitle files.` },
      { status: 415 }
    );
  }

  await ensureStorageDirs();
  startStorageSweeper();

  const id = randomUUID();
  const ext = getExtension(name);
  const storedName = `${id}.${ext}`;
  const destPath = path.join(UPLOADS_DIR, storedName);

  let sizeBytes: number;
  try {
    sizeBytes = await saveStreamToFile(req.body!, destPath, MAX_UPLOAD_BYTES);
  } catch (err) {
    await fs.unlink(destPath).catch(() => undefined);
    const msg = err instanceof Error ? err.message : '';
    if (msg.startsWith('FILE_TOO_LARGE')) {
      return NextResponse.json(
        { error: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB upload limit.` },
        { status: 413 }
      );
    }
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }

  if (sizeBytes === 0) {
    await fs.unlink(destPath).catch(() => undefined);
    return NextResponse.json({ error: 'Uploaded file is empty.' }, { status: 400 });
  }

  // Probe media metadata (images/subtitles may fail to probe — that's fine)
  let meta: ProbeResult | null = null;
  const mime = mimeFromName(name);
  if (!['srt', 'vtt', 'ass'].includes(ext)) {
    try {
      meta = await probeMedia(destPath, sizeBytes);
    } catch {
      // not a media file ffmpeg understands
      if (!mime.startsWith('image/')) {
        await fs.unlink(destPath).catch(() => undefined);
        return NextResponse.json(
          { error: `Could not analyze "${name}". It may be corrupted or not a real media file.` },
          { status: 422 }
        );
      }
    }
  }

  const record = await registerStoredFile({
    kind: 'upload',
    storedName,
    originalName: name,
    sizeBytes,
    mime,
    meta,
  });

  return NextResponse.json({ file: record });
}
