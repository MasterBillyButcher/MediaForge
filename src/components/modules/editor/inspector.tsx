'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Type as TypeIcon,
  Music,
  Wand2,
  Download,
  Mic,
  Square,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Trash2,
  Plus,
  Scissors,
  Loader2,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dropzone } from '@/components/shared/dropzone';
import { JobProgress } from '@/components/shared/job-progress';
import { uploadFile, startEdlRender, saveBlob, formatDuration } from '@/lib/api-client';
import type { MediaFileRecord, EdlOutputFormat, EdlFilters } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  useEditorStore,
  useSelectedClip,
  buildEdl,
  validateEdl,
  computeTotalDuration,
  formatTimecode,
  clamp,
  clipTimelineStart,
  LIMITS,
  type EditorClip,
  type EditorOverlay,
  type EditorText,
  type InspectorTab,
} from './editor-store';
import { beginCanvasCapture, endCanvasCapture, primePlaybackAt } from './preview-canvas';

const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function Inspector() {
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const highlight = useEditorStore((s) => s.highlight);
  const setHighlight = useEditorStore((s) => s.setHighlight);

  useEffect(() => {
    if (!highlight) return;
    const id = setTimeout(() => setHighlight(null), 4500);
    return () => clearTimeout(id);
  }, [highlight, setHighlight]);

  return (
    <div className="rounded-xl border bg-card">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as InspectorTab)}>
        <div className="border-b p-2">
          <TabsList className="grid h-auto w-full grid-cols-5 bg-muted/60">
            <TabsTrigger value="clip" className="gap-1 py-1.5">
              <Scissors className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden text-xs md:inline">Clip</span>
            </TabsTrigger>
            <TabsTrigger value="text" className="gap-1 py-1.5">
              <TypeIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden text-xs md:inline">Text</span>
            </TabsTrigger>
            <TabsTrigger value="audio" className="gap-1 py-1.5">
              <Music className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden text-xs md:inline">Audio</span>
            </TabsTrigger>
            <TabsTrigger value="effects" className="gap-1 py-1.5">
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden text-xs md:inline">Effects</span>
            </TabsTrigger>
            <TabsTrigger value="export" className="gap-1 py-1.5">
              <Download className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden text-xs md:inline">Export</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="clip" className="mt-0 p-4">
          <ClipTab highlight={highlight} />
        </TabsContent>
        <TabsContent value="text" className="mt-0 p-4">
          <TextTab />
        </TabsContent>
        <TabsContent value="audio" className="mt-0 p-4">
          <AudioTab />
        </TabsContent>
        <TabsContent value="effects" className="mt-0 p-4">
          <EffectsTab />
        </TabsContent>
        <TabsContent value="export" className="mt-0 p-4">
          <ExportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared field components
// ---------------------------------------------------------------------------

function Section({ title, children, highlighted, id }: { title: string; children: React.ReactNode; highlighted?: boolean; id?: string }) {
  return (
    <section
      id={id}
      aria-label={title}
      className={cn(
        'rounded-lg border p-3 transition-shadow',
        highlighted && 'ring-2 ring-primary ring-offset-2 ring-offset-card'
      )}
    >
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function LabeledSlider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0] ?? value)}
        aria-label={label}
      />
    </div>
  );
}

