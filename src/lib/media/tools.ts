import type { ProbeResult } from '@/lib/types';

/**
 * Argument builders for the "additional tools" one-click operations
 * (trim, merge, resize, rotate, speed, reverse, mute, watermark, GIF maker,
 * audio cutter/merger/compressor/volume/speed...). Every op maps to a real
 * ffmpeg invocation.
 */

export interface ToolParams {
  op: string;
  fileIds: string[]; // one for most ops, 2+ for merges
  // timing
  start?: number;
  end?: number;
  // transform
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill';
  angle?: 90 | 180 | 270;
  direction?: 'clockwise' | 'counterclockwise';
  flipH?: boolean;
  flipV?: boolean;
  crop?: { x: number; y: number; w: number; h: number }; // normalized
  speed?: number; // 0.25..4
  gainDb?: number; // audio volume change
  bitrateKbps?: number;
  format?: string; // target audio format
  fps?: number; // gif maker
  gifWidth?: number;
  time?: number; // thumbnail time
  watermark?: {
    type: 'text' | 'image';
    text?: string;
    size?: number; // relative to height, e.g. 0.06
    x?: number; // normalized 0..1
    y?: number;
    color?: string;
    opacity?: number;
    fileId?: string; // image watermark (uploaded separately)
    scale?: number; // image width relative to video width
  };
}

const RES_H: Record<string, number> = {
  '2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360, '240p': 240, '144p': 144,
};

export function toolExtension(params: ToolParams, probe: ProbeResult | null): string {
  switch (params.op) {
    case 'audio-extract':
    case 'audio-convert':
      return params.format && ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(params.format) ? params.format : 'mp3';
    case 'gif-maker':
      return 'gif';
    case 'video-thumbnail':
      return 'png';
    case 'audio-cut':
    case 'audio-merge':
    case 'audio-compress':
    case 'audio-volume':
    case 'audio-speed':
      return probe?.format && /mp3|wav|aac|flac|ogg|opus|m4a/.test(probe.format)
        ? (probe.audioCodec === 'mpeg' ? 'mp3' : probe.audioCodec === 'vorbis' ? 'ogg' : probe.audioCodec === 'opus' ? 'opus' : probe.audioCodec === 'flac' ? 'flac' : 'm4a')
        : 'm4a';
    case 'subtitle-extract':
      return 'srt';
    default:
      return 'mp4';
  }
}

/**
 * Build args for single-file ops. Throws Error with a user-safe message.
 */
