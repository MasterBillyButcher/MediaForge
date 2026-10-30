import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { sanitizeFileName, getExtension, isAllowedUploadName, mimeFromName, saveStreamToFile, registerStoredFile, ensureStorageDirs, startStorageSweeper, MAX_UPLOAD_BYTES } from '@/lib/storage';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';
import type { ImageOps } from '@/lib/types';

export const runtime = 'nodejs';

const OUTPUT_MIME: Record<string, string> = {
  png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif',
  tiff: 'image/tiff', gif: 'image/gif',
};

/**
 * POST /api/media/image?name=...&ops=...
 * Real image processing with sharp: rotate, flip, crop, resize, format
 * conversion, compression. The processed file is registered with a TTL and
 * its record is returned.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`image:${clientIpFromRequest(req)}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many requests. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  const name = sanitizeFileName(req.nextUrl.searchParams.get('name') ?? 'image.png');
  if (!isAllowedUploadName(name)) {
    return NextResponse.json({ error: 'Unsupported image file type.' }, { status: 415 });
  }
  const opsParam = req.nextUrl.searchParams.get('ops');
  let ops: ImageOps = {};
  if (opsParam) {
    try {
      ops = JSON.parse(opsParam) as ImageOps;
    } catch {
      return NextResponse.json({ error: 'Invalid ops parameter.' }, { status: 400 });
    }
  }

  await ensureStorageDirs();
  startStorageSweeper();

  // save upload to temp location first
  const tmpId = randomUUID();
  const srcExt = getExtension(name);
  const tmpPath = path.join('/tmp', `imgproc-${tmpId}.${srcExt || 'png'}`);
  let sizeBytes: number;
  try {
    sizeBytes = await saveStreamToFile(req.body!, tmpPath, MAX_UPLOAD_BYTES);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => undefined);
    const msg = err instanceof Error ? err.message : '';
    if (msg.startsWith('FILE_TOO_LARGE')) {
      return NextResponse.json({ error: 'Image exceeds the 250 MB limit.' }, { status: 413 });
    }
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 });
  }

  try {
    let pipeline = sharp(tmpPath, { failOn: 'error' });
    const meta = await pipeline.metadata();

    if (ops.rotate && ops.rotate > 0) pipeline = pipeline.rotate(ops.rotate);
    if (ops.flipV) pipeline = pipeline.flip();
    if (ops.flipH) pipeline = pipeline.flop();
    if (ops.crop) {
      const { left, top, width, height } = ops.crop;
      if (width <= 0 || height <= 0 || left < 0 || top < 0) throw new Error('Invalid crop rectangle.');
      pipeline = pipeline.extract({
        left: Math.round(left), top: Math.round(top),
        width: Math.min(Math.round(width), meta.width ?? width),
        height: Math.min(Math.round(height), meta.height ?? height),
      });
    }
    if (ops.grayscale) pipeline = pipeline.grayscale();
    if (ops.resize && (ops.resize.width || ops.resize.height)) {
      pipeline = pipeline.resize({
        width: ops.resize.width ? Math.max(1, Math.round(ops.resize.width)) : undefined,
        height: ops.resize.height ? Math.max(1, Math.round(ops.resize.height)) : undefined,
        fit: ops.resize.fit ?? 'inside',
        withoutEnlargement: false,
        background: ops.resize.background ?? '#00000000',
      });
    }

    const fmt = ops.format && OUTPUT_MIME[ops.format] ? ops.format : (srcExt && OUTPUT_MIME[srcExt] ? (srcExt === 'jpg' ? 'jpeg' : srcExt) : 'png');
    const quality = Math.min(100, Math.max(1, Math.round(ops.quality ?? 85)));
    switch (fmt) {
      case 'jpeg': pipeline = pipeline.jpeg({ quality, mozjpeg: true }); break;
      case 'webp': pipeline = pipeline.webp({ quality }); break;
      case 'avif': pipeline = pipeline.avif({ quality }); break;
      case 'tiff': pipeline = pipeline.tiff({ quality }); break;
      case 'gif': pipeline = pipeline.gif(); break;
      case 'png':
      default: pipeline = pipeline.png({ compressionLevel: Math.round((quality / 100) * 9) }); break;
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    const storedName = `${randomUUID()}.${fmt === 'jpeg' ? 'jpg' : fmt}`;
    const destPath = path.join('/tmp', `imgres-${storedName}`);
    await fs.writeFile(destPath, data);
    // move to results dir
    const { RESULTS_DIR } = await import('@/lib/storage');
    const finalPath = path.join(RESULTS_DIR, storedName);
    await fs.rename(destPath, finalPath).catch(async () => {
      await fs.copyFile(destPath, finalPath);
      await fs.unlink(destPath).catch(() => undefined);
    });

    const outName = name.replace(/\.[^.]+$/, '') + `-processed.${fmt === 'jpeg' ? 'jpg' : fmt}`;
    const record = await registerStoredFile({
      kind: 'result',
      storedName,
      originalName: sanitizeFileName(outName),
      sizeBytes: info.size,
      mime: OUTPUT_MIME[fmt],
      meta: {
        duration: 0, width: info.width, height: info.height, fps: 0,
        videoCodec: null, audioCodec: null, hasVideo: false, hasAudio: false,
        bitrate: 0, sizeBytes: info.size, format: fmt,
      },
      operation: 'image-process',
    });

    return NextResponse.json({ file: record, originalSize: sizeBytes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Image processing failed — the file may be corrupted.' },
      { status: 422 }
    );
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}
