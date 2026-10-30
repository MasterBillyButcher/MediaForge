'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Film, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useEditorStore,
  findClipAt,
  computeTotalDuration,
  formatTimecode,
  canvasFont,
  filterString,
  clamp,
  type EditorClip,
} from './editor-store';
import { cn } from '@/lib/utils';

export const FRAME_STEP = 1 / 30;

// ---------------------------------------------------------------------------
// Shared preview globals + audio engine (also used by the quick WebM export)
// ---------------------------------------------------------------------------

export const previewGlobals: { canvas: HTMLCanvasElement | null } = { canvas: null };

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let captureDest: MediaStreamAudioDestinationNode | null = null;
const audioSrcNodes = new Map<HTMLMediaElement, MediaElementAudioSourceNode>();
const mediaRegistry = new Set<HTMLMediaElement>();

function ensureAudioEngine(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.connect(audioCtx.destination);
      captureDest = audioCtx.createMediaStreamDestination();
    } catch {
      audioCtx = null;
      return null;
    }
  }
  return audioCtx;
}

function attachElementAudio(el: HTMLMediaElement): void {
  const ctx = ensureAudioEngine();
  if (!ctx || !masterGain) return;
  if (audioSrcNodes.has(el)) return;
  try {
    const node = ctx.createMediaElementSource(el);
    node.connect(masterGain);
    audioSrcNodes.set(el, node);
  } catch {
    // element already attached to another graph — ignore
  }
}

function registerMedia(el: HTMLMediaElement): void {
  mediaRegistry.add(el);
}

function unregisterMedia(el: HTMLMediaElement): void {
  mediaRegistry.delete(el);
  const node = audioSrcNodes.get(el);
  if (node) {
    try {
      node.disconnect();
    } catch {
      // ignore
    }
    audioSrcNodes.delete(el);
  }
}

export function resumeAudioContext(): void {
  if (audioCtx && audioCtx.state === 'suspended') void audioCtx.resume();
}

/**
 * Start playback of the media that would be active at time t.
 * Must be called from a user-gesture handler (click / keydown) so browsers
 * with strict autoplay policies allow unmuted playback.
 */
export function primePlaybackAt(t: number): void {
  const st = useEditorStore.getState();
  const at = findClipAt(st.clips, t);
  if (at) {
    const v = videoPool.get(at.clip.fileId);
    if (v) {
      v.playbackRate = clamp(at.clip.speed || 1, 0.25, 4);
      void v.play().catch(() => undefined);
    }
  }
  for (const track of st.audioTracks) {
    if (t >= track.start) {
      const a = audioPool.get(track.id);
      if (a && a.paused) {
        try {
          a.currentTime = t - track.start;
        } catch {
          // ignore
        }
        void a.play().catch(() => undefined);
      }
    }
  }
}

/** Route all current media elements through the graph and return a capture stream. */
export function beginCanvasCapture(): MediaStream | null {
  const canvas = previewGlobals.canvas;
  if (!canvas || typeof canvas.captureStream !== 'function') return null;
  const ctx = ensureAudioEngine();
  if (!ctx || !masterGain || !captureDest) return null;
  for (const el of mediaRegistry) attachElementAudio(el);
  if (ctx.state === 'suspended') void ctx.resume();
  try {
    masterGain.connect(captureDest);
  } catch {
    // already connected
  }
  return canvas.captureStream(30);
}

export function endCanvasCapture(): void {
  if (masterGain && captureDest) {
    try {
      masterGain.disconnect(captureDest);
    } catch {
      // not connected
    }
  }
}

export function shutdownAudioEngine(): void {
  endCanvasCapture();
  for (const node of audioSrcNodes.values()) {
    try {
      node.disconnect();
    } catch {
      // ignore
    }
  }
  audioSrcNodes.clear();
  mediaRegistry.clear();
  if (audioCtx) {
    void audioCtx.close().catch(() => undefined);
    audioCtx = null;
    masterGain = null;
    captureDest = null;
  }
}

// ---------------------------------------------------------------------------
// Frame transform math (crop -> rotate -> flip -> letterbox fit)
// ---------------------------------------------------------------------------

interface FrameXf {
  W: number;
  H: number;
  vw: number;
  vh: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  destW: number;
  destH: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
  cx: number;
  cy: number;
}

