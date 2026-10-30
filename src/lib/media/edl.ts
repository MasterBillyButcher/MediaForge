import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { absolutePathFor } from '@/lib/storage';
import { probeMedia } from '@/lib/media/ffmpeg';
import type { Edl, EdlOutputFormat, EdlText } from '@/lib/types';

/**
 * EDL -> ffmpeg filter_complex renderer.
 *
 * Turns the browser editor's timeline (clips + transforms + text + audio
 * tracks) into a single deterministic ffmpeg command. Every feature listed
 * in the EDL is genuinely applied — this is what powers the editor's
 * "High-quality render (server)" export.
 */

const FONTS: Record<string, string> = {
  sans: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'sans-bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  mono: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  serif: '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
  'serif-bold': '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
};

export interface PreparedClip {
  path: string;
  in: number;
  span: number; // out - in
  outDuration: number; // span / speed
  speed: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
}

function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\\\\\\'")
    .replace(/%/g, '\\\\%')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
}

function hexToFf(color: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  return m ? `0x${m[1]}` : '0xffffff';
}

function atempoChain(speed: number): string {
  const parts: string[] = [];
  let remaining = speed;
  while (remaining > 2) { parts.push('atempo=2.0'); remaining /= 2; }
  while (remaining < 0.5) { parts.push('atempo=0.5'); remaining *= 2; }
  parts.push(`atempo=${remaining.toFixed(4)}`);
  return parts.join(',');
}

/** Resolve and probe every file referenced by the EDL. Throws on problems. */
export async function prepareEdlInputs(edl: Edl): Promise<Map<string, { path: string; probe: Awaited<ReturnType<typeof probeMedia>> }>> {
  const ids = new Set<string>();
  for (const c of edl.clips) ids.add(c.fileId);
  for (const t of edl.audioTracks) ids.add(t.fileId);
  for (const o of edl.overlays) ids.add(o.fileId);

  const resolved = new Map<string, { path: string; probe: Awaited<ReturnType<typeof probeMedia>> }>();
  for (const id of ids) {
    const row = await db.mediaFile.findUnique({ where: { id } });
    if (!row) throw new Error(`Referenced file ${id} no longer exists (it may have expired). Re-upload it and try again.`);
    const abs = absolutePathFor(row);
    await fs.access(abs).catch(() => { throw new Error(`File "${row.originalName}" is no longer available on disk. Re-upload it.`); });
    const stat = await fs.stat(abs);
    const probe = await probeMedia(abs, stat.size).catch(() => {
      throw new Error(`Could not analyze "${row.originalName}" — is it a valid media file?`);
    });
    resolved.set(id, { path: abs, probe });
  }
  return resolved;
}

export interface EdlRenderPlan {
  args: string[];
  totalDuration: number;
}

