import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { absolutePathFor, ensureStorageDirs, startStorageSweeper } from '@/lib/storage';
import { enqueueFfmpegJob } from '@/lib/media/job-manager';
import { probeMedia } from '@/lib/media/ffmpeg';
import { buildToolArgs, buildMergeArgs, toolExtension, type ToolParams } from '@/lib/media/tools';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';
import type { ProbeResult } from '@/lib/types';

export const runtime = 'nodejs';

const ALLOWED_OPS = new Set([
  'video-trim', 'video-resize', 'video-rotate', 'video-flip', 'video-crop', 'video-speed',
  'video-reverse', 'video-mute', 'video-compress', 'video-watermark', 'gif-maker', 'video-thumbnail',
  'audio-cut', 'audio-convert', 'audio-compress', 'audio-volume', 'audio-speed', 'audio-extract',
  'video-merge', 'audio-merge',
]);

/**
 * POST /api/media/tool — one-click tool operations.
 * All ops run as queued ffmpeg jobs with real progress. `video-thumbnail`
 * is returned synchronously as PNG bytes (it is a single-frame extraction).
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`tool:${clientIpFromRequest(req)}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many requests. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  let body: { op?: string; params?: Partial<ToolParams> } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });

  const params = (body.params ?? {}) as Partial<ToolParams>;
  const op = body.op ?? params.op;
  if (!op || !ALLOWED_OPS.has(op)) {
    return NextResponse.json({ error: `Unknown operation "${op}".` }, { status: 400 });
  }
  // tools.ts builders expect op inside params
  const fullParams: ToolParams = { ...params, op } as ToolParams;
  const fileIds = Array.isArray(fullParams.fileIds) ? fullParams.fileIds.slice(0, 10) : [];
  if (fileIds.length === 0) {
    return NextResponse.json({ error: 'No source file specified.' }, { status: 400 });
  }

  await ensureStorageDirs();
  startStorageSweeper();

  // resolve + probe all source files
  const rows: Array<{ id: string; kind: string; originalName: string; storedName: string; sizeBytes: number; mime: string; metaJson: string | null; operation: string | null; sourceUrl: string | null; sourceType: string | null; createdAt: Date; expiresAt: Date | null }> = [];
  for (const id of fileIds) {
    const row = await db.mediaFile.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ error: 'A source file has expired. Please re-upload your files.' }, { status: 404 });
    }
    rows.push(row);
  }

  const probes: ProbeResult[] = [];
  for (const row of rows) {
    if (row.metaJson) {
      try { probes.push(JSON.parse(row.metaJson) as ProbeResult); continue; } catch { /* re-probe */ }
    }
    try {
      const stat = await fs.stat(absolutePathFor(row));
      probes.push(await probeMedia(absolutePathFor(row), stat.size));
    } catch {
      return NextResponse.json({ error: `Could not analyze "${row.originalName}".` }, { status: 422 });
    }
  }

  try {
    // ---- synchronous single-frame thumbnail ---------------------------------
    if (op === 'video-thumbnail') {
      const probe = probes[0];
      if (!probe.hasVideo) throw new Error('Thumbnails require a video file.');
      const { buildToolArgs: build } = await import('@/lib/media/tools');
      const tmpOut = path.join('/tmp', `thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
      const { args } = build({ params: fullParams, inputPath: absolutePathFor(rows[0]), outputPath: tmpOut, probe });
      const { runFfmpeg } = await import('@/lib/media/ffmpeg');
      const res = await runFfmpeg(args, { timeoutMs: 20_000 }).run;
      if (res.code !== 0) throw new Error('Thumbnail extraction failed — the video may be corrupted.');
      const buf = await fs.readFile(tmpOut);
      await fs.unlink(tmpOut).catch(() => undefined);
      return new NextResponse(new Uint8Array(buf), {
        headers: { 'Content-Type': 'image/png', 'Content-Disposition': `inline; filename="thumbnail.png"` },
      });
    }

    // ---- queued jobs ---------------------------------------------------------
    const isMerge = op === 'video-merge' || op === 'audio-merge';
    const firstProbe = probes[0];
    const ext = isMerge
      ? op === 'video-merge' ? 'mp4' : 'm4a'
      : toolExtension(fullParams, firstProbe);

    // watermarks may reference an image file as an extra input
    let extraInputPaths: string[] = [];
    if (op === 'video-watermark' && params.watermark?.type === 'image' && params.watermark.fileId) {
      const wmRow = await db.mediaFile.findUnique({ where: { id: params.watermark.fileId } });
      if (!wmRow) throw new Error('The watermark image has expired — please re-select it.');
      extraInputPaths = [absolutePathFor(wmRow)];
    }

    const job = enqueueFfmpegJob({
      type: op,
      label: rows[0].originalName,
      totalDuration: Math.max(0.1, (isMerge ? probes.reduce((a, p) => a + (p.duration || 0), 0) : firstProbe.duration) || 1),
      resultExt: ext,
      operation: op,
      buildArgs: ({ filePath }) => {
        if (isMerge) {
          return buildMergeArgs({
            inputPaths: rows.map((r) => absolutePathFor(r)),
            outputPath: filePath,
            probes,
            videoMerge: op === 'video-merge',
            bitrateKbps: params.bitrateKbps,
          }).args;
        }
        return buildToolArgs({
          params: fullParams,
          inputPath: absolutePathFor(rows[0]),
          outputPath: filePath,
          probe: firstProbe,
          extraInputPaths,
        }).args;
      },
    });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not start the operation.' },
      { status: 400 }
    );
  }
}
