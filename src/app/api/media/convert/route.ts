import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { absolutePathFor } from '@/lib/storage';
import { buildConvertArgs } from '@/lib/media/ffmpeg';
import { enqueueFfmpegJob } from '@/lib/media/job-manager';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';
import { startStorageSweeper } from '@/lib/storage';
import type { ConvertSettings, ProbeResult } from '@/lib/types';

export const runtime = 'nodejs';

const VIDEO_FORMATS = ['mp4', 'webm', 'mov', 'mkv', 'gif'];
const AUDIO_FORMATS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'];
const RESOLUTIONS = ['original', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];

/** POST /api/media/convert — start a real conversion job. */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`convert:${clientIpFromRequest(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many conversion requests. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  let body: { fileId?: string; settings?: ConvertSettings } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });

  const { fileId, settings } = body;
  if (!fileId || !settings) {
    return NextResponse.json({ error: 'fileId and settings are required.' }, { status: 400 });
  }
  const fmt = settings.format;
  if (!VIDEO_FORMATS.includes(fmt as string) && !AUDIO_FORMATS.includes(fmt as string)) {
    return NextResponse.json({ error: `Unsupported output format "${fmt}".` }, { status: 400 });
  }
  if (settings.resolution && !RESOLUTIONS.includes(settings.resolution)) {
    return NextResponse.json({ error: 'Invalid resolution setting.' }, { status: 400 });
  }
  if (settings.videoBitrateKbps != null && (settings.videoBitrateKbps < 100 || settings.videoBitrateKbps > 100_000)) {
    return NextResponse.json({ error: 'Video bitrate must be between 100 and 100000 kbps.' }, { status: 400 });
  }
  if (settings.audioBitrateKbps != null && (settings.audioBitrateKbps < 32 || settings.audioBitrateKbps > 320)) {
    return NextResponse.json({ error: 'Audio bitrate must be between 32 and 320 kbps.' }, { status: 400 });
  }

  const row = await db.mediaFile.findUnique({ where: { id: fileId } });
  if (!row) {
    return NextResponse.json({ error: 'Source file not found — it may have expired. Please re-upload.' }, { status: 404 });
  }

  let meta: ProbeResult | null = null;
  if (row.metaJson) {
    try { meta = JSON.parse(row.metaJson) as ProbeResult; } catch { meta = null; }
  }
  if (!meta) {
    return NextResponse.json({ error: 'Source file metadata is missing. Please re-upload the file.' }, { status: 422 });
  }

  try {
    startStorageSweeper();
    const ext = AUDIO_FORMATS.includes(fmt as string) ? fmt : fmt;
    const job = enqueueFfmpegJob({
      type: 'convert',
      label: row.originalName,
      totalDuration: meta.duration || 1,
      resultExt: ext,
      operation: `convert:${fmt}${settings.mode && settings.mode !== 'convert' ? `:${settings.mode}` : ''}`,
      buildArgs: ({ filePath }) =>
        buildConvertArgs({
          inputPath: absolutePathFor(row),
          outputPath: filePath,
          probe: meta!,
          settings,
        }).args,
    });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not start the conversion.' },
      { status: 400 }
    );
  }
}