export function buildToolArgs(opts: {
  params: ToolParams;
  inputPath: string;
  outputPath: string;
  probe: ProbeResult;
  extraInputPaths?: string[]; // e.g. watermark image
}): { args: string[]; estimatedDuration: number } {
  const { params, inputPath, outputPath, probe, extraInputPaths = [] } = opts;
  const args: string[] = [];
  let duration = probe.duration || 1;

  const ensureVideo = () => {
    if (!probe.hasVideo) throw new Error('This operation requires a video file.');
  };
  const ensureAudio = () => {
    if (!probe.hasAudio) throw new Error('This file has no audio stream.');
  };

  const audioCodecArgsFor = (ext: string): string[] => {
    switch (ext) {
      case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', `${params.bitrateKbps ?? 192}k`];
      case 'ogg': return ['-c:a', 'libvorbis', '-b:a', `${params.bitrateKbps ?? 160}k`];
      case 'opus': return ['-c:a', 'libopus', '-b:a', `${params.bitrateKbps ?? 128}k`];
      case 'flac': return ['-c:a', 'flac'];
      case 'wav': return ['-c:a', 'pcm_s16le'];
      default: return ['-c:a', 'aac', '-b:a', `${params.bitrateKbps ?? 192}k`];
    }
  };

  switch (params.op) {
    case 'video-trim':
    case 'audio-cut': {
      const start = Math.max(0, params.start ?? 0);
      const end = params.end != null ? Math.min(params.end, probe.duration || params.end) : undefined;
      if (end != null && end - start < 0.1) throw new Error('The selected range is too short.');
      args.push('-ss', start.toFixed(3));
      if (end != null) args.push('-t', (end - start).toFixed(3));
      args.push('-i', inputPath);
      duration = (end ?? probe.duration) - start;
      // stream copy when possible for speed, fallback handled by re-encode:
      // use re-encode for frame accuracy (honest output)
      if (probe.hasVideo) args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
      if (probe.hasAudio) args.push(...(probe.hasVideo ? ['-c:a', 'aac', '-b:a', '192k'] : audioCodecArgsFor('m4a')));
      if (!probe.hasVideo) args.push('-vn');
      if (probe.hasVideo && probe.hasAudio) args.push('-movflags', '+faststart');
      break;
    }
    case 'video-resize': {
      ensureVideo();
      args.push('-i', inputPath);
      const w = params.width && params.width > 0 ? Math.round(params.width / 2) * 2 : -2;
      const h = params.height && params.height > 0 ? Math.round(params.height / 2) * 2 : -2;
      const fit = params.fit ?? 'inside';
      if (params.width && params.height && fit === 'contain') {
        args.push('-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${Math.round(params.width / 2) * 2}:${Math.round(params.height / 2) * 2}:(ow-iw)/2:(oh-ih)/2:black`);
      } else if (params.width && params.height && fit === 'cover') {
        args.push('-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`);
      } else {
        args.push('-vf', `scale=${w}:${h}:flags=lanczos`);
      }
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p');
      if (probe.hasAudio) args.push('-c:a', 'copy');
      else args.push('-an');
      args.push('-movflags', '+faststart');
      break;
    }
    case 'video-rotate': {
      ensureVideo();
      args.push('-i', inputPath);
      const angle = params.angle ?? 90;
      const dir = params.direction === 'counterclockwise' ? 'c' : 'cw';
      if (angle === 180) args.push('-vf', 'transpose=1,transpose=1');
      else args.push('-vf', dir === 'cw' ? 'transpose=1' : 'transpose=2');
      if (params.flipH) args.push('-vf', (angle === 180 ? 'transpose=1,transpose=1,' : dir === 'cw' ? 'transpose=1,' : 'transpose=2,') + 'hflip');
      if (params.flipV && !params.flipH) args.push('-vf', (angle === 180 ? 'transpose=1,transpose=1,' : dir === 'cw' ? 'transpose=1,' : 'transpose=2,') + 'vflip');
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
      if (probe.hasAudio) args.push('-c:a', 'copy');
      else args.push('-an');
      args.push('-movflags', '+faststart');
      break;
    }
    case 'video-flip': {
      ensureVideo();
      args.push('-i', inputPath, '-vf', params.flipV ? 'vflip' : 'hflip');
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
      if (probe.hasAudio) args.push('-c:a', 'copy');
      else args.push('-an');
      args.push('-movflags', '+faststart');
      break;
    }
    case 'video-crop': {
      ensureVideo();
      args.push('-i', inputPath);
      const c = params.crop ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      const w = Math.min(1, Math.max(0.02, c.w));
      const h = Math.min(1, Math.max(0.02, c.h));
      args.push('-vf', `crop=w='iw*${w}':h='ih*${h}':x='iw*${Math.min(1 - w, Math.max(0, c.x))}':y='ih*${Math.min(1 - h, Math.max(0, c.y))}'`);
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
      if (probe.hasAudio) args.push('-c:a', 'copy');
      else args.push('-an');
      args.push('-movflags', '+faststart');
      break;
    }
    case 'video-speed':
    case 'audio-speed': {
      ensureVideo();
      const speed = Math.min(4, Math.max(0.25, params.speed ?? 1));
      args.push('-i', inputPath);
      args.push('-filter_complex', `[0:v]setpts=PTS/${speed.toFixed(4)}[v]` + (probe.hasAudio ? `;[0:a]${atempoChainStr(speed)}[a]` : ''));
      args.push('-map', '[v]');
      if (probe.hasAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '160k');
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
      args.push('-movflags', '+faststart');
      duration = probe.duration / speed;
      break;
    }
    case 'video-reverse': {
      ensureVideo();
      if (probe.duration > 120) throw new Error('Video reverse is limited to 120 seconds per clip (memory intensive).');
      args.push('-i', inputPath);
      if (probe.hasAudio) {
        args.push('-filter_complex', '[0:v]reverse[v];[0:a]areverse[a]', '-map', '[v]', '-map', '[a]');
        args.push('-c:a', 'aac', '-b:a', '160k');
      } else {
        args.push('-vf', 'reverse', '-an');
      }
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
      args.push('-movflags', '+faststart');
      break;
    }
    case 'video-mute': {
      ensureVideo();
      ensureAudio();
      args.push('-i', inputPath, '-an', '-c:v', 'copy');
      break;
    }
    case 'video-compress': {
      ensureVideo();
      args.push('-i', inputPath);
      const targetH = RES_H[params.height ? String(params.height) : ''] ?? null;
      if (targetH) args.push('-vf', `scale=-2:'min(${targetH},ih)'`);
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p');
      if (probe.hasAudio) args.push('-c:a', 'aac', '-b:a', `${params.bitrateKbps ?? 96}k`);
      else args.push('-an');
      args.push('-movflags', '+faststart');
      break;
    }
    case 'video-watermark': {
      ensureVideo();
      const wm = params.watermark;
      if (!wm) throw new Error('Watermark settings are missing.');
      args.push('-i', inputPath);
      if (extraInputPaths[0]) args.push('-i', extraInputPaths[0]);
      const size = Math.max(0.02, Math.min(0.4, wm.size ?? 0.05));
      const x = Math.min(1, Math.max(0, wm.x ?? 0.9));
      const y = Math.min(1, Math.max(0, wm.y ?? 0.9));
      const opacity = Math.min(1, Math.max(0.05, wm.opacity ?? 0.7));
      if (wm.type === 'text' && wm.text) {
        const fontsize = `h*${size.toFixed(3)}`;
        const esc = wm.text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "\\\\\\'").replace(/%/g, '\\\\%').replace(/:/g, '\\\\:').replace(/\n/g, ' ');
        const color = (wm.color ?? '#ffffff').replace('#', '0x');
        args.push('-vf', `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${esc}':fontsize=${fontsize}:fontcolor=${color}@${opacity}:x='(w-text_w)*${x}':y='(h-text_h)*${y}'`);
      } else if (wm.type === 'image' && extraInputPaths[0]) {
        const scale = Math.max(0.05, Math.min(0.8, wm.scale ?? 0.2));
        args.push('-filter_complex', `[1:v]scale=iw*${scale}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]overlay=x='(main_w-overlay_w)*${x}':y='(main_h-overlay_h)*${y}'`);
      } else {
        throw new Error('Invalid watermark configuration.');
      }
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
      if (probe.hasAudio) args.push('-c:a', 'copy');
      else args.push('-an');
      args.push('-movflags', '+faststart');
      break;
    }
    case 'gif-maker': {
      ensureVideo();
      const start = Math.max(0, params.start ?? 0);
      const end = params.end != null ? Math.min(params.end, probe.duration) : Math.min(start + 5, probe.duration);
      if (end - start > 30) throw new Error('GIF clips are limited to 30 seconds.');
      args.push('-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', inputPath);
      const fps = Math.min(20, Math.max(5, params.fps ?? 12));
      const width = Math.min(640, Math.max(120, params.gifWidth ?? 480));
      args.push(
        '-filter_complex',
        `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3[out]`,
        '-map', '[out]',
        '-loop', '0'
      );
      duration = end - start;
      break;
    }
    case 'video-thumbnail': {
      ensureVideo();
      const t = Math.max(0, Math.min(params.time ?? 0, Math.max(0, probe.duration - 0.1)));
      args.push('-ss', t.toFixed(3), '-i', inputPath, '-frames:v', '1', '-q:v', '2');
      duration = 1;
      break;
    }
    case 'audio-extract': {
      ensureAudio();
      args.push('-i', inputPath, '-vn');
      const ext = toolExtension(params, probe);
      args.push(...audioCodecArgsFor(ext === 'm4a' ? 'm4a' : ext));
      break;
    }
    case 'audio-convert': {
      ensureAudio();
      args.push('-i', inputPath, '-vn');
      args.push(...audioCodecArgsFor(toolExtension(params, probe)));
      break;
    }
    case 'audio-compress': {
      ensureAudio();
      args.push('-i', inputPath, '-vn', '-af', `loudnorm=I=-16:TP=-1.5:LRA=11`);
      args.push(...audioCodecArgsFor(toolExtension(params, probe)));
      break;
    }
    case 'audio-volume': {
      ensureAudio();
      args.push('-i', inputPath, '-vn', '-af', `volume=${Math.min(4, Math.max(0, params.gainDb ?? 0))}dB`);
      args.push(...audioCodecArgsFor(toolExtension(params, probe)));
      break;
    }
    default:
      throw new Error(`Unknown operation: ${params.op}`);
  }

  args.push('-progress', 'pipe:1', '-nostats');
  args.push(outputPath);
  return { args, estimatedDuration: duration };
}

function atempoChainStr(speed: number): string {
  const parts: string[] = [];
  let remaining = speed;
  while (remaining > 2) { parts.push('atempo=2.0'); remaining /= 2; }
  while (remaining < 0.5) { parts.push('atempo=0.5'); remaining *= 2; }
  parts.push(`atempo=${remaining.toFixed(4)}`);
  return parts.join(',');
}

/** Merge multiple files (video concat or audio concat). */
export function buildMergeArgs(opts: {
  inputPaths: string[];
  outputPath: string;
  probes: ProbeResult[];
  videoMerge: boolean;
  bitrateKbps?: number;
}): { args: string[]; estimatedDuration: number } {
  const { inputPaths, outputPath, probes, videoMerge } = opts;
  if (inputPaths.length < 2) throw new Error('Merging requires at least 2 files.');
  if (inputPaths.length > 10) throw new Error('Merging is limited to 10 files at once.');
  const args: string[] = [];
  const chains: string[] = [];
  let total = 0;

  for (const p of inputPaths) args.push('-i', p);

  if (videoMerge) {
    const ref = probes.find((p) => p.hasVideo);
    if (!ref) throw new Error('The first file must contain video for a video merge.');
    const W = ref.width && ref.width % 2 === 0 ? ref.width : (ref.width ?? 640) + 1;
    const H = ref.height && ref.height % 2 === 0 ? ref.height : (ref.height ?? 360) + 1;
    const allHaveVideo = probes.every((p) => p.hasVideo);
    if (!allHaveVideo) throw new Error('All files must contain video for a video merge.');
    const allHaveAudio = probes.every((p) => p.hasAudio);
    probes.forEach((p, i) => {
      const vf: string[] = [
        `fps=30`,
        `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`,
        'setsar=1',
        'format=yuv420p',
      ];
      chains.push(`[${i}:v]${vf.join(',')}[v${i}]`);
      if (allHaveAudio) {
        chains.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      } else {
        chains.push(`aevalsrc=0:s=44100:c=stereo:d=${(p.duration || 1).toFixed(3)}[a${i}]`);
      }
      total += p.duration || 1;
    });
    const labels = probes.map((_, i) => `[v${i}][a${i}]`).join('');
    chains.push(`${labels}concat=n=${inputPaths.length}:v=1:a=1[v][a]`);
    args.push('-filter_complex', chains.join(';'), '-map', '[v]', '-map', '[a]');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
  } else {
    // audio-only merge
    if (probes.some((p) => !p.hasAudio)) throw new Error('All files must contain audio for an audio merge.');
    probes.forEach((_, i) => {
      chains.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      total += probes[i].duration || 1;
    });
    const labels = probes.map((_, i) => `[a${i}]`).join('');
    chains.push(`${labels}concat=n=${inputPaths.length}:v=0:a=1[a]`);
    args.push('-filter_complex', chains.join(';'), '-map', '[a]');
    args.push('-c:a', 'aac', '-b:a', `${opts.bitrateKbps ?? 192}k`);
  }

  args.push('-progress', 'pipe:1', '-nostats');
  args.push(outputPath);
  return { args, estimatedDuration: total };
}