function frameTransform(
  vw: number,
  vh: number,
  crop: { x: number; y: number; w: number; h: number },
  rot: number,
  flipH: boolean,
  flipV: boolean,
  W: number,
  H: number
): FrameXf {
  const sx = crop.x * vw;
  const sy = crop.y * vh;
  const sw = Math.max(1, crop.w * vw);
  const sh = Math.max(1, crop.h * vh);
  const swapped = rot === 90 || rot === 270;
  const dispW = swapped ? sh : sw;
  const dispH = swapped ? sw : sh;
  const fit = Math.min(W / dispW, H / dispH);
  return {
    W,
    H,
    vw,
    vh,
    sx,
    sy,
    sw,
    sh,
    destW: sw * fit,
    destH: sh * fit,
    rot,
    flipH,
    flipV,
    cx: W / 2,
    cy: H / 2,
  };
}

function uvToCanvas(xf: FrameXf, u: number, v: number): [number, number] {
  const px = u * xf.vw;
  const py = v * xf.vh;
  let x = ((px - xf.sx) / xf.sw - 0.5) * xf.destW;
  let y = ((py - xf.sy) / xf.sh - 0.5) * xf.destH;
  if (xf.flipH) x = -x;
  if (xf.flipV) y = -y;
  const rad = (xf.rot * Math.PI) / 180;
  const rx = x * Math.cos(rad) - y * Math.sin(rad);
  const ry = x * Math.sin(rad) + y * Math.cos(rad);
  return [xf.cx + rx, xf.cy + ry];
}

function canvasToUv(xf: FrameXf, mx: number, my: number): [number, number] {
  const dx = mx - xf.cx;
  const dy = my - xf.cy;
  const rad = (-xf.rot * Math.PI) / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  let x = rx;
  let y = ry;
  if (xf.flipH) x = -x;
  if (xf.flipV) y = -y;
  const px = xf.sx + (x / xf.destW + 0.5) * xf.sw;
  const py = xf.sy + (y / xf.destH + 0.5) * xf.sh;
  return [px / xf.vw, py / xf.vh];
}

function clipFadeAlpha(clip: EditorClip, tWithin: number, dur: number): number {
  let a = 1;
  if (clip.fadeIn && clip.fadeIn > 0) a = Math.min(a, clamp(tWithin / clip.fadeIn, 0, 1));
  if (clip.fadeOut && clip.fadeOut > 0) a = Math.min(a, clamp((dur - tWithin) / clip.fadeOut, 0, 1));
  return a;
}

function trackFadeAlpha(track: { fadeIn?: number; fadeOut?: number }, expected: number, dur: number): number {
  let a = 1;
  if (track.fadeIn && track.fadeIn > 0) a = Math.min(a, clamp(expected / track.fadeIn, 0, 1));
  if (track.fadeOut && track.fadeOut > 0) a = Math.min(a, clamp((dur - expected) / track.fadeOut, 0, 1));
  return a;
}

const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Module-level media pools keyed by fileId / trackId.
 * Kept at module scope so playback can also be primed from keyboard gestures
 * (primePlaybackAt) and the quick exporter can reach the same elements.
 */