export function buildEdlArgs(
  edl: Edl,
  inputs: Map<string, { path: string; probe: Awaited<ReturnType<typeof probeMedia>> }>,
  outputPath: string,
  format: EdlOutputFormat
): EdlRenderPlan {
  if (!edl.clips || edl.clips.length === 0) throw new Error('The timeline has no clips to render.');

  const W = Math.max(16, Math.round(edl.width / 2) * 2);
  const H = Math.max(16, Math.round(edl.height / 2) * 2);
  const fps = Math.min(60, Math.max(10, Math.round(edl.fps || 30)));
  const bg = hexToFf(edl.background || '#000000');

  // ---- validate + measure clips --------------------------------------------
  const clips = edl.clips.map((c) => {
    const file = inputs.get(c.fileId);
    if (!file) throw new Error('Missing clip source file.');
    if (!file.probe.hasVideo) throw new Error('Timeline clips must be video files (a clip has no video stream).');
    const inSec = Math.max(0, Math.min(c.in ?? 0, Math.max(0, file.probe.duration - 0.05)));
    const outSec = Math.min(Math.max(c.out ?? file.probe.duration, inSec + 0.1), file.probe.duration || Infinity);
    const span = Math.max(0.1, outSec - inSec);
    const speed = Math.min(4, Math.max(0.25, c.speed ?? 1));
    return {
      path: file.path,
      in: inSec,
      span,
      outDuration: span / speed,
      speed,
      hasVideo: file.probe.hasVideo,
      hasAudio: file.probe.hasAudio && (c.volume ?? 1) >= 0 && c.volume !== -1 && c.volume > 0 ? file.probe.hasAudio : file.probe.hasAudio,
      width: file.probe.width,
      height: file.probe.height,
    };
  });
  const totalDuration = clips.reduce((acc, c) => acc + c.outDuration, 0);

  const args: string[] = [];
  const chains: string[] = [];

  // ---- inputs ---------------------------------------------------------------
  for (const c of clips) {
    args.push('-ss', c.in.toFixed(3), '-t', c.span.toFixed(3), '-i', c.path);
  }
  const numClips = clips.length;
  const numOverlays = edl.overlays?.length ?? 0;
  for (const ov of edl.overlays ?? []) {
    const file = inputs.get(ov.fileId);
    if (!file) throw new Error('Missing overlay image.');
    args.push('-loop', '1', '-t', totalDuration.toFixed(3), '-i', file.path);
  }
  const audioTrackInputStart = numClips + numOverlays;
  for (const t of edl.audioTracks ?? []) {
    const file = inputs.get(t.fileId);
    if (!file) throw new Error('Missing audio track file.');
    args.push('-i', file.path);
  }

  // ---- per-clip chains --------------------------------------------------------
  for (let i = 0; i < numClips; i++) {
    const c = clips[i];
    const edlClip = edl.clips[i];

    if (c.hasVideo) {
      const vf: string[] = [];
      vf.push('setpts=(PTS-STARTPTS)/' + c.speed.toFixed(4));
      vf.push(`fps=${fps}`);
      if (edlClip.crop) {
        const cw = Math.min(1, Math.max(0.01, edlClip.crop.w));
        const ch = Math.min(1, Math.max(0.01, edlClip.crop.h));
        const cx = Math.min(1 - cw, Math.max(0, edlClip.crop.x));
        const cy = Math.min(1 - ch, Math.max(0, edlClip.crop.y));
        vf.push(`crop=w='iw*${cw.toFixed(4)}':h='ih*${ch.toFixed(4)}':x='iw*${cx.toFixed(4)}':y='ih*${cy.toFixed(4)}'`);
      }
      switch (edlClip.rotate ?? 0) {
        case 90: vf.push('transpose=1'); break;
        case 180: vf.push('transpose=1,transpose=1'); break;
        case 270: vf.push('transpose=2'); break;
      }
      if (edlClip.flipH) vf.push('hflip');
      if (edlClip.flipV) vf.push('vflip');

      // fit inside canvas, preserve aspect ratio, even dimensions
      vf.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2`);
      vf.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:${bg}`);

      const f = edlClip.filters ?? {};
      const eqParts: string[] = [];
      if (typeof f.brightness === 'number' && f.brightness !== 0) eqParts.push(`brightness=${f.brightness.toFixed(3)}`);
      if (typeof f.contrast === 'number' && f.contrast !== 0) eqParts.push(`contrast=${(1 + f.contrast).toFixed(3)}`);
      if (typeof f.saturation === 'number' && f.saturation !== 0) eqParts.push(`saturation=${(1 + f.saturation).toFixed(3)}`);
      if (f.grayscale) eqParts.push('saturation=0');
      if (eqParts.length > 0) vf.push('eq=' + eqParts.join(':'));
      if (f.sepia) vf.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
      if (f.blur && f.blur > 0) vf.push(`gblur=sigma=${Math.min(20, f.blur).toFixed(2)}`);
      if (f.sharpen && f.sharpen > 0) vf.push(`unsharp=5:5:${Math.min(3, f.sharpen).toFixed(2)}:5:5:0.0`);

      const d = c.outDuration;
      if (edlClip.fadeIn && edlClip.fadeIn > 0) {
        vf.push(`fade=t=in:st=0:d=${Math.min(edlClip.fadeIn, d / 2).toFixed(3)}`);
      }
      if (edlClip.fadeOut && edlClip.fadeOut > 0) {
        vf.push(`fade=t=out:st=${Math.max(0, d - Math.min(edlClip.fadeOut, d / 2)).toFixed(3)}:d=${Math.min(edlClip.fadeOut, d / 2).toFixed(3)}`);
      }
      vf.push('setsar=1');
      vf.push('format=yuv420p');
      chains.push(`[${i}:v]${vf.join(',')}[v${i}]`);
    }

    // audio chain (real or silence so concat always has an audio stream)
    if (c.hasAudio) {
      const af: string[] = ['asetpts=PTS-STARTPTS'];
      af.push('aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo');
      if (c.speed !== 1) af.push(atempoChain(c.speed));
      const vol = Math.min(2, Math.max(0, edlClip.volume ?? 1));
      af.push(`volume=${vol.toFixed(3)}`);
      const d = c.outDuration;
      if (edlClip.fadeIn && edlClip.fadeIn > 0) af.push(`afade=t=in:st=0:d=${Math.min(edlClip.fadeIn, d / 2).toFixed(3)}`);
      if (edlClip.fadeOut && edlClip.fadeOut > 0) af.push(`afade=t=out:st=${Math.max(0, d - Math.min(edlClip.fadeOut, d / 2)).toFixed(3)}:d=${Math.min(edlClip.fadeOut, d / 2).toFixed(3)}`);
      chains.push(`[${i}:a]${af.join(',')}[a${i}]`);
    } else {
      chains.push(`aevalsrc=0:s=44100:c=stereo:d=${c.outDuration.toFixed(3)}[a${i}]`);
    }
  }

  // ---- concat ------------------------------------------------------------------
  const concatLabels = clips.map((_, i) => `[v${i}][a${i}]`).join('');
  chains.push(`${concatLabels}concat=n=${numClips}:v=1:a=1[vc][ac]`);

  // ---- overlays -----------------------------------------------------------------
  let currentVideo = 'vc';
  for (let j = 0; j < numOverlays; j++) {
    const ov = edl.overlays[j];
    const inputIdx = numClips + j;
    const scale = Math.min(1, Math.max(0.01, ov.scale ?? 0.2));
    const opacity = Math.min(1, Math.max(0, ov.opacity ?? 1));
    chains.push(
      `[${inputIdx}:v]scale=iw*${scale.toFixed(4)}:-1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[ovr${j}]`
    );
    const xExpr = `(main_w-overlay_w)*${Math.min(1, Math.max(0, ov.x ?? 0.5)).toFixed(4)}-overlay_w/2+overlay_w/2`;
    const yExpr = `(main_h-overlay_h)*${Math.min(1, Math.max(0, ov.y ?? 0.5)).toFixed(4)}-overlay_h/2+overlay_h/2`;
    const out = j === numOverlays - 1 && (edl.texts?.length ?? 0) === 0 ? 'vfinal' : `vo${j}`;
    chains.push(
      `[${currentVideo}][ovr${j}]overlay=x='${xExpr}':y='${yExpr}':enable='between(t,${(ov.start ?? 0).toFixed(3)},${(ov.end ?? totalDuration).toFixed(3)})'[${out}]`
    );
    currentVideo = out;
  }

  // ---- text overlays --------------------------------------------------------------
  const texts = (edl.texts ?? []).filter((t) => t.text && t.end > t.start);
  for (let k = 0; k < texts.length; k++) {
    const t = texts[k];
    const isLast = k === texts.length - 1;
    const out = isLast ? 'vfinal' : `vt${k}`;
    chains.push(`[${currentVideo}]${drawTextChain(t, H)}[${out}]`);
    currentVideo = out;
  }
  if (numOverlays === 0 && texts.length === 0) {
    // ensure a final label exists
    chains.push(`[${currentVideo}]null[vfinal]`);
    currentVideo = 'vfinal';
  }

  // ---- audio tracks (music / voiceover) ---------------------------------------------
  let currentAudio = 'ac';
  const musicCount = edl.audioTracks?.length ?? 0;
  if (musicCount > 0) {
    const mixLabels = [`[${currentAudio}]`];
    for (let k = 0; k < musicCount; k++) {
      const t = edl.audioTracks[k];
      const inputIdx = audioTrackInputStart + k;
      const vol = Math.min(2, Math.max(0, t.volume ?? 1));
      const af: string[] = ['aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
      af.push(`adelay=${Math.max(0, Math.round((t.start ?? 0) * 1000))}:all=1`);
      af.push(`volume=${vol.toFixed(3)}`);
      const start = t.start ?? 0;
      if (t.fadeIn && t.fadeIn > 0) af.push(`afade=t=in:st=${start.toFixed(3)}:d=${t.fadeIn.toFixed(3)}`);
      if (t.fadeOut && t.fadeOut > 0) af.push(`afade=t=out:st=${Math.max(start, start + (t.fadeOut ?? 0) - (t.fadeOut ?? 0)).toFixed(3)}:d=${t.fadeOut.toFixed(3)}`);
      chains.push(`[${inputIdx}:a]${af.join(',')}[mu${k}]`);
      mixLabels.push(`[mu${k}]`);
    }
    chains.push(`${mixLabels.join('')}amix=inputs=${musicCount + 1}:duration=first:normalize=0[aout]`);
    currentAudio = 'aout';
  } else {
    chains.push(`[${currentAudio}]anull[aout]`);
    currentAudio = 'aout';
  }

  // ---- output args ------------------------------------------------------------------
  args.push('-filter_complex', chains.join(';'));
  args.push('-map', `[${currentVideo}]`, '-map', `[${currentAudio}]`);
  args.push('-t', totalDuration.toFixed(3));
  args.push('-r', String(fps));

  switch (format) {
    case 'webm':
      args.push('-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '5', '-c:a', 'libopus', '-b:a', '160k');
      break;
    case 'mov':
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
      break;
    case 'mkv':
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k');
      break;
    case 'mp4':
    default:
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
      break;
  }

  args.push('-progress', 'pipe:1', '-nostats');
  args.push(outputPath);
  return { args, totalDuration };
}

function drawTextChain(t: EdlText, H: number): string {
  const fontKey = t.font && FONTS[t.font] ? t.font : 'sans-bold';
  const fontsize = Math.max(10, Math.min(H, Math.round(t.size ?? H * 0.08)));
  const xN = Math.min(1, Math.max(0, t.x ?? 0.5));
  const yN = Math.min(1, Math.max(0, t.y ?? 0.5));
  const parts: string[] = [
    `fontfile=${FONTS[fontKey]}`,
    `text='${escapeDrawText(t.text)}'`,
    `fontsize=${fontsize}`,
    `fontcolor=${hexToFf(t.color || '#ffffff')}`,
    `x='(w-text_w)*${xN.toFixed(4)}'`,
  ];

  if (t.animation === 'slide-up') {
    const slide = Math.round(H * 0.06);
    parts.push(
      `y='(h-text_h)*${yN.toFixed(4)} + if(lt(t,${t.start.toFixed(3)}+0.4),(1-(t-${t.start.toFixed(3)})/0.4)*${slide},0)'`
    );
    parts.push(`alpha='if(lt(t,${t.start.toFixed(3)}+0.4),(t-${t.start.toFixed(3)})/0.4,1)'`);
  } else if (t.animation === 'fade') {
    parts.push(`y='(h-text_h)*${yN.toFixed(4)}'`);
    parts.push(
      `alpha='if(lt(t,${t.start.toFixed(3)}+0.3),(t-${t.start.toFixed(3)})/0.3,if(gt(t,${t.end.toFixed(3)}-0.3),(${t.end.toFixed(3)}-t)/0.3,1))'`
    );
  } else {
    parts.push(`y='(h-text_h)*${yN.toFixed(4)}'`);
  }

  if (t.bgColor) parts.push(`box=1:boxcolor=${hexToFf(t.bgColor)}@0.75:boxborderw=10`);
  if (t.outline) parts.push('borderw=2:bordercolor=black');
  if (t.shadow) parts.push('shadowcolor=black@0.6:shadowx=2:shadowy=2');
  parts.push(`enable='between(t,${t.start.toFixed(3)},${t.end.toFixed(3)})'`);
  return 'drawtext=' + parts.join(':');
}

/** Convenience: quick validation without heavy work. */
export function validateEdl(edl: Edl): string | null {
  if (!edl || !Array.isArray(edl.clips) || edl.clips.length === 0) return 'Timeline has no video clips.';
  if (edl.clips.length > 20) return 'Too many clips on the timeline (max 20 per render).';
  if ((edl.audioTracks?.length ?? 0) > 6) return 'Too many audio tracks (max 6).';
  if ((edl.texts?.length ?? 0) > 40) return 'Too many text overlays (max 40).';
  return null;
}