function NumField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 0.1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }
  return (
    <div className="min-w-0 flex-1">
      <Label className="mb-1 block text-xs">{label}</Label>
      <Input
        type="number"
        className="h-8 font-mono text-xs"
        value={text}
        min={min}
        max={max}
        step={step}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text);
          if (Number.isFinite(v)) onCommit(v);
          else setText(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="mb-1 block text-xs">{label}</Label>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full cursor-pointer rounded-md border bg-transparent p-0.5"
      />
    </div>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function NoSelection({ what, hint }: { what: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Info className="h-6 w-6 text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium">No {what} selected</p>
      <p className="max-w-56 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function cropForAspect(target: number, srcAspect: number): { x: number; y: number; w: number; h: number } {
  const r = target / (srcAspect || 16 / 9);
  let w: number;
  let h: number;
  if (r >= 1) {
    w = 1;
    h = 1 / r;
  } else {
    w = r;
    h = 1;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

// ---------------------------------------------------------------------------
// CLIP TAB
// ---------------------------------------------------------------------------

function ClipTab({ highlight }: { highlight: string | null }) {
  const clip = useSelectedClip();
  const sources = useEditorStore((s) => s.sources);
  const output = useEditorStore((s) => s.output);
  const setOutput = useEditorStore((s) => s.setOutput);
  const cropMode = useEditorStore((s) => s.cropMode);
  const setCropMode = useEditorStore((s) => s.setCropMode);
  const updateClip = useEditorStore((s) => s.updateClip);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);

  if (!clip) {
    return <NoSelection what="clip" hint="Click a clip block on the timeline below to edit speed, trim, rotation and crop." />;
  }

  const src = sources.find((s) => s.file.id === clip.fileId);
  const srcDur = src?.file.meta?.duration ?? 0;
  const srcAspect = src?.file.meta && src.file.meta.width > 0 ? src.file.meta.width / src.file.meta.height : 16 / 9;
  const crop = clip.crop ?? null;

  const setC = (patch: Partial<EditorClip>) => updateClip(clip.id, patch);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{src?.file.originalName ?? 'Clip'}</p>
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
          {formatTimecode(Math.max(0, clip.out - clip.in))}
        </Badge>
      </div>

      <Section title="Playback">
        <LabeledSlider
          label="Speed"
          value={clip.speed}
          display={`${clip.speed.toFixed(2)}x`}
          min={0.25}
          max={4}
          step={0.05}
          onChange={(v) => setC({ speed: v })}
        />
        <LabeledSlider
          label="Volume"
          value={clip.volume ?? 1}
          display={`${(clip.volume ?? 1).toFixed(2)}`}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => setC({ volume: v })}
        />
        <SwitchRow
          label="Mute clip audio"
          checked={(clip.volume ?? 1) === 0}
          onChange={(on) => setC({ volume: on ? 0 : 1 })}
        />
      </Section>

      <Section title="Trim" highlighted={highlight === 'trim'} id="inspector-trim">
        <div className="flex items-end gap-2">
          <NumField
            label="In (s)"
            value={Math.round(clip.in * 100) / 100}
            min={0}
            max={clip.out - 0.1}
            onCommit={(v) => setC({ in: clamp(v, 0, Math.max(0, clip.out - 0.1)) })}
          />
          <NumField
            label="Out (s)"
            value={Math.round(clip.out * 100) / 100}
            min={clip.in + 0.1}
            max={srcDur > 0 ? srcDur : undefined}
            onCommit={(v) => setC({ out: clamp(v, clip.in + 0.1, srcDur > 0 ? srcDur : v) })}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Source duration: {srcDur > 0 ? `${formatTimecode(srcDur)}` : 'unknown'}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setPlayhead(clipTimelineStart(useEditorStore.getState().clips, clip.id) + 0.05)}
            aria-label="Move playhead to this clip start"
          >
            <RotateCw className="mr-1 h-3 w-3" aria-hidden /> Preview from clip start
          </Button>
        </div>
      </Section>

      <Section title="Rotate & flip">
        <div>
          <Label className="mb-1.5 block text-xs">Rotation</Label>
          <div className="grid grid-cols-4 gap-1.5">
            {([0, 90, 180, 270] as const).map((deg) => (
              <Button
                key={deg}
                variant={(clip.rotate ?? 0) === deg ? 'default' : 'outline'}
                size="sm"
                className="h-9 text-xs"
                onClick={() => setC({ rotate: deg })}
                aria-pressed={(clip.rotate ?? 0) === deg}
                aria-label={`Rotate ${deg} degrees`}
              >
                {deg === 0 ? (
                  '0°'
                ) : (
                  <span className="flex items-center gap-1">
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                    {deg}°
                  </span>
                )}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant={clip.flipH ? 'default' : 'outline'}
            size="sm"
            className="h-9 text-xs"
            onClick={() => setC({ flipH: !clip.flipH })}
            aria-pressed={Boolean(clip.flipH)}
          >
            <FlipHorizontal2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Flip H
          </Button>
          <Button
            variant={clip.flipV ? 'default' : 'outline'}
            size="sm"
            className="h-9 text-xs"
            onClick={() => setC({ flipV: !clip.flipV })}
            aria-pressed={Boolean(clip.flipV)}
          >
            <FlipVertical2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Flip V
          </Button>
        </div>
      </Section>

      <Section title="Fades">
        <div className="flex items-end gap-2">
          <NumField
            label="Fade in (s)"
            value={clip.fadeIn ?? 0}
            min={0}
            onCommit={(v) => setC({ fadeIn: clamp(v, 0, 30) })}
          />
          <NumField
            label="Fade out (s)"
            value={clip.fadeOut ?? 0}
            min={0}
            onCommit={(v) => setC({ fadeOut: clamp(v, 0, 30) })}
          />
        </div>
      </Section>

      <Section title="Crop" highlighted={highlight === 'crop'} id="inspector-crop">
        <SwitchRow
          label="Enable crop (drag on canvas)"
          checked={Boolean(crop)}
          onChange={(on) => {
            if (on) {
              setC({ crop: FULL_CROP });
              setCropMode(true);
            } else {
              setC({ crop: undefined });
              setCropMode(false);
            }
          }}
        />
        {crop && (
          <>
            <p className="text-xs text-muted-foreground">
              Drag on the preview to draw a crop area. Drag inside to move, edges to resize.
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: 'Full', a: 0 },
                { label: '16:9', a: 16 / 9 },
                { label: '9:16', a: 9 / 16 },
                { label: '1:1', a: 1 },
                { label: '4:5', a: 4 / 5 },
                { label: '4:3', a: 4 / 3 },
              ].map((p) => (
                <Button
                  key={p.label}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    if (p.a === 0) {
                      setC({ crop: FULL_CROP });
                    } else {
                      setC({ crop: cropForAspect(p.a, srcAspect) });
                    }
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono">
                {crop.x.toFixed(2)}, {crop.y.toFixed(2)} · {crop.w.toFixed(2)}×{crop.h.toFixed(2)}
              </span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setC({ crop: FULL_CROP })}>
                Reset crop
              </Button>
            </div>
            {cropMode && (
              <Badge className="w-fit bg-primary/90" variant="default">
                Crop mode active — use the preview
              </Badge>
            )}
          </>
        )}
      </Section>

      <Section title="Output canvas">
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: '16:9', w: 1280, h: 720 },
            { label: '9:16', w: 720, h: 1280 },
            { label: '1:1', w: 1080, h: 1080 },
            { label: '4:5', w: 864, h: 1080 },
            { label: '4:3', w: 1024, h: 768 },
          ].map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              className="h-9 flex-col gap-0 text-[11px] leading-tight"
              onClick={() => setOutput({ width: p.w, height: p.h })}
              aria-label={`Output canvas ${p.label} ${p.w} by ${p.h}`}
            >
              <span className="font-semibold">{p.label}</span>
              <span className="text-muted-foreground">
                {p.w}×{p.h}
              </span>
            </Button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <NumField
            label="Width"
            value={output.width}
            min={16}
            max={3840}
            step={2}
            onCommit={(v) => setOutput({ width: clamp(Math.round(v / 2) * 2, 16, 3840) })}
          />
          <NumField
            label="Height"
            value={output.height}
            min={16}
            max={3840}
            step={2}
            onCommit={(v) => setOutput({ height: clamp(Math.round(v / 2) * 2, 16, 3840) })}
          />
          <div>
            <Label className="mb-1 block text-xs">FPS</Label>
            <Select
              value={String(output.fps)}
              onValueChange={(v) => setOutput({ fps: parseInt(v, 10) })}
            >
              <SelectTrigger className="h-8 w-[76px] text-xs" aria-label="Output frame rate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[24, 25, 30, 50, 60].map((f) => (
                  <SelectItem key={f} value={String(f)}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TEXT TAB
// ---------------------------------------------------------------------------

function TextTab() {
  const texts = useEditorStore((s) => s.texts);
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const addText = useEditorStore((s) => s.addText);
  const updateText = useEditorStore((s) => s.updateText);
  const removeText = useEditorStore((s) => s.removeText);
  const selectText = useEditorStore((s) => s.selectText);

  const current = texts.find((t) => t.id === selectedTextId) ?? null;
  const setT = (patch: Partial<EditorText>) => current && updateText(current.id, patch);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Text overlays ({texts.length}/{LIMITS.texts})
        </h4>
        <Button size="sm" className="h-8" onClick={addText}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add text
        </Button>
      </div>

      {texts.length > 0 && (
        <div className="max-h-40 space-y-1.5 overflow-y-auto scrollbar-slim pr-1" role="list" aria-label="Text items">
          {texts.map((t) => (
            <div
              key={t.id}
              role="listitem"
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                t.id === selectedTextId ? 'border-primary bg-primary/10' : 'hover:border-primary/40'
              )}
              onClick={() => selectText(t.id)}
              onKeyDown={(e) => e.key === 'Enter' && selectText(t.id)}
              tabIndex={0}
              aria-label={`Text: ${t.text}`}
            >
              <TypeIcon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t.text || '(empty)'}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {formatTimecode(t.start)}–{formatTimecode(t.end)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  removeText(t.id);
                }}
                aria-label={`Remove text ${t.text}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {current ? (
        <Section title="Edit text">
          <Textarea
            value={current.text}
            onChange={(e) => setT({ text: e.target.value })}
            rows={2}
            aria-label="Text content"
            placeholder="Type the overlay text"
          />
          <div className="flex items-end gap-2">
            <NumField
              label="Start (s)"
              value={Math.round(current.start * 100) / 100}
              min={0}
              onCommit={(v) => setT({ start: Math.max(0, v) })}
            />
            <NumField
              label="End (s)"
              value={Math.round(current.end * 100) / 100}
              min={current.start + 0.1}
              onCommit={(v) => setT({ end: Math.max(current.start + 0.1, v) })}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setT({ start: useEditorStore.getState().playhead })}
            >
              Set start from playhead
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setT({ end: useEditorStore.getState().playhead })}
            >
              Set end from playhead
            </Button>
          </div>
          <LabeledSlider label="Position X" value={current.x} display={current.x.toFixed(2)} min={0} max={1} step={0.01} onChange={(v) => setT({ x: v })} />
          <LabeledSlider label="Position Y" value={current.y} display={current.y.toFixed(2)} min={0} max={1} step={0.01} onChange={(v) => setT({ y: v })} />
          <LabeledSlider label="Size" value={current.size} display={`${Math.round(current.size)}px`} min={10} max={200} step={1} onChange={(v) => setT({ size: v })} />
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Color" value={current.color} onChange={(v) => setT({ color: v })} />
            <div>
              <Label className="mb-1 block text-xs">Font</Label>
              <Select value={current.font ?? 'sans'} onValueChange={(v) => setT({ font: v as EditorText['font'] })}>
                <SelectTrigger className="h-8 text-xs" aria-label="Font">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sans">Sans</SelectItem>
                  <SelectItem value="sans-bold">Sans Bold</SelectItem>
                  <SelectItem value="mono">Mono</SelectItem>
                  <SelectItem value="serif">Serif</SelectItem>
                  <SelectItem value="serif-bold">Serif Bold</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <SwitchRow
            label="Background box"
            checked={Boolean(current.bgColor)}
            onChange={(on) => setT({ bgColor: on ? '#000000cc' : null })}
          />
          {current.bgColor && (
            <ColorField label="Background color" value={current.bgColor.slice(0, 7)} onChange={(v) => setT({ bgColor: `${v}cc` })} />
          )}
          <SwitchRow label="Outline" checked={Boolean(current.outline)} onChange={(v) => setT({ outline: v })} />
          <SwitchRow label="Shadow" checked={Boolean(current.shadow)} onChange={(v) => setT({ shadow: v })} />
          <div>
            <Label className="mb-1 block text-xs">Animation</Label>
            <Select
              value={current.animation ?? 'none'}
              onValueChange={(v) => setT({ animation: v as EditorText['animation'] })}
            >
              <SelectTrigger className="h-8 text-xs" aria-label="Text animation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="fade">Fade in / out</SelectItem>
                <SelectItem value="slide-up">Slide up</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Section>
      ) : (
        <NoSelection what="text" hint="Add a text overlay or click one in the list to edit it." />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AUDIO TAB
// ---------------------------------------------------------------------------

function AudioTab() {
  const audioTracks = useEditorStore((s) => s.audioTracks);
  const sources = useEditorStore((s) => s.sources);
  const addSource = useEditorStore((s) => s.addSource);
  const addAudioTrack = useEditorStore((s) => s.addAudioTrack);
  const updateAudioTrack = useEditorStore((s) => s.updateAudioTrack);
  const removeAudioTrack = useEditorStore((s) => s.removeAudioTrack);

  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [uploadingVo, setUploadingVo] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef(0);
  const startPlayheadRef = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecSecs(Math.floor((Date.now() - startTsRef.current) / 1000)), 250);
    return () => clearInterval(id);
  }, [recording]);

  // cleanup on unmount
  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec && rec.state === 'recording') {
        try {
          rec.stop();
        } catch {
          // ignore
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const onMusicUploaded = useCallback(
    (file: MediaFileRecord) => {
      addSource(file);
      addAudioTrack(file, useEditorStore.getState().playhead);
      toast.success(`Added ${file.originalName} as an audio track.`);
    },
    [addSource, addAudioTrack]
  );

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Microphone recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const mime = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        if (blob.size === 0) {
          toast.error('Recording was empty.');
          return;
        }
        const ext = mime.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voiceover-${Date.now()}.${ext}`, { type: mime });
        setUploadingVo(true);
        uploadFile(file)
          .then((res) => {
            useEditorStore.getState().addSource(res.file);
            addAudioTrack(res.file, startPlayheadRef.current);
            toast.success('Voice-over recorded and added at the playhead.');
          })
          .catch((err) => {
            toast.error(err instanceof Error ? err.message : 'Voice-over upload failed.');
          })
          .finally(() => setUploadingVo(false));
      };
      startTsRef.current = Date.now();
      startPlayheadRef.current = useEditorStore.getState().playhead;
      setRecSecs(0);
      rec.start();
      setRecording(true);
    } catch (err) {
      toast.error(err instanceof Error ? `Microphone error: ${err.message}` : 'Could not access the microphone.');
    }
  }, [addAudioTrack]);

  const stopRecording = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state === 'recording') rec.stop();
    setRecording(false);
  }, []);

  return (
    <div className="space-y-4">
      <Section title={`Background music & voice-overs (${audioTracks.length}/${LIMITS.audioTracks})`}>
        <Dropzone
          category="audio"
          compact
          label="Upload music or narration"
          hint="MP3, WAV, M4A, OGG, FLAC"
          onUploaded={onMusicUploaded}
        />
        {audioTracks.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Tracks start at the current playhead. Drag their blocks on the timeline to move them.
          </p>
        )}
        <div className="max-h-72 space-y-2 overflow-y-auto scrollbar-slim pr-1">
          {audioTracks.map((a) => {
            const src = sources.find((s) => s.file.id === a.fileId);
            const dur = src?.file.meta?.duration ?? 0;
            return (
              <div key={a.id} className="rounded-lg border p-2.5">
                <div className="mb-2 flex items-center gap-2">
                  <Music className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{src?.file.originalName ?? 'missing audio'}</span>
                  {dur > 0 && <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{formatDuration(dur)}</Badge>}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() => removeAudioTrack(a.id)}
                    aria-label={`Remove audio track ${src?.file.originalName ?? ''}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <NumField
                    label="Start (s)"
                    value={Math.round(a.start * 100) / 100}
                    min={0}
                    onCommit={(v) => updateAudioTrack(a.id, { start: Math.max(0, v) })}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 text-xs"
                    onClick={() => updateAudioTrack(a.id, { start: useEditorStore.getState().playhead })}
                  >
                    Start at playhead
                  </Button>
                </div>
                <div className="mt-2">
                  <LabeledSlider
                    label="Volume"
                    value={a.volume ?? 1}
                    display={(a.volume ?? 1).toFixed(2)}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(v) => updateAudioTrack(a.id, { volume: v })}
                  />
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <NumField
                    label="Fade in (s)"
                    value={a.fadeIn ?? 0}
                    min={0}
                    onCommit={(v) => updateAudioTrack(a.id, { fadeIn: clamp(v, 0, 60) })}
                  />
                  <NumField
                    label="Fade out (s)"
                    value={a.fadeOut ?? 0}
                    min={0}
                    onCommit={(v) => updateAudioTrack(a.id, { fadeOut: clamp(v, 0, 60) })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Voice-over recorder">
        {recording ? (
          <div className="flex items-center gap-3">
            <span className="flex h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
            <span className="font-mono text-sm tabular-nums" aria-live="polite">
              REC {formatTimecode(recSecs)}
            </span>
            <Button variant="destructive" size="sm" className="ml-auto h-9" onClick={stopRecording}>
              <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Stop
            </Button>
          </div>
        ) : (
          <Button className="h-10 w-full" onClick={() => void startRecording()} disabled={uploadingVo}>
            {uploadingVo ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Uploading recording…
              </>
            ) : (
              <>
                <Mic className="mr-2 h-4 w-4" aria-hidden /> Record voice-over
              </>
            )}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          The recording is uploaded and inserted at the playhead position where you pressed record.
        </p>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EFFECTS TAB
// ---------------------------------------------------------------------------

function EffectsTab() {
  const clip = useSelectedClip();
  const updateClip = useEditorStore((s) => s.updateClip);
  const removeClipFilters = useEditorStore((s) => s.removeClipFilters);
  const overlays = useEditorStore((s) => s.overlays);
  const addSource = useEditorStore((s) => s.addSource);
  const addOverlay = useEditorStore((s) => s.addOverlay);
  const updateOverlay = useEditorStore((s) => s.updateOverlay);
  const removeOverlay = useEditorStore((s) => s.removeOverlay);
  const sources = useEditorStore((s) => s.sources);

  const f: EdlFilters = clip?.filters ?? {};
  const setF = (patch: Partial<EdlFilters>) => {
    if (clip) updateClip(clip.id, { filters: { ...f, ...patch } });
  };

  const onOverlayUploaded = useCallback(
    (file: MediaFileRecord) => {
      addSource(file);
      addOverlay(file);
      toast.success(`Overlay ${file.originalName} added.`);
    },
    [addSource, addOverlay]
  );

  return (
    <div className="space-y-4">
      {!clip ? (
        <NoSelection what="clip" hint="Select a clip on the timeline to adjust its color effects." />
      ) : (
        <Section title="Color & blur">
          <LabeledSlider label="Brightness" value={f.brightness ?? 0} display={(f.brightness ?? 0).toFixed(2)} min={-1} max={1} step={0.05} onChange={(v) => setF({ brightness: v })} />
          <LabeledSlider label="Contrast" value={f.contrast ?? 0} display={(f.contrast ?? 0).toFixed(2)} min={-1} max={1} step={0.05} onChange={(v) => setF({ contrast: v })} />
          <LabeledSlider label="Saturation" value={f.saturation ?? 0} display={(f.saturation ?? 0).toFixed(2)} min={-1} max={1} step={0.05} onChange={(v) => setF({ saturation: v })} />
          <LabeledSlider label="Blur" value={f.blur ?? 0} display={`${(f.blur ?? 0).toFixed(1)}px`} min={0} max={10} step={0.5} onChange={(v) => setF({ blur: v })} />
          <LabeledSlider label="Sharpen (export only)" value={f.sharpen ?? 0} display={(f.sharpen ?? 0).toFixed(1)} min={0} max={3} step={0.1} onChange={(v) => setF({ sharpen: v })} />
          <SwitchRow label="Grayscale" checked={Boolean(f.grayscale)} onChange={(v) => setF({ grayscale: v })} />
          <SwitchRow label="Sepia" checked={Boolean(f.sepia)} onChange={(v) => setF({ sepia: v })} />
          <Button variant="outline" size="sm" className="h-8 w-full text-xs" onClick={() => removeClipFilters(clip.id)}>
            Reset effects
          </Button>
        </Section>
      )}

      <Section title={`Image overlays & watermarks (${overlays.length}/${LIMITS.overlays})`}>
        <Dropzone
          category="image"
          compact
          label="Upload overlay image"
          hint="PNG with transparency recommended"
          onUploaded={onOverlayUploaded}
        />
        {overlays.length === 0 && (
          <p className="text-xs text-muted-foreground">Overlays are positioned relative to the output canvas and can span any time range.</p>
        )}
        <div className="max-h-96 space-y-2 overflow-y-auto scrollbar-slim pr-1">
          {overlays.map((o) => {
            const src = sources.find((s) => s.file.id === o.fileId);
            return <OverlayCard key={o.id} overlay={o} name={src?.file.originalName ?? 'missing image'} onChange={(patch) => updateOverlay(o.id, patch)} onRemove={() => removeOverlay(o.id)} />;
          })}
        </div>
      </Section>
    </div>
  );
}

function OverlayCard({
  overlay,
  name,
  onChange,
  onRemove,
}: {
  overlay: EditorOverlay;
  name: string;
  onChange: (patch: Partial<EditorOverlay>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onRemove} aria-label={`Remove overlay ${name}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <LabeledSlider label="X" value={overlay.x} display={overlay.x.toFixed(2)} min={0} max={1} step={0.01} onChange={(v) => onChange({ x: v })} />
      <div className="mt-2">
        <LabeledSlider label="Y" value={overlay.y} display={overlay.y.toFixed(2)} min={0} max={1} step={0.01} onChange={(v) => onChange({ y: v })} />
      </div>
      <div className="mt-2">
        <LabeledSlider label="Scale" value={overlay.scale} display={`${Math.round(overlay.scale * 100)}%`} min={0.02} max={1} step={0.01} onChange={(v) => onChange({ scale: v })} />
      </div>
      <div className="mt-2">
        <LabeledSlider label="Opacity" value={overlay.opacity} display={overlay.opacity.toFixed(2)} min={0} max={1} step={0.05} onChange={(v) => onChange({ opacity: v })} />
      </div>
      <div className="mt-2 flex items-end gap-2">
        <NumField
          label="Start (s)"
          value={Math.round(overlay.start * 100) / 100}
          min={0}
          onCommit={(v) => onChange({ start: Math.max(0, v) })}
        />
        <NumField
          label="End (s)"
          value={Math.round(overlay.end * 100) / 100}
          min={overlay.start + 0.1}
          onCommit={(v) => onChange({ end: Math.max(overlay.start + 0.1, v) })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EXPORT TAB
// ---------------------------------------------------------------------------

function ExportTab() {
  const clips = useEditorStore((s) => s.clips);
  const texts = useEditorStore((s) => s.texts);
  const audioTracks = useEditorStore((s) => s.audioTracks);
  const overlays = useEditorStore((s) => s.overlays);
  const output = useEditorStore((s) => s.output);

  const [format, setFormat] = useState<EdlOutputFormat>('mp4');
  const [jobId, setJobId] = useState<string | null>(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  // quick export state
  const [quickActive, setQuickActive] = useState(false);
  const [quickPct, setQuickPct] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRef = useRef(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = computeTotalDuration(clips);
  const hasClips = clips.length > 0;

  // honest quick-export progress = live playhead position
  useEffect(() => {
    if (!quickActive) return;
    const unsub = useEditorStore.subscribe((s) => {
      const t = computeTotalDuration(s.clips);
      if (t > 0) setQuickPct(clamp((s.playhead / t) * 100, 0, 100));
    });
    return () => {
      unsub();
    };
  }, [quickActive]);

  useEffect(
    () => () => {
      unsubRef.current?.();
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      try {
        if (recRef.current && recRef.current.state === 'recording') recRef.current.stop();
      } catch {
        // ignore
      }
      endCanvasCapture();
    },
    []
  );

  const startRender = useCallback(async () => {
    const st = useEditorStore.getState();
    const edl = buildEdl(st);
    const err = validateEdl(edl);
    if (err) {
      toast.error(err);
      return;
    }
    setStarting(true);
    try {
      const job = await startEdlRender(edl, format, 'timeline-export');
      setJobId(job.id);
      setRenderOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start the render.');
    } finally {
      setStarting(false);
    }
  }, [format]);

  const stopQuickInternal = useCallback((cancelled: boolean) => {
    cancelRef.current = cancelled;
    const rec = recRef.current;
    if (rec && rec.state === 'recording') {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    useEditorStore.getState().setPlaying(false);
  }, []);

  const startQuick = useCallback(() => {
    const st = useEditorStore.getState();
    if (st.clips.length === 0) {
      toast.error('Add at least one clip to the timeline.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      toast.error('MediaRecorder is not supported in this browser.');
      return;
    }
    const stream = beginCanvasCapture();
    if (!stream) {
      toast.error('Canvas capture is not supported in this browser.');
      return;
    }
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';
    if (!mime) {
      toast.error('WebM recording is not supported in this browser.');
      endCanvasCapture();
      return;
    }
    chunksRef.current = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    } catch {
      toast.error('Could not start the recorder with WebM encoding.');
      endCanvasCapture();
      return;
    }
    recRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      endCanvasCapture();
      const cancelled = cancelRef.current;
      cancelRef.current = false;
      setQuickActive(false);
      setQuickPct(0);
      useEditorStore.getState().setPlaying(false);
      unsubRef.current?.();
      unsubRef.current = null;
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      if (!cancelled && chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        saveBlob(blob, 'mediaforge-export.webm');
        toast.success('Quick export downloaded as WebM.');
      }
      recRef.current = null;
    };

    st.setPlayhead(0);
    st.setPlaying(true);
    primePlaybackAt(0);
    rec.start(500);
    setQuickActive(true);
    toast.info('Realtime capture started — the timeline plays through once.');

    // auto-stop when playback finishes or is paused
    let armed = true;
    unsubRef.current = useEditorStore.subscribe((s) => {
      if (armed && !s.playing && recRef.current && recRef.current.state === 'recording') {
        armed = false;
        stopTimerRef.current = setTimeout(() => {
          const r = recRef.current;
          if (r && r.state === 'recording') {
            try {
              r.stop();
            } catch {
              // ignore
            }
          }
        }, 350);
      }
    });
  }, []);

  const quickProgress = (
    <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Capturing… (realtime)</span>
        <span className="font-mono tabular-nums">{Math.round(quickPct)}%</span>
      </div>
      <Progress value={quickPct} className="h-2" />
      <p className="text-[11px] text-muted-foreground">
        Realtime capture — the timeline plays through once while the browser records it.
      </p>
      <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => stopQuickInternal(true)}>
        Cancel capture
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <Section title="Project summary">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Canvas</dt>
          <dd className="text-right font-mono">{output.width}×{output.height} · {output.fps}fps</dd>
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="text-right font-mono">{formatTimecode(total)}</dd>
          <dt className="text-muted-foreground">Clips</dt>
          <dd className="text-right font-mono">{clips.length}</dd>
          <dt className="text-muted-foreground">Texts</dt>
          <dd className="text-right font-mono">{texts.length}</dd>
          <dt className="text-muted-foreground">Audio tracks</dt>
          <dd className="text-right font-mono">{audioTracks.length}</dd>
          <dt className="text-muted-foreground">Overlays</dt>
          <dd className="text-right font-mono">{overlays.length}</dd>
        </dl>
      </Section>

      <Section title="Render on server (high quality)">
        <div>
          <Label className="mb-1 block text-xs">Format</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as EdlOutputFormat)}>
            <SelectTrigger className="h-9 text-xs" aria-label="Output format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mp4">MP4 (recommended)</SelectItem>
              <SelectItem value="webm">WebM</SelectItem>
              <SelectItem value="mov">MOV</SelectItem>
              <SelectItem value="mkv">MKV</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block w-full">
              <Button className="h-10 w-full" disabled={!hasClips || starting} onClick={() => void startRender()}>
                {starting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Starting…
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" aria-hidden /> Render & Download (server, high quality)
                  </>
                )}
              </Button>
            </span>
          </TooltipTrigger>
          {!hasClips && <TooltipContent>Add at least one clip to the timeline.</TooltipContent>}
        </Tooltip>
        <p className="text-xs text-muted-foreground">
          FFmpeg renders the exact EDL with all trims, speed, filters, texts, overlays and audio.
        </p>
      </Section>

      <Separator />

      <Section title="Quick export (in browser)">
        {quickActive ? (
          quickProgress
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block w-full">
                  <Button variant="outline" className="h-10 w-full" disabled={!hasClips} onClick={startQuick}>
                    <Download className="mr-2 h-4 w-4" aria-hidden /> Quick export (WebM, in-browser)
                  </Button>
                </span>
              </TooltipTrigger>
              {!hasClips && <TooltipContent>Add at least one clip to the timeline.</TooltipContent>}
            </Tooltip>
            <p className="text-xs text-muted-foreground">
              Records the live preview in realtime (VP8/Opus WebM). No upload needed, quality matches the preview.
            </p>
          </>
        )}
      </Section>

      <Dialog open={renderOpen && Boolean(jobId)} onOpenChange={setRenderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Server render</DialogTitle>
            <DialogDescription>Real ffmpeg progress — you can cancel any time.</DialogDescription>
          </DialogHeader>
          {jobId && <JobProgress jobId={jobId} hideResult={false} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