const videoPool = new Map<string, HTMLVideoElement>();
const imgPool = new Map<string, HTMLImageElement>();
const audioPool = new Map<string, HTMLAudioElement>();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PreviewCanvas() {
  const sources = useEditorStore((s) => s.sources);
  const audioTracks = useEditorStore((s) => s.audioTracks);
  const overlays = useEditorStore((s) => s.overlays);
  const output = useEditorStore((s) => s.output);
  const playing = useEditorStore((s) => s.playing);
  const clipsCount = useEditorStore((s) => s.clips.length);
  const cropMode = useEditorStore((s) => s.cropMode);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<CropDragState | null>(null);
  const hasCtxFilter = useMemo(
    () => typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype,
    []
  );

  // register canvas for quick export
  useEffect(() => {
    previewGlobals.canvas = canvasRef.current;
    return () => {
      previewGlobals.canvas = null;
    };
  }, []);

  // main render loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastDraw = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const st0 = useEditorStore.getState();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const totalDur = computeTotalDuration(st0.clips);

      if (st0.playing) {
        if (totalDur <= 0) {
          useEditorStore.setState({ playing: false, playhead: 0 });
        } else {
          const t = st0.playhead + dt;
          if (t >= totalDur) {
            useEditorStore.setState({ playhead: totalDur, playing: false });
          } else {
            useEditorStore.setState({ playhead: t });
          }
        }
      }

      // re-read state so sync/draw see the freshly advanced playhead
      const st = useEditorStore.getState();
      const drawInterval = st.playing ? 1000 / 60 : 1000 / 15;
      if (now - lastDraw >= drawInterval - 1) {
        lastDraw = now;
        syncMedia(st, videoPool, audioPool);
        drawFrame(st, canvasRef.current, videoPool, imgPool, hasCtxFilter);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hasCtxFilter]);

  // stop everything on unmount
  useEffect(() => {
    return () => {
      useEditorStore.setState({ playing: false });
      for (const el of mediaRegistry) {
        try {
          el.pause();
        } catch {
          // ignore
        }
      }
      shutdownAudioEngine();
      videoPool.clear();
      imgPool.clear();
      audioPool.clear();
    };
  }, []);

  // ------------------------------------------------------------------ refs
  const videoRefCb = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) {
      videoPool.set(id, el);
      registerMedia(el);
    } else {
      videoPool.delete(id);
    }
  }, []);

  const imgRefCb = useCallback((id: string, el: HTMLImageElement | null) => {
    if (el) imgPool.set(id, el);
    else imgPool.delete(id);
  }, []);

  const audioRefCb = useCallback((id: string, el: HTMLAudioElement | null) => {
    if (el) {
      audioPool.set(id, el);
      registerMedia(el);
    } else {
      audioPool.delete(id);
    }
  }, []);

  // -------------------------------------------------------------- transport
  const onTogglePlay = useCallback(() => {
    const st = useEditorStore.getState();
    if (st.playing) {
      st.setPlaying(false);
      return;
    }
    const totalDur = computeTotalDuration(st.clips);
    if (totalDur <= 0) return;
    let t = st.playhead;
    if (t >= totalDur - 0.01) t = 0;
    st.setPlayhead(t);
    resumeAudioContext();
    primePlaybackAt(t);
    st.setPlaying(true);
  }, []);

  const seek = useCallback((t: number) => {
    useEditorStore.getState().setPlayhead(t);
  }, []);

  const cropModeActive = cropMode && selectedClipId !== null;

  // ------------------------------------------------------- crop interaction
  const canvasPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>, phase: 'down' | 'move' | 'up') => {
      const canvas = canvasRef.current;
      if (!canvas || !cropModeActive) return;
      const st = useEditorStore.getState();
      const clip = st.clips.find((c) => c.id === st.selectedClipId);
      if (!clip) return;
      const video = videoPool.get(clip.fileId);
      if (!video || !video.videoWidth) return;

      const W = canvas.width;
      const H = canvas.height;
      const xf = frameTransform(
        video.videoWidth,
        video.videoHeight,
        FULL_CROP,
        clip.rotate ?? 0,
        Boolean(clip.flipH),
        Boolean(clip.flipV),
        W,
        H
      );
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * W;
      const my = ((e.clientY - rect.top) / rect.height) * H;
      const [u, v] = canvasToUv(xf, mx, my);
      const cur = clip.crop ?? FULL_CROP;

      if (phase === 'down') {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        const TOL = 18;
        const [x0, y0] = uvToCanvas(xf, cur.x, cur.y);
        const [x1, y1] = uvToCanvas(xf, cur.x + cur.w, cur.y + cur.h);
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1);
        const top = Math.min(y0, y1);
        const bottom = Math.max(y0, y1);
        const nearL = Math.abs(mx - left) < TOL;
        const nearR = Math.abs(mx - right) < TOL;
        const nearT = Math.abs(my - top) < TOL;
        const nearB = Math.abs(my - bottom) < TOL;
        const inside = mx > left && mx < right && my > top && my < bottom;

        let mode: CropDragMode = 'new';
        if (nearL && nearT) mode = 'nw';
        else if (nearR && nearT) mode = 'ne';
        else if (nearL && nearB) mode = 'sw';
        else if (nearR && nearB) mode = 'se';
        else if (nearL) mode = 'w';
        else if (nearR) mode = 'e';
        else if (nearT) mode = 'n';
        else if (nearB) mode = 's';
        else if (inside) mode = 'move';
        dragRef.current = { mode, startUv: [u, v], startCrop: { ...cur } };
        if (mode === 'new') {
          st.updateClip(clip.id, { crop: { x: clamp(u, 0, 1), y: clamp(v, 0, 1), w: 0.001, h: 0.001 } });
          dragRef.current.startCrop = { x: u, y: v, w: 0, h: 0 };
          dragRef.current.startUv = [u, v];
        }
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;

      if (phase === 'move') {
        const du = u - drag.startUv[0];
        const dv = v - drag.startUv[1];
        const s = drag.startCrop;
        const MIN = 0.05;
        let nx = s.x;
        let ny = s.y;
        let nw = s.w;
        let nh = s.h;
        const setRect = (x: number, y: number, w: number, h: number) => {
          nx = clamp(Math.min(x, x + w), 0, 1);
          ny = clamp(Math.min(y, y + h), 0, 1);
          nw = clamp(Math.abs(w), MIN, 1 - nx);
          nh = clamp(Math.abs(h), MIN, 1 - ny);
        };
        switch (drag.mode) {
          case 'move':
            nx = clamp(s.x + du, 0, 1 - s.w);
            ny = clamp(s.y + dv, 0, 1 - s.h);
            nw = s.w;
            nh = s.h;
            break;
          case 'new':
            setRect(
              Math.min(drag.startUv[0], u),
              Math.min(drag.startUv[1], v),
              Math.abs(du),
              Math.abs(dv)
            );
            break;
          case 'e':
            setRect(s.x, s.y, Math.max(MIN, s.w + du), s.h);
            break;
          case 'w':
            setRect(s.x + du, s.y, s.w - du, s.h);
            break;
          case 's':
            setRect(s.x, s.y, s.w, Math.max(MIN, s.h + dv));
            break;
          case 'n':
            setRect(s.x, s.y + dv, s.w, s.h - dv);
            break;
          case 'se':
            setRect(s.x, s.y, Math.max(MIN, s.w + du), Math.max(MIN, s.h + dv));
            break;
          case 'nw':
            setRect(s.x + du, s.y + dv, s.w - du, s.h - dv);
            break;
          case 'ne':
            setRect(s.x, s.y + dv, Math.max(MIN, s.w + du), s.h - dv);
            break;
          case 'sw':
            setRect(s.x + du, s.y, s.w - du, Math.max(MIN, s.h + dv));
            break;
        }
        st.updateClip(clip.id, { crop: { x: nx, y: ny, w: nw, h: nh } });
        return;
      }

      if (phase === 'up') {
        dragRef.current = null;
        // finalize: drop degenerate rects
        const c = useEditorStore.getState().clips.find((x) => x.id === clip.id)?.crop;
        if (c && (c.w < 0.05 || c.h < 0.05)) {
          st.updateClip(clip.id, { crop: FULL_CROP });
        }
      }
    },
    [cropModeActive]
  );

  const sourceUrl = (fileId: string): string | undefined =>
    sources.find((s) => s.file.id === fileId)?.url;

  return (
    <div className="space-y-3">
      <div
        className="relative flex items-center justify-center overflow-hidden rounded-xl border bg-black"
        data-testid="preview-stage"
      >
        <canvas
          ref={canvasRef}
          width={output.width}
          height={output.height}
          aria-label="Video preview canvas"
          className={cn(
            'block h-auto max-h-[55vh] w-auto max-w-full',
            cropModeActive && 'cursor-crosshair'
          )}
          style={{ touchAction: cropModeActive ? 'none' : 'auto' }}
          onPointerDown={(e) => canvasPointer(e, 'down')}
          onPointerMove={(e) => canvasPointer(e, 'move')}
          onPointerUp={(e) => canvasPointer(e, 'up')}
          onPointerCancel={(e) => canvasPointer(e, 'up')}
        />
        {clipsCount === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <Film className="h-10 w-10 text-muted-foreground/60" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Add clips to the timeline to see the preview
            </p>
          </div>
        )}
        {cropModeActive && (
          <Badge className="absolute left-3 top-3 gap-1 bg-primary/90" variant="default">
            <Scissors className="h-3 w-3" aria-hidden /> Crop mode — drag on the frame
          </Badge>
        )}
      </div>

      {/* Transport */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-10" onClick={() => seek(0)} aria-label="Skip to start">
                <SkipBack className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Skip to start</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10"
                onClick={() => seek(useEditorStore.getState().playhead - FRAME_STEP)}
                aria-label="Step one frame back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Frame back (1/30s)</TooltipContent>
          </Tooltip>
          <Button
            size="icon"
            className="size-11"
            onClick={onTogglePlay}
            disabled={clipsCount === 0}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10"
                onClick={() => seek(useEditorStore.getState().playhead + FRAME_STEP)}
                aria-label="Step one frame forward"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Frame forward (1/30s)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10"
                onClick={() => seek(computeTotalDuration(useEditorStore.getState().clips))}
                aria-label="Skip to end"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Skip to end</TooltipContent>
          </Tooltip>
        </div>

        <TimecodeDisplay />

        <Badge variant="outline" className="font-mono text-xs">
          {output.width}×{output.height} · {output.fps}fps
        </Badge>
      </div>

      {/* Hidden media pools */}
      <div aria-hidden className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
        {sources.map((s) => (
          <video
            key={s.file.id}
            ref={(el) => {
              const prev = videoPool.get(s.file.id);
              if (prev && prev !== el) unregisterMedia(prev);
              videoRefCb(s.file.id, el);
            }}
            src={s.url}
            preload="auto"
            playsInline
            className="h-px w-px"
          />
        ))}
        {overlays.map((o) => {
          const url = sourceUrl(o.fileId);
          return url ? (
            <img key={o.id} ref={(el) => imgRefCb(o.fileId, el)} src={url} alt="" className="h-px w-px" />
          ) : null;
        })}
        {audioTracks.map((t) => {
          const url = sourceUrl(t.fileId);
          return url ? (
            <audio
              key={t.id}
              ref={(el) => {
                const prev = audioPool.get(t.id);
                if (prev && prev !== el) unregisterMedia(prev);
                audioRefCb(t.id, el);
              }}
              src={url}
              preload="auto"
              className="hidden"
            />
          ) : null;
        })}
      </div>
    </div>
  );
}

