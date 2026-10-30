'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Scissors,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Music,
  Film,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  useEditorStore,
  computeTotalDuration,
  clipDuration,
  formatTimecode,
  clamp,
  type EditorClip,
  type SourceItem,
} from './editor-store';

const MIN_PPS = 2;
const MAX_PPS = 120;

interface DurationMap {
  [fileId: string]: number;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function Timeline() {
  const clips = useEditorStore((s) => s.clips);
  const audioTracks = useEditorStore((s) => s.audioTracks);
  const sources = useEditorStore((s) => s.sources);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const [pps, setPps] = useState(12);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const durationById: DurationMap = useMemo(() => {
    const m: DurationMap = {};
    for (const s of sources) m[s.file.id] = s.file.meta?.duration ?? 0;
    return m;
  }, [sources]);

  const total = computeTotalDuration(clips);
  const audioEnd = audioTracks.reduce((acc, a) => {
    const d = durationById[a.fileId] ?? 30;
    return Math.max(acc, a.start + d);
  }, 0);
  const contentTime = Math.max(total, audioEnd, 5);
  const contentWidth = Math.max(contentTime * pps + 60, 320);

  const seekFromPointer = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const t = (e.clientX - rect.left) / pps;
      useEditorStore.getState().setPlayhead(t);
    },
    [pps]
  );

  const rulerDrag = useRef(false);

  const onRulerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      rulerDrag.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      seekFromPointer(e);
    },
    [seekFromPointer]
  );

  const onRulerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (rulerDrag.current) seekFromPointer(e);
    },
    [seekFromPointer]
  );

  const onRulerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    rulerDrag.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onRowPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // only when clicking empty track background (not a block)
      if (e.target === e.currentTarget) {
        e.preventDefault();
        rulerDrag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFromPointer(e);
      }
    },
    [seekFromPointer]
  );

  const onRowPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (rulerDrag.current && e.target === e.currentTarget) seekFromPointer(e);
    },
    [seekFromPointer]
  );

  const onRowPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    rulerDrag.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const hasSelection = Boolean(selectedClipId);

  return (
    <div className="rounded-xl border bg-card">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
        <ToolbarButton
          label="Split clip at playhead (S)"
          onClick={() => useEditorStore.getState().splitAtPlayhead()}
          disabled={clips.length === 0}
        >
          <Scissors className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Duplicate selected clip"
          onClick={() => selectedClipId && useEditorStore.getState().duplicateClip(selectedClipId)}
          disabled={!hasSelection}
        >
          <Copy className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Move clip left"
          onClick={() => selectedClipId && useEditorStore.getState().moveClip(selectedClipId, -1)}
          disabled={!hasSelection}
        >
          <ChevronLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Move clip right"
          onClick={() => selectedClipId && useEditorStore.getState().moveClip(selectedClipId, 1)}
          disabled={!hasSelection}
        >
          <ChevronRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Delete selected clip (Del)"
          onClick={() => selectedClipId && useEditorStore.getState().removeClip(selectedClipId)}
          disabled={!hasSelection}
          destructive
        >
          <Trash2 className="h-4 w-4" />
        </ToolbarButton>

        <div className="mx-2 hidden h-6 w-px bg-border sm:block" />

        <div className="flex items-center gap-1.5">
          <ToolbarButton label="Zoom out" onClick={() => setPps((p) => clamp(p / 1.6, MIN_PPS, MAX_PPS))}>
            <ZoomOut className="h-4 w-4" />
          </ToolbarButton>
          <Slider
            value={[pps]}
            min={MIN_PPS}
            max={MAX_PPS}
            step={1}
            onValueChange={(v) => setPps(v[0] ?? pps)}
            className="w-24 sm:w-36"
            aria-label="Timeline zoom"
          />
          <ToolbarButton label="Zoom in" onClick={() => setPps((p) => clamp(p * 1.6, MIN_PPS, MAX_PPS))}>
            <ZoomIn className="h-4 w-4" />
          </ToolbarButton>
        </div>

        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {clips.length} clip{clips.length === 1 ? '' : 's'} · {formatTimecode(total)}
        </span>
      </div>

      {/* Scrollable tracks */}
      <div ref={scrollRef} className="overflow-x-auto scrollbar-slim select-none">
        <div className="relative min-w-full" style={{ width: contentWidth }}>
          {/* Ruler */}
          <div
            role="slider"
            aria-label="Playhead position"
            aria-valuemin={0}
            aria-valuemax={Math.round(contentTime * 10) / 10}
            aria-valuenow={Math.round(useEditorStore.getState().playhead * 10) / 10}
            tabIndex={-1}
            className="relative h-7 cursor-pointer border-b bg-muted/40 touch-none"
            onPointerDown={onRulerPointerDown}
            onPointerMove={onRulerPointerMove}
            onPointerUp={onRulerPointerUp}
            onPointerCancel={onRulerPointerUp}
          >
            <RulerTicks contentTime={contentTime} pps={pps} />
          </div>

          {/* Video track */}
          <div
            className="relative h-16 touch-none border-b bg-muted/20 sm:h-20"
            onPointerDown={onRowPointerDown}
            onPointerMove={onRowPointerMove}
            onPointerUp={onRowPointerUp}
            onPointerCancel={onRowPointerUp}
          >
            <TrackLabel icon={<Film className="h-3.5 w-3.5" />} text="Video" />
            {clips.map((clip, i) => (
              <ClipBlock
                key={clip.id}
                clip={clip}
                index={i}
                pps={pps}
                startBefore={clips.slice(0, i).reduce((acc, c) => acc + clipDuration(c), 0)}
                durationById={durationById}
                sources={sources}
                selected={clip.id === selectedClipId}
              />
            ))}
            {clips.length === 0 && (
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                Timeline is empty — upload a video and press Add to timeline
              </span>
            )}
          </div>

          {/* Audio track */}
          <div
            className="relative h-10 touch-none"
            onPointerDown={onRowPointerDown}
            onPointerMove={onRowPointerMove}
            onPointerUp={onRowPointerUp}
            onPointerCancel={onRowPointerUp}
          >
            <TrackLabel icon={<Music className="h-3.5 w-3.5" />} text="Audio" />
            {audioTracks.map((track) => (
              <AudioBlock key={track.id} track={track} pps={pps} durationById={durationById} />
            ))}
            {audioTracks.length === 0 && (
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/70">
                Background music and voice-overs appear here
              </span>
            )}
          </div>

          <PlayheadLine pps={pps} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ruler
// ---------------------------------------------------------------------------

const RULER_STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function RulerTicks({ contentTime, pps }: { contentTime: number; pps: number }) {
  const major = RULER_STEPS.find((s) => s * pps >= 64) ?? 600;
  const minorCandidate = major / 5;
  const showMinor = minorCandidate * pps >= 10;
  const ticks: React.ReactNode[] = [];
  const count = Math.ceil(contentTime / major) + 1;
  for (let i = 0; i <= count; i++) {
    const t = i * major;
    ticks.push(
      <div key={`M${i}`} className="absolute top-0 h-full" style={{ left: t * pps }}>
        <div className="h-2.5 w-px bg-muted-foreground/50" />
        <span className="absolute left-1 top-0.5 font-mono text-[10px] leading-none text-muted-foreground">
          {rulerLabel(t)}
        </span>
      </div>
    );
    if (showMinor) {
      for (let j = 1; j < 5; j++) {
        const mt = t + minorCandidate * j;
        ticks.push(
          <div key={`m${i}-${j}`} className="absolute top-0 h-1.5 w-px bg-muted-foreground/25" style={{ left: mt * pps }} />
        );
      }
    }
  }
  return <div className="absolute inset-0">{ticks}</div>;
}

function rulerLabel(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  const sStr = Number.isInteger(s) ? String(s) : s.toFixed(1);
  return `${m}:${sStr.padStart(Number.isInteger(s) ? 2 : 4, '0')}`;
}

// ---------------------------------------------------------------------------
// Clip block + trim handles
// ---------------------------------------------------------------------------

function ClipBlock({
  clip,
  index,
  pps,
  startBefore,
  durationById,
  sources,
  selected,
}: {
  clip: EditorClip;
  index: number;
  pps: number;
  startBefore: number;
  durationById: DurationMap;
  sources: SourceItem[];
  selected: boolean;
}) {
  const src = sources.find((s) => s.file.id === clip.fileId);
  const dur = clipDuration(clip);
  const width = Math.max(dur * pps - 2, 10);
  const left = startBefore * pps;
  const srcDur = durationById[clip.fileId] ?? 0;
  const drag = useRef<{ x: number; in: number; out: number; side: 'l' | 'r' } | null>(null);

  const select = useCallback(() => {
    useEditorStore.getState().selectClip(clip.id);
  }, [clip.id]);

  const startTrim = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, side: 'l' | 'r') => {
      e.stopPropagation();
      e.preventDefault();
      select();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, in: clip.in, out: clip.out, side };
    },
    [clip.in, clip.out, select]
  );

  const moveTrim = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.x) / pps;
      const st = useEditorStore.getState();
      if (d.side === 'l') {
        const newIn = clamp(d.in + dx, 0, d.out - 0.1);
        st.updateClip(clip.id, { in: Math.round(newIn * 1000) / 1000 });
      } else {
        const max = srcDur > 0 ? srcDur : d.out + dx;
        const newOut = clamp(d.out + dx, d.in + 0.1, Math.max(d.in + 0.1, max));
        st.updateClip(clip.id, { out: Math.round(newOut * 1000) / 1000 });
      }
    },
    [clip.id, pps, srcDur]
  );

  const endTrim = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Clip ${index + 1}: ${src?.file.originalName ?? 'video'}, ${formatTimecode(dur)}`}
      onClick={(e) => {
        e.stopPropagation();
        select();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          select();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'group absolute bottom-1 top-1 cursor-pointer overflow-hidden rounded-md border bg-card shadow-sm transition-colors',
        selected ? 'z-10 border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50'
      )}
      style={{ left, width }}
    >
      {src && src.file.mime.startsWith('video/') ? (
        <video
          src={src.url}
          preload="metadata"
          muted
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70"
        />
      ) : (
        <div className="absolute inset-0 bg-primary/10" />
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-0.5 pt-2">
        <span className="truncate text-[10px] font-medium text-white/90">{src?.file.originalName ?? 'missing source'}</span>
        {clip.speed !== 1 && (
          <span className="shrink-0 rounded bg-primary px-1 font-mono text-[9px] font-semibold text-primary-foreground">
            {clip.speed}x
          </span>
        )}
        {(clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0 ? (
          <span className="shrink-0 rounded bg-white/20 px-1 font-mono text-[9px] text-white">fx</span>
        ) : null}
      </div>
      <span className="absolute right-1.5 top-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white/90">
        {formatTimecode(dur)}
      </span>

      {selected && (
        <>
          <div
            role="separator"
            aria-label="Trim clip start"
            onPointerDown={(e) => startTrim(e, 'l')}
            onPointerMove={moveTrim}
            onPointerUp={endTrim}
            onPointerCancel={endTrim}
            className="absolute inset-y-0 left-0 flex w-4 cursor-ew-resize touch-none items-center justify-center bg-primary/90 hover:bg-primary"
          >
            <div className="h-5 w-0.5 rounded bg-white/90" />
          </div>
          <div
            role="separator"
            aria-label="Trim clip end"
            onPointerDown={(e) => startTrim(e, 'r')}
            onPointerMove={moveTrim}
            onPointerUp={endTrim}
            onPointerCancel={endTrim}
            className="absolute inset-y-0 right-0 flex w-4 cursor-ew-resize touch-none items-center justify-center bg-primary/90 hover:bg-primary"
          >
            <div className="h-5 w-0.5 rounded bg-white/90" />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio block (draggable start time)
// ---------------------------------------------------------------------------

function AudioBlock({
  track,
  pps,
  durationById,
}: {
  track: { id: string; fileId: string; start: number; volume: number };
  pps: number;
  durationById: DurationMap;
}) {
  const source = useEditorStore((s) => s.sources.find((x) => x.file.id === track.fileId));
  const selected = useEditorStore((s) => s.selectedAudioId === track.id);
  const dur = durationById[track.fileId] ?? 30;
  const width = Math.max(dur * pps, 16);
  const drag = useRef<{ x: number; start: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      useEditorStore.getState().selectAudio(track.id);
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, start: track.start };
    },
    [track.id, track.start]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.x) / pps;
      useEditorStore.getState().updateAudioTrack(track.id, {
        start: Math.max(0, Math.round((d.start + dx) * 100) / 100),
      });
    },
    [pps, track.id]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Audio track ${source?.file.originalName ?? ''} starting at ${formatTimecode(track.start)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          useEditorStore.getState().selectAudio(track.id);
        }
      }}
      className={cn(
        'absolute bottom-0.5 top-0.5 cursor-grab touch-none overflow-hidden rounded-md border px-1.5 active:cursor-grabbing',
        selected ? 'z-10 border-primary ring-1 ring-primary' : 'border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25'
      )}
      style={{ left: track.start * pps, width }}
    >
      <div className="flex h-full items-center gap-1 truncate">
        <Music className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
        <span className="truncate text-[10px] font-medium text-foreground/90">
          {source?.file.originalName ?? 'missing audio'}
        </span>
        {track.volume !== 1 && (
          <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">{track.volume.toFixed(2)}x</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playhead
// ---------------------------------------------------------------------------

function PlayheadLine({ pps }: { pps: number }) {
  const t = useEditorStore((s) => s.playhead);
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-0" style={{ left: t * pps }}>
      <div className="absolute bottom-0 top-0 w-0.5 -translate-x-1/2 bg-primary shadow-[0_0_6px_rgba(139,92,246,0.7)]" />
      <div className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-primary" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small bits
// ---------------------------------------------------------------------------

function ToolbarButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          <span className={destructive ? 'text-destructive' : undefined}>{children}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TrackLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="pointer-events-none absolute left-2 top-1 z-10 flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {icon}
      {text}
    </div>
  );
}
