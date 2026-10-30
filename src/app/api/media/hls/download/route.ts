import { NextRequest, NextResponse } from 'next/server';
import { checkPublicHttpUrl } from '@/lib/media/url';
import { HLS_UA, availableDiskBytes, validateStreamUrl } from '@/lib/media/hls';
import { enqueueFfmpegJob } from '@/lib/media/job-manager';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';
import { sanitizeFileName, mimeFromName } from '@/lib/storage';
import type { HlsOutputFormat } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID_FORMATS: HlsOutputFormat[] = ['mp4', 'mkv', 'ts', 'mp3', 'wav'];

/**
 * POST /api/media/hls/download
 * {
 *   url: string       // media playlist URL (or master variant URL)
 *   audioUrl?: string // separate (unmuted) audio-only playlist to mux in
 *   format: 'mp4' | 'mkv' | 'ts' | 'mp3' | 'wav'
 *   title?: string
 *   duration?: number // seconds, for real progress reporting
 * }
 *
 * The stream is downloaded by ffmpeg (native HLS demuxer, stream copy where
 * possible) inside the job queue with real progress parsed from ffmpeg.
 * A result file is registered with a TTL and also written to download history.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`hls-dl:${clientIpFromRequest(req)}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many downloads. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  let body: {
    url?: string; audioUrl?: string; format?: string; title?: string; duration?: number;
    maxDurationSec?: number; estimatedBytes?: number;
  } | null = null;
  try { body = await req.json(); } catch { body = null; }

  const raw = (body?.url ?? '').trim();
  if (!raw) return NextResponse.json({ error: 'Missing stream URL.' }, { status: 400 });
  const format = (body?.format ?? 'mp4') as HlsOutputFormat;
  if (!VALID_FORMATS.includes(format)) {
    return NextResponse.json({ error: `Unsupported format "${format}".` }, { status: 400 });
  }

  const videoCheck = await validateStreamUrl(raw);
  if (!videoCheck.ok) return NextResponse.json({ error: videoCheck.error }, { status: 400 });

  let audioUrl: string | null = null;
  if (body?.audioUrl && body.audioUrl.trim()) {
    const audioCheck = await checkPublicHttpUrl(body.audioUrl.trim());
    if (!audioCheck.ok) return NextResponse.json({ error: `Audio track: ${audioCheck.error}` }, { status: 400 });
    audioUrl = audioCheck.url!.toString();
  }

  const duration = Number(body?.duration);
  const maxDurationSec = Number(body?.maxDurationSec);
  const capSeconds = Number.isFinite(maxDurationSec) && maxDurationSec >= 1
    ? Math.min(maxDurationSec, 86_400)
    : null;
  const sourceDuration = Number.isFinite(duration) && duration > 0 ? duration : capSeconds ?? 0.001;
  const totalDuration = capSeconds ? Math.min(sourceDuration, capSeconds) : sourceDuration;
  const titleBase = sanitizeFileName((body?.title ?? '').trim() || 'stream').slice(0, 80) || 'stream';

  // honest disk-space pre-check when an estimate is available
  const estimate = Number(body?.estimatedBytes);
  if (Number.isFinite(estimate) && estimate > 0) {
    const available = await availableDiskBytes();
    if (available != null && estimate > available * 0.85) {
      const needGb = (estimate / 1024 ** 3).toFixed(1);
      const freeGb = (available / 1024 ** 3).toFixed(1);
      return NextResponse.json(
        { error: `This download needs about ${needGb} GB but only ${freeGb} GB is free on the server. Pick a lower quality, or limit the duration.` },
        { status: 507 }
      );
    }
  }

  const ext = format;
  const audioMap = audioUrl ? '1:a:0' : '0:a:0';

  const buildArgs = ({ filePath }: { filePath: string }): string[] => {
    const args: string[] = [];
    const inputOpts = [
      '-user_agent', HLS_UA,
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '10',
      '-allowed_extensions', 'ALL',
    ];

    args.push(...inputOpts, '-i', videoCheck.url!.toString());
    if (audioUrl) args.push(...inputOpts, '-i', audioUrl);

    switch (format) {
      case 'mp3':
        args.push('-vn', '-map', audioMap, '-c:a', 'libmp3lame', '-b:a', '192k');
        break;
      case 'wav':
        args.push('-vn', '-map', audioMap, '-c:a', 'pcm_s16le');
        break;
      case 'mp4':
        args.push('-map', '0:v:0', '-map', audioMap, '-c', 'copy', '-movflags', '+faststart');
        break;
      case 'mkv':
        args.push('-map', '0:v:0', '-map', audioMap, '-c', 'copy');
        break;
      case 'ts':
        args.push('-map', '0:v:0', '-map', audioMap, '-c', 'copy', '-f', 'mpegts');
        break;
    }

    args.push('-avoid_negative_ts', 'make_zero');
    if (capSeconds) args.push('-t', String(Math.floor(capSeconds)));
    args.push(filePath);
    return args;
  };

  const job = enqueueFfmpegJob({
    type: 'hls',
    label: titleBase,
    totalDuration,
    resultExt: ext,
    operation: `hls:${format}`,
    sourceUrl: raw,
    buildArgs,
  });

  return NextResponse.json({
    job,
    mime: mimeFromName(`result.${ext}`),
  });
}