function TimecodeDisplay() {
  const t = useEditorStore((s) => s.playhead);
  const total = useEditorStore((s) => computeTotalDuration(s.clips));
  return (
    <div className="font-mono text-sm tabular-nums" aria-live="off">
      <span className="text-primary font-semibold">{formatTimecode(t)}</span>
      <span className="text-muted-foreground"> / {formatTimecode(total)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media sync (runs inside the rAF loop — reads fresh state each frame)
// ---------------------------------------------------------------------------

type StoreSnapshot = ReturnType<typeof useEditorStore.getState>;

function safeSeek(el: HTMLMediaElement, time: number): void {
  try {
    if (Number.isFinite(time) && time >= 0) el.currentTime = time;
  } catch {
    // seeking before metadata — ignore
  }
}

function syncMedia(
  st: StoreSnapshot,
  videos: Map<string, HTMLVideoElement>,
  audios: Map<string, HTMLAudioElement>
): void {
  const total = computeTotalDuration(st.clips);
  const at = findClipAt(st.clips, st.playhead);

  // ---- video pool
  for (const [fileId, el] of videos) {
    const active = at && at.clip.fileId === fileId;
    if (!active) {
      if (!el.paused) el.pause();
      continue;
    }
    const clip = at.clip;
    const local = clip.in + (st.playhead - at.start) * clip.speed;
    const dur = at.end - at.start;
    const tIn = st.playhead - at.start;
    const fade = clipFadeAlpha(clip, tIn, dur);
    el.playbackRate = clamp(clip.speed || 1, 0.25, 4);
    el.volume = clamp((clip.volume ?? 1) * fade, 0, 1);
    if (st.playing && total > 0) {
      if (el.paused && !el.ended) void el.play().catch(() => undefined);
      if (Math.abs(el.currentTime - local) > 0.3) safeSeek(el, local);
    } else {
      if (!el.paused) el.pause();
      if (el.readyState >= 1 && Math.abs(el.currentTime - local) > 0.08) safeSeek(el, local);
    }
  }

  // ---- crop editor: keep the selected clip's video parked on its first frame
  if (st.cropMode && st.selectedClipId) {
    const sel = st.clips.find((c) => c.id === st.selectedClipId);
    if (sel && (!at || at.clip.id !== sel.id)) {
      const el = videos.get(sel.fileId);
      if (el) {
        if (!el.paused) el.pause();
        if (el.readyState >= 1 && Math.abs(el.currentTime - sel.in) > 0.08) safeSeek(el, sel.in);
      }
    }
  }

  // ---- audio pool
  for (const track of st.audioTracks) {
    const el = audios.get(track.id);
    if (!el) continue;
    const expected = st.playhead - track.start;
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 3600;
    const active = st.playing && expected >= 0 && expected < dur - 0.05 && !el.ended;
    if (active) {
      el.volume = clamp((track.volume ?? 1) * trackFadeAlpha(track, expected, dur), 0, 1);
      if (el.paused) {
        safeSeek(el, expected);
        void el.play().catch(() => undefined);
      } else if (Math.abs(el.currentTime - expected) > 0.35) {
        safeSeek(el, expected);
      }
    } else if (!el.paused) {
      el.pause();
    }
  }
}

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

function drawFrame(
  st: StoreSnapshot,
  canvas: HTMLCanvasElement | null,
  videos: Map<string, HTMLVideoElement>,
  imgs: Map<string, HTMLImageElement>,
  hasCtxFilter: boolean
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.fillStyle = st.output.background || '#000000';
  ctx.fillRect(0, 0, W, H);

  const selected = st.clips.find((c) => c.id === st.selectedClipId) ?? null;
  const cropEditor = st.cropMode && selected;

  if (cropEditor && selected) {
    drawCropEditor(ctx, st, selected, videos, W, H);
  } else {
    const at = findClipAt(st.clips, st.playhead);
    if (at) drawClipFrame(ctx, st, at, videos, canvas, W, H, hasCtxFilter);
  }

  // image overlays
  for (const o of st.overlays) {
    if (st.playhead < o.start || st.playhead >= o.end) continue;
    const img = imgs.get(o.fileId);
    if (!img || !img.complete || !img.naturalWidth) continue;
    const w = o.scale * W;
    const h = w * (img.naturalHeight / img.naturalWidth);
    ctx.save();
    ctx.globalAlpha = clamp(o.opacity, 0, 1);
    ctx.drawImage(img, o.x * W - w / 2, o.y * H - h / 2, w, h);
    ctx.restore();
  }

  // texts
  for (const t of st.texts) {
    if (st.playhead < t.start || st.playhead >= t.end) continue;
    drawTextItem(ctx, t, st.playhead, W, H);
  }
}

function drawClipFrame(
  ctx: CanvasRenderingContext2D,
  st: StoreSnapshot,
  at: { clip: EditorClip; start: number; end: number },
  videos: Map<string, HTMLVideoElement>,
  canvas: HTMLCanvasElement,
  W: number,
  H: number,
  hasCtxFilter: boolean
): void {
  const clip = at.clip;
  const video = videos.get(clip.fileId);
  if (!video || video.readyState < 2 || !video.videoWidth) return;
  const crop = clip.crop ?? FULL_CROP;
  const rot = clip.rotate ?? 0;
  const xf = frameTransform(
    video.videoWidth,
    video.videoHeight,
    crop,
    rot,
    Boolean(clip.flipH),
    Boolean(clip.flipV),
    W,
    H
  );
  const dur = at.end - at.start;
  const alpha = clipFadeAlpha(clip, st.playhead - at.start, dur);
  const fs = filterString(clip.filters);

  ctx.save();
  ctx.globalAlpha = alpha;
  if (fs !== 'none') {
    if (hasCtxFilter) {
      try {
        ctx.filter = fs;
      } catch {
        // ignore
      }
    } else if (canvas) {
      canvas.style.filter = fs;
    }
  }
  ctx.translate(xf.cx, xf.cy);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1);
  try {
    ctx.drawImage(video, xf.sx, xf.sy, xf.sw, xf.sh, -xf.destW / 2, -xf.destH / 2, xf.destW, xf.destH);
  } catch {
    // frame not decodable yet
  }
  ctx.restore();
  if (!hasCtxFilter && canvas) canvas.style.filter = 'none';
}

function drawCropEditor(
  ctx: CanvasRenderingContext2D,
  st: StoreSnapshot,
  clip: EditorClip,
  videos: Map<string, HTMLVideoElement>,
  W: number,
  H: number
): void {
  const video = videos.get(clip.fileId);
  if (!video || video.readyState < 2 || !video.videoWidth) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '16px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for video frame…', W / 2, H / 2);
    return;
  }
  // show the FULL frame (ignore crop) so the user sees what can be selected
  const xf = frameTransform(
    video.videoWidth,
    video.videoHeight,
    FULL_CROP,
    clip.rotate ?? 0,
    Boolean(clip.flipH),
    Boolean(clip.flipV),
    W,
    H
  );
  ctx.save();
  ctx.translate(xf.cx, xf.cy);
  if (xf.rot) ctx.rotate((xf.rot * Math.PI) / 180);
  ctx.scale(xf.flipH ? -1 : 1, xf.flipV ? -1 : 1);
  try {
    ctx.drawImage(video, 0, 0, xf.vw, xf.vh, -xf.destW / 2, -xf.destH / 2, xf.destW, xf.destH);
  } catch {
    // ignore
  }
  ctx.restore();

  const crop = clip.crop ?? FULL_CROP;
  const corners: [number, number][] = [
    uvToCanvas(xf, crop.x, crop.y),
    uvToCanvas(xf, crop.x + crop.w, crop.y),
    uvToCanvas(xf, crop.x + crop.w, crop.y + crop.h),
    uvToCanvas(xf, crop.x, crop.y + crop.h),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  // dim outside the crop rect
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, top);
  ctx.fillRect(0, bottom, W, H - bottom);
  ctx.fillRect(0, top, left, bottom - top);
  ctx.fillRect(right, top, W - right, bottom - top);

  // border + thirds
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2;
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  const rw = right - left;
  const rh = bottom - top;
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(left + (rw * i) / 3, top);
    ctx.lineTo(left + (rw * i) / 3, bottom);
    ctx.moveTo(left, top + (rh * i) / 3);
    ctx.lineTo(right, top + (rh * i) / 3);
    ctx.stroke();
  }
  // corner handles
  ctx.fillStyle = '#ffffff';
  const hs = 7;
  for (const [hx, hy] of [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ]) {
    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
  }
  ctx.restore();
}

