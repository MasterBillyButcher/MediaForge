import { spawn } from 'child_process';
import type { ConvertSettings } from '@/lib/types';
import type { ProbeResult } from '@/lib/types';

/**
 * Thin, dependency-free FFmpeg / FFprobe wrapper.
 * All child processes are spawned here — API routes never block on encoding
 * directly; long jobs go through the job manager which calls `runFfmpeg`.
 */

export interface RunOptions {
  timeoutMs?: number;
  onProgress?: (timeSeconds: number, speed: string | null) => void;
  /** total duration used by callers to compute percent (informational) */
  totalSeconds?: number;
}

export interface RunResult {
  code: number;
  stderrTail: string;
  timedOut: boolean;
}

export function runFfmpeg(args: string[], opts: RunOptions = {}): { run: Promise<RunResult>; kill: () => void } {
  // `-progress pipe:2` sends machine-readable progress (out_time_ms=..., speed=...)
  // to stderr where the parser below reads it — this works for every job.
  const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:2', '-stats_period', '0.5', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs)
    : null;

  let stderrBuf = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrBuf = (stderrBuf + chunk).slice(-16_000);
    if (opts.onProgress) {
      const timeMatch = /out_time_ms=(\d+)/g.exec(chunk);
      const speedMatch = /speed=\s*([\d.]+)x/.exec(chunk);
      if (timeMatch) {
        const seconds = Number(timeMatch[1]) / 1_000_000;
        opts.onProgress(seconds, speedMatch ? `${speedMatch[1]}x` : null);
      }
    }
  });

  const run = new Promise<RunResult>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stderrTail: stderrBuf, timedOut });
    });
  });

  return { run, kill: () => child.kill('SIGKILL') };
}

// ---------------------------------------------------------------------------
// FFprobe
// ---------------------------------------------------------------------------

export async function ffprobeJson(path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format', '-show_streams',
      path,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited with ${code}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
    setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ffprobe timeout')); }, 30_000).unref?.();
  });
}

export async function probeMedia(filePath: string, sizeBytes: number): Promise<ProbeResult> {
  const data = (await ffprobeJson(filePath)) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const format = data.format ?? {};

  let fps = 0;
  if (video) {
    const raw = String(video.avg_frame_rate ?? video.r_frame_rate ?? '0/1');
    const [num, den] = raw.split('/').map(Number);
    if (num > 0 && den > 0) fps = Math.round((num / den) * 100) / 100;
  }

  return {
    duration: Number(format.duration ?? video?.['duration'] ?? 0) || 0,
    width: Number(video?.['width'] ?? 0) || 0,
    height: Number(video?.['height'] ?? 0) || 0,
    fps,
    videoCodec: video ? String(video.codec_name) : null,
    audioCodec: audio ? String(audio.codec_name) : null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    bitrate: Number(format.bit_rate ?? 0) || 0,
    sizeBytes,
    format: String(format.format_name ?? 'unknown'),
  };
}

/** True when the file contains a subtitle stream that can be extracted. */
export async function findSubtitleStreams(filePath: string): Promise<Array<{ index: number; codec: string; language: string }>> {
  const data = (await ffprobeJson(filePath)) as { streams?: Array<Record<string, unknown>> };
  return (data.streams ?? [])
    .filter((s) => s.codec_type === 'subtitle')
    .map((s) => ({
      index: Number(s.index),
      codec: String(s.codec_name),
      language: String(s.tags?.['language'] ?? 'und'),
    }));
}

// ---------------------------------------------------------------------------
// Conversion argument builder — every mapping here produces a REAL format
// ---------------------------------------------------------------------------

const RESOLUTION_HEIGHT: Record<string, number> = {
  '2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720,
  '480p': 480, '360p': 360, '240p': 240, '144p': 144,
};

const QUALITY_CRF: Record<string, number> = { high: 18, balanced: 23, compressed: 30 };

function scaleFilter(resolution: string | undefined): string {
  if (!resolution || resolution === 'original') return '';
  const h = RESOLUTION_HEIGHT[resolution];
  if (!h) return '';
  return `scale=-2:'min(${h},ih)':flags=bicubic`;
}

export interface BuildArgsResult {
  args: string[];
  estimatedDuration: number; // used for progress percent
}

