import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { db } from '@/lib/db';
import { absolutePathFor, sanitizeFileName } from '@/lib/storage';

export const runtime = 'nodejs';

function toWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
}

/**
 * Serve a stored media file. `?inline=1` renders in the browser (preview),
 * otherwise it downloads with a proper filename.
 * Supports HTTP Range requests so <video>/<audio> elements can seek.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await db.mediaFile.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: 'File not found — it may have expired and been automatically deleted.' }, { status: 404 });
  }

  const abs = absolutePathFor(row);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return NextResponse.json({ error: 'File data is no longer available on disk.' }, { status: 410 });
  }

  const downloadName = sanitizeFileName(row.originalName || 'media');
  const inline = req.nextUrl.searchParams.get('inline') === '1';
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${downloadName.replace(/"/g, '')}"`;
  const commonHeaders: Record<string, string> = {
    'Content-Type': row.mime || 'application/octet-stream',
    'Content-Disposition': disposition,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  };

  const rangeHeader = req.headers.get('range');
  if (rangeHeader) {
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      if (Number.isNaN(start) || start > end || start >= stat.size) {
        return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      }
      return new NextResponse(toWebStream(createReadStream(abs, { start, end })), {
        status: 206,
        headers: {
          ...commonHeaders,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': String(end - start + 1),
        },
      });
    }
  }

  return new NextResponse(toWebStream(createReadStream(abs)), {
    status: 200,
    headers: { ...commonHeaders, 'Content-Length': String(stat.size) },
  });
}