function drawTextItem(
  ctx: CanvasRenderingContext2D,
  t: StoreSnapshot['texts'][number],
  now: number,
  W: number,
  H: number
): void {
  const size = clamp(t.size || 48, 8, 400);
  ctx.save();
  ctx.font = canvasFont(t.font, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let alpha = 1;
  let dy = 0;
  if (t.animation === 'fade') {
    const fi = clamp((now - t.start) / 0.4, 0, 1);
    const fo = clamp((t.end - now) / 0.4, 0, 1);
    alpha = Math.min(fi, fo);
  } else if (t.animation === 'slide-up') {
    const p = clamp((now - t.start) / 0.5, 0, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    dy = (1 - ease) * size * 0.8;
    alpha = clamp(p * 2, 0, 1);
  }
  ctx.globalAlpha = alpha;

  const px = t.x * W;
  const py = t.y * H + dy;
  const text = t.text || ' ';

  if (t.bgColor) {
    const m = ctx.measureText(text);
    const padX = size * 0.3;
    const padY = size * 0.16;
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = t.bgColor;
    ctx.fillRect(px - m.width / 2 - padX, py - size * 0.62 - padY, m.width + padX * 2, size * 1.24 + padY * 2);
    ctx.restore();
  }

  if (t.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = size / 5;
    ctx.shadowOffsetY = 2;
  }
  if (t.outline) {
    ctx.lineWidth = Math.max(2, size / 14);
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(text, px, py);
  }
  ctx.fillStyle = t.color || '#ffffff';
  ctx.fillText(text, px, py);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Crop drag types
// ---------------------------------------------------------------------------

type CropDragMode = 'new' | 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface CropDragState {
  mode: CropDragMode;
  startUv: [number, number];
  startCrop: { x: number; y: number; w: number; h: number };
}