/** Build ffmpeg args for a conversion job. Throws on invalid combos. */
export function buildConvertArgs(opts: {
  inputPath: string;
  outputPath: string;
  probe: ProbeResult;
  settings: ConvertSettings;
}): BuildArgsResult {
  const { inputPath, outputPath, probe, settings } = opts;
  const fmt = settings.format;
  const mode = settings.mode ?? 'convert';
  const quality = settings.quality ?? 'balanced';

  const isAudioFormat = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(fmt);
  const isGifFormat = fmt === 'gif';

  // ---- validation (fail loudly, never fake) --------------------------------
  if ((mode === 'extract-audio' || isAudioFormat) && !probe.hasAudio) {
    throw new Error('This file has no audio stream, so audio extraction is not possible.');
  }
  if (!isAudioFormat && mode !== 'extract-audio' && !probe.hasVideo && !isGifFormat) {
    throw new Error('This file has no video stream — choose an audio output format instead.');
  }

  const args: string[] = [];
  let trimApplied = false;
  if (typeof settings.trimStart === 'number' && settings.trimStart > 0) {
    args.push('-ss', settings.trimStart.toFixed(3));
    trimApplied = true;
  }
  args.push('-i', inputPath);
  const sourceDuration = probe.duration || 0;
  let effectiveDuration = sourceDuration;
  if (typeof settings.trimEnd === 'number' && settings.trimEnd > 0 && settings.trimEnd > (settings.trimStart ?? 0)) {
    args.push('-t', (settings.trimEnd - (settings.trimStart ?? 0)).toFixed(3));
    effectiveDuration = settings.trimEnd - (settings.trimStart ?? 0);
    trimApplied = true;
  }

  const filters: string[] = [];
  const scale = scaleFilter(settings.resolution);
  if (scale && mode !== 'extract-audio' && !isAudioFormat) filters.push(scale);
  if (settings.fps && settings.fps !== 'original' && !isAudioFormat && mode !== 'extract-audio') {
    filters.push(`fps=${settings.fps}`);
  }

  const audioArgs: string[] = [];
  const audioBitrate = settings.audioBitrateKbps ? String(settings.audioBitrateKbps) + 'k' : null;
  const sampleRate = settings.audioSampleRate && settings.audioSampleRate !== 'original' ? String(settings.audioSampleRate) : null;

  const pushAudioCodec = () => {
    switch (fmt) {
      case 'mp3': audioArgs.push('-c:a', 'libmp3lame'); audioArgs.push('-b:a', audioBitrate ?? '192k'); break;
      case 'wav': audioArgs.push('-c:a', 'pcm_s16le'); break;
      case 'm4a': case 'aac': audioArgs.push('-c:a', 'aac'); audioArgs.push('-b:a', audioBitrate ?? '192k'); break;
      case 'flac': audioArgs.push('-c:a', 'flac'); break;
      case 'ogg': audioArgs.push('-c:a', 'libvorbis'); audioArgs.push('-b:a', audioBitrate ?? '160k'); break;
      default: audioArgs.push('-c:a', 'aac'); audioArgs.push('-b:a', audioBitrate ?? '160k');
    }
    if (sampleRate) audioArgs.push('-ar', sampleRate);
  };

  const crf = QUALITY_CRF[quality] ?? 23;

  // ---- container / codec selection ------------------------------------------
  switch (fmt) {
    case 'mp4':
    case 'mov':
    case 'mkv': {
      if (mode === 'extract-audio') {
        filters.length = 0;
        args.push('-vn');
        pushAudioCodec();
      } else {
        if (mode === 'remove-audio') {
          args.push('-an');
        } else {
          pushAudioCodec();
        }
        if (filters.length > 0) args.push('-vf', filters.join(','));
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p');
        if (fmt === 'mp4' || fmt === 'mov') args.push('-movflags', '+faststart');
      }
      break;
    }
    case 'webm': {
      if (mode === 'extract-audio') {
        filters.length = 0;
        args.push('-vn', '-c:a', 'libopus', '-b:a', audioBitrate ?? '128k');
      } else {
        if (mode === 'remove-audio') {
          args.push('-an');
        } else {
          args.push('-c:a', 'libopus', '-b:a', audioBitrate ?? '128k');
        }
        if (filters.length > 0) args.push('-vf', filters.join(','));
        args.push('-c:v', 'libvpx-vp9', '-crf', String(crf + 7), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4');
      }
      break;
    }
    case 'gif': {
      const gifChain = [
        ...filters,
        `fps=${settings.fps && settings.fps !== 'original' ? settings.fps : 12}`,
        `scale=${gifWidth(settings)}`,
        'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3[out]',
      ].join(',');
      args.push('-filter_complex', gifChain, '-map', '[out]', '-loop', '0');
      break;
    }
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'aac':
    case 'flac':
    case 'ogg': {
      filters.length = 0;
      args.push('-vn');
      pushAudioCodec();
      break;
    }
    default:
      throw new Error(`Unsupported target format: ${fmt}`);
  }

  if (settings.normalizeAudio && probe.hasAudio && fmt !== 'gif') {
    args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
  }

  if (mode === 'compress' && !isAudioFormat && fmt !== 'gif') {
    const idx = args.indexOf('-crf');
    if (idx >= 0) args[idx + 1] = '32';
  }

  args.push(outputPath);
  return { args, estimatedDuration: trimApplied ? effectiveDuration : sourceDuration };
}

function gifWidth(settings: ConvertSettings): string {
  const res = settings.resolution;
  const map: Record<string, number> = { '480p': 854, '360p': 640, '240p': 426, '144p': 256 };
  if (res && map[res]) return `'min(${map[res]},iw)':-1:flags=lanczos`;
  return `'min(640,iw)':-1:flags=lanczos`;
}
