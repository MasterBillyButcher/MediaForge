'use client';

import type { Dispatch, SetStateAction } from 'react';
import {
  Camera, Combine, Film, Gauge, Maximize2, Merge, Minimize2, Music,
  Repeat, RotateCw, Scissors, Stamp, Volume2, VolumeX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dropzone, UploadedFileCard, formatDurationClient } from '@/components/shared/dropzone';
import type { MediaFileRecord } from '@/lib/types';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolDef {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: 'audio' | 'video';
  multiple?: boolean;
  minFiles: number;
  /** Honest requirements shown in the tool panel. */
  note: string;
  processLabel: string;
}

export const TOOLS: ToolDef[] = [
  {
    id: 'audio-cut',
    title: 'Audio Cutter',
    description: 'Trim a start/end segment out of any audio file.',
    icon: Scissors,
    category: 'audio',
    minFiles: 1,
    note: 'Requires an audio file. Times are in seconds on the source timeline.',
    processLabel: 'Cut audio',
  },
  {
    id: 'audio-merge',
    title: 'Audio Merger',
    description: 'Join two or more audio files into a single track.',
    icon: Merge,
    category: 'audio',
    multiple: true,
    minFiles: 2,
    note: '2–10 audio files, joined in the order shown below.',
    processLabel: 'Merge audio',
  },
  {
    id: 'audio-compress',
    title: 'Audio Compressor',
    description: 'Normalize loudness and re-encode at a lower bitrate.',
    icon: Minimize2,
    category: 'audio',
    minFiles: 1,
    note: 'Requires an audio file. Applies loudness normalization, then the target bitrate.',
    processLabel: 'Compress audio',
  },
  {
    id: 'audio-volume',
    title: 'Audio Volume',
    description: 'Boost or reduce volume in decibels.',
    icon: Volume2,
    category: 'audio',
    minFiles: 1,
    note: 'Requires an audio file. Gain from -30 dB (quieter) to +4 dB (louder).',
    processLabel: 'Apply volume',
  },
  {
    id: 'audio-speed',
    title: 'Audio Speed',
    description: 'Speed playback up or down without re-cutting.',
    icon: Gauge,
    category: 'audio',
    minFiles: 1,
    note: 'Requires an audio file. 1.0 keeps the original pace.',
    processLabel: 'Change speed',
  },
  {
    id: 'audio-extract',
    title: 'Audio Extractor',
    description: 'Save the audio track of a video as a standalone file.',
    icon: Music,
    category: 'video',
    minFiles: 1,
    note: 'Requires a video file — its audio track is exported in the chosen format.',
    processLabel: 'Extract audio',
  },
  {
    id: 'audio-convert',
    title: 'Audio Converter',
    description: 'Convert between MP3, WAV, M4A, AAC, FLAC and OGG.',
    icon: Repeat,
    category: 'audio',
    minFiles: 1,
    note: 'Requires an audio file. WAV and FLAC are lossless (bitrate ignored).',
    processLabel: 'Convert audio',
  },
  {
    id: 'video-merge',
    title: 'Video Merger',
    description: 'Concatenate multiple video clips into one file.',
    icon: Combine,
    category: 'video',
    multiple: true,
    minFiles: 2,
    note: "2–10 video files. Clips are normalized to the first clip's resolution (30 fps).",
    processLabel: 'Merge videos',
  },
  {
    id: 'video-resize',
    title: 'Video Resizer',
    description: 'Scale a video to a new resolution.',
    icon: Maximize2,
    category: 'video',
    minFiles: 1,
    note: 'Requires a video file. Contain pads, cover crops, fill distorts.',
    processLabel: 'Resize video',
  },
  {
    id: 'video-rotate',
    title: 'Video Rotator',
    description: 'Rotate a video and mirror it horizontally or vertically.',
    icon: RotateCw,
    category: 'video',
    minFiles: 1,
    note: 'Requires a video file. Rotation and flips are applied in one pass.',
    processLabel: 'Rotate video',
  },
  {
    id: 'gif-maker',
    title: 'GIF Maker',
    description: 'Turn a video segment into an animated GIF.',
    icon: Film,
    category: 'video',
    minFiles: 1,
    note: 'Requires a video file. Segments up to 30 seconds.',
    processLabel: 'Create GIF',
  },
  {
    id: 'video-thumbnail',
    title: 'Thumbnail Grabber',
    description: 'Capture a full-resolution PNG frame from a video.',
    icon: Camera,
    category: 'video',
    minFiles: 1,
    note: 'Requires a video file. Runs synchronously — the frame returns immediately.',
    processLabel: 'Grab frame',
  },
  {
    id: 'video-watermark',
    title: 'Video Watermark',
    description: 'Overlay a text label or an image on your video.',
    icon: Stamp,
    category: 'video',
    minFiles: 1,
    note: 'Requires a video file. PNG with transparency is recommended for image watermarks.',
    processLabel: 'Apply watermark',
  },
  {
    id: 'video-mute',
    title: 'Video Mute',
    description: 'Strip the audio track, keep the video untouched.',
    icon: VolumeX,
    category: 'video',
    minFiles: 1,
    note: 'Requires a video file. The audio stream is removed entirely.',
    processLabel: 'Remove audio',
  },
];

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface WatermarkParams {
  type: 'text' | 'image';
  text?: string;
  /** fraction of video height, 0.02..0.4 */
  size?: number;
  /** normalized 0..1 */
  x?: number;
  y?: number;
  color?: string;
  /** 0..1 */
  opacity?: number;
  /** MediaFile id of the uploaded watermark image */
  fileId?: string;
  /** image width relative to video width, 0.05..0.8 */
  scale?: number;
}

export interface ToolParams {
  start?: number;
  end?: number;
  gainDb?: number;
  speed?: number;
  format?: string;
  bitrateKbps?: number | null;
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill';
  angle?: number;
  direction?: 'clockwise' | 'counterclockwise';
  flipH?: boolean;
  flipV?: boolean;
  fps?: number;
  gifWidth?: number;
  time?: number;
  watermark?: WatermarkParams;
}

export const DEFAULT_WATERMARK: WatermarkParams = {
  type: 'text',
  text: '',
  size: 0.1,
  x: 0.5,
  y: 0.5,
  color: '#ffffff',
  opacity: 0.9,
};

export function defaultParams(toolId: string): ToolParams {
  switch (toolId) {
    case 'audio-cut':
      return { start: 0, end: 10 };
    case 'audio-merge':
      return { bitrateKbps: null };
    case 'audio-compress':
      return { bitrateKbps: 128 };
    case 'audio-volume':
      return { gainDb: 0 };
    case 'audio-speed':
      return { speed: 1.25 };
    case 'audio-extract':
      return { format: 'mp3' };
    case 'audio-convert':
      return { format: 'mp3', bitrateKbps: 192 };
    case 'video-merge':
      return {};
    case 'video-resize':
      return { width: 1280, height: 720, fit: 'contain' };
    case 'video-rotate':
      return { angle: 90, direction: 'clockwise', flipH: false, flipV: false };
    case 'gif-maker':
      return { start: 0, end: 5, fps: 12, gifWidth: 480 };
    case 'video-thumbnail':
      return { time: 0 };
    case 'video-watermark':
      return { watermark: { ...DEFAULT_WATERMARK } };
    case 'video-mute':
      return {};
    default:
      return {};
  }
}

/** Map UI params to the exact op contract sent to /api/media/tool. */
export function buildOpParams(toolId: string, p: ToolParams): Record<string, unknown> {
  switch (toolId) {
    case 'audio-cut':
      return { start: p.start ?? 0, end: p.end ?? 0 };
    case 'audio-merge':
      return p.bitrateKbps ? { bitrateKbps: p.bitrateKbps } : {};
    case 'audio-compress':
      return { bitrateKbps: p.bitrateKbps ?? 128 };
    case 'audio-volume':
      return { gainDb: p.gainDb ?? 0 };
    case 'audio-speed':
      return { speed: p.speed ?? 1 };
    case 'audio-extract':
      return { format: p.format ?? 'mp3' };
    case 'audio-convert':
      return { format: p.format ?? 'mp3', ...(p.bitrateKbps ? { bitrateKbps: p.bitrateKbps } : {}) };
    case 'video-merge':
      return {};
    case 'video-resize':
      return { width: p.width, height: p.height, fit: p.fit ?? 'contain' };
    case 'video-rotate':
      return { angle: p.angle ?? 90, direction: p.direction ?? 'clockwise' };
    case 'video-flip':
      return { flipH: !!p.flipH, flipV: !!p.flipV };
    case 'gif-maker':
      return { start: p.start ?? 0, end: p.end ?? 0, fps: p.fps ?? 12, gifWidth: p.gifWidth ?? 480 };
    case 'video-watermark':
      return { watermark: p.watermark };
    case 'video-mute':
      return {};
    default:
      return {};
  }
}

export function validateParams(toolId: string, p: ToolParams, files: MediaFileRecord[]): string | null {
  const duration = files[0]?.meta?.duration ?? null;
  switch (toolId) {
    case 'audio-cut': {
      if (p.start == null || p.start < 0) return 'Enter a valid start time.';
      if (p.end == null || p.end <= p.start) return 'End time must be after the start time.';
      if (duration != null && p.end > duration + 0.05) {
        return `End time exceeds the file duration (${duration.toFixed(1)} s).`;
      }
      return null;
    }
    case 'video-resize': {
      if (!p.width || !p.height || p.width < 16 || p.height < 16) {
        return 'Enter a valid width and height (at least 16 px).';
      }
      return null;
    }
    case 'video-rotate': {
      if (!p.angle && !p.flipH && !p.flipV) return 'Choose a rotation angle or enable a flip.';
      return null;
    }
    case 'gif-maker': {
      if (p.start == null || p.start < 0) return 'Enter a valid start time.';
      if (p.end == null || p.end <= p.start) return 'End time must be after the start time.';
      if (p.end - p.start > 30) return 'GIF segments are limited to 30 seconds.';
      if (duration != null && p.end > duration + 0.05) {
        return `End time exceeds the file duration (${duration.toFixed(1)} s).`;
      }
      return null;
    }
    case 'video-watermark': {
      const wm = p.watermark;
      if (!wm) return 'Configure the watermark first.';
      if (wm.type === 'text' && !(wm.text ?? '').trim()) return 'Enter the watermark text.';
      if (wm.type === 'image' && !wm.fileId) return 'Upload a watermark image.';
      return null;
    }
    case 'audio-extract':
    case 'audio-convert':
      return p.format ? null : 'Choose an output format.';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Per-tool inputs
// ---------------------------------------------------------------------------

export interface ToolInputsProps {
  toolId: string;
  params: ToolParams;
  setParams: Dispatch<SetStateAction<ToolParams>>;
  files: MediaFileRecord[];
  watermarkImage: MediaFileRecord | null;
  onWatermarkImage: (file: MediaFileRecord | null) => void;
}

function numValue(raw: string, fallback = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function gainLabel(db: number): string {
  if (db === 0) return '0 dB — unchanged';
  return db > 0 ? `+${db} dB louder` : `${db} dB quieter`;
}

function positionHint(x: number, y: number): string {
  const h = x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'center';
  const v = y < 0.34 ? 'top' : y > 0.66 ? 'bottom' : 'middle';
  if (h === 'center' && v === 'middle') return 'centered on screen';
  if (h === 'center') return `${v} center`;
  if (v === 'middle') return `${h} center`;
  return `${v} ${h}`;
}

const LOSSY_FORMATS = new Set(['mp3', 'm4a', 'aac', 'ogg']);

export function ToolInputs({ toolId, params, setParams, files, watermarkImage, onWatermarkImage }: ToolInputsProps) {
  const duration = files[0]?.meta?.duration ?? null;

  switch (toolId) {
    // ------------------------------------------------------------- audio-cut
    case 'audio-cut':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cut-start">Start (seconds)</Label>
              <Input
                id="cut-start"
                type="number"
                min={0}
                step={0.1}
                value={params.start ?? 0}
                onChange={(e) => setParams((p) => ({ ...p, start: numValue(e.target.value) }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cut-end">End (seconds)</Label>
              <Input
                id="cut-end"
                type="number"
                min={0}
                step={0.1}
                value={params.end ?? 0}
                onChange={(e) => setParams((p) => ({ ...p, end: numValue(e.target.value) }))}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {duration != null
              ? `File duration: ${duration.toFixed(1)} s (${formatDurationClient(duration)}).`
              : 'File duration will appear here once a file is uploaded.'}
          </p>
        </div>
      );

    // ------------------------------------------------------------ audio-merge
    case 'audio-merge':
      return (
        <div className="space-y-2">
          <Label>Output bitrate (optional)</Label>
          <Select
            value={params.bitrateKbps ? String(params.bitrateKbps) : 'default'}
            onValueChange={(v) => setParams((p) => ({ ...p, bitrateKbps: v === 'default' ? null : Number(v) }))}
          >
            <SelectTrigger className="min-h-11 w-full" aria-label="Output bitrate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default (match source)</SelectItem>
              <SelectItem value="96">96 kbps</SelectItem>
              <SelectItem value="128">128 kbps</SelectItem>
              <SelectItem value="192">192 kbps</SelectItem>
              <SelectItem value="256">256 kbps</SelectItem>
              <SelectItem value="320">320 kbps</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Files are joined in the order listed above.</p>
        </div>
      );

    // --------------------------------------------------------- audio-compress
    case 'audio-compress':
      return (
        <div className="space-y-2">
          <Label>Target bitrate</Label>
          <Select value={String(params.bitrateKbps ?? 128)} onValueChange={(v) => setParams((p) => ({ ...p, bitrateKbps: Number(v) }))}>
            <SelectTrigger className="min-h-11 w-full" aria-label="Target bitrate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="96">96 kbps — smallest</SelectItem>
              <SelectItem value="128">128 kbps — balanced</SelectItem>
              <SelectItem value="160">160 kbps — high</SelectItem>
              <SelectItem value="192">192 kbps — highest</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Loudness is normalized (EBU R128) before re-encoding.</p>
        </div>
      );

    // ----------------------------------------------------------- audio-volume
    case 'audio-volume': {
      const gain = params.gainDb ?? 0;
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Gain</Label>
            <span className="text-sm font-medium tabular-nums">{gainLabel(gain)}</span>
          </div>
          <Slider
            min={-30}
            max={4}
            step={1}
            value={[gain]}
            onValueChange={([v]) => setParams((p) => ({ ...p, gainDb: v }))}
            aria-label="Volume gain in decibels"
          />
          <p className="text-xs text-muted-foreground">0 dB leaves the volume unchanged. +4 dB is the maximum boost.</p>
        </div>
      );
    }

    // ------------------------------------------------------------ audio-speed
    case 'audio-speed':
      return (
        <div className="space-y-2">
          <Label>Playback speed</Label>
          <Select value={String(params.speed ?? 1.25)} onValueChange={(v) => setParams((p) => ({ ...p, speed: Number(v) }))}>
            <SelectTrigger className="min-h-11 w-full" aria-label="Playback speed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5">0.5× — half speed</SelectItem>
              <SelectItem value="0.75">0.75× — slower</SelectItem>
              <SelectItem value="1">1× — unchanged</SelectItem>
              <SelectItem value="1.25">1.25× — faster</SelectItem>
              <SelectItem value="1.5">1.5× — one and a half</SelectItem>
              <SelectItem value="2">2× — double speed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );

    // ---------------------------------------------------------- audio-extract
    case 'audio-extract':
      return (
        <div className="space-y-2">
          <Label>Audio format</Label>
          <Select value={params.format ?? 'mp3'} onValueChange={(v) => setParams((p) => ({ ...p, format: v }))}>
            <SelectTrigger className="min-h-11 w-full" aria-label="Audio format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mp3">MP3 — universal</SelectItem>
              <SelectItem value="wav">WAV — lossless</SelectItem>
              <SelectItem value="m4a">M4A — Apple friendly</SelectItem>
              <SelectItem value="flac">FLAC — lossless archive</SelectItem>
              <SelectItem value="ogg">OGG — open format</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Upload a video above — its audio track becomes the output file.</p>
        </div>
      );

    // ---------------------------------------------------------- audio-convert
    case 'audio-convert': {
      const lossy = LOSSY_FORMATS.has(params.format ?? 'mp3');
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Target format</Label>
            <Select value={params.format ?? 'mp3'} onValueChange={(v) => setParams((p) => ({ ...p, format: v }))}>
              <SelectTrigger className="min-h-11 w-full" aria-label="Target format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mp3">MP3</SelectItem>
                <SelectItem value="wav">WAV</SelectItem>
                <SelectItem value="m4a">M4A</SelectItem>
                <SelectItem value="aac">AAC</SelectItem>
                <SelectItem value="flac">FLAC</SelectItem>
                <SelectItem value="ogg">OGG</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {lossy && (
            <div className="space-y-2">
              <Label>Bitrate</Label>
              <Select
                value={params.bitrateKbps ? String(params.bitrateKbps) : 'default'}
                onValueChange={(v) => setParams((p) => ({ ...p, bitrateKbps: v === 'default' ? null : Number(v) }))}
              >
                <SelectTrigger className="min-h-11 w-full" aria-label="Bitrate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="96">96 kbps</SelectItem>
                  <SelectItem value="128">128 kbps</SelectItem>
                  <SelectItem value="160">160 kbps</SelectItem>
                  <SelectItem value="192">192 kbps</SelectItem>
                  <SelectItem value="256">256 kbps</SelectItem>
                  <SelectItem value="320">320 kbps</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      );
    }

    // ------------------------------------------------------------ video-merge
    case 'video-merge':
      return (
        <p className="text-xs text-muted-foreground">
          No extra options — clips are concatenated in the order listed above and normalized to the first clip&apos;s
          resolution at 30 fps.
        </p>
      );

    // ----------------------------------------------------------- video-resize
    case 'video-resize': {
      const presets = [
        { label: '1920×1080', w: 1920, h: 1080 },
        { label: '1280×720', w: 1280, h: 720 },
        { label: '1080×1920', w: 1080, h: 1920 },
        { label: '854×480', w: 854, h: 480 },
      ];
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="vw">Width (px)</Label>
              <Input
                id="vw"
                type="number"
                min={16}
                step={2}
                value={params.width ?? 1280}
                onChange={(e) => setParams((p) => ({ ...p, width: numValue(e.target.value, 1280) }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vh">Height (px)</Label>
              <Input
                id="vh"
                type="number"
                min={16}
                step={2}
                value={params.height ?? 720}
                onChange={(e) => setParams((p) => ({ ...p, height: numValue(e.target.value, 720) }))}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                size="sm"
                variant={params.width === preset.w && params.height === preset.h ? 'default' : 'outline'}
                className="min-h-9"
                onClick={() => setParams((p) => ({ ...p, width: preset.w, height: preset.h }))}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Fit mode</Label>
            <Select value={params.fit ?? 'contain'} onValueChange={(v) => setParams((p) => ({ ...p, fit: v as ToolParams['fit'] }))}>
              <SelectTrigger className="min-h-11 w-full" aria-label="Fit mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contain">Contain — add padding, keep everything visible</SelectItem>
                <SelectItem value="cover">Cover — fill the frame, crop the overflow</SelectItem>
                <SelectItem value="fill">Fill — stretch, distorts the picture</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }

    // ----------------------------------------------------------- video-rotate
    case 'video-rotate': {
      const angle = params.angle ?? 90;
      return (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Rotation angle</Label>
            <div className="flex flex-wrap gap-2">
              {[0, 90, 180, 270].map((deg) => (
                <Button
                  key={deg}
                  type="button"
                  size="sm"
                  className="min-h-11 min-w-14"
                  variant={angle === deg ? 'default' : 'outline'}
                  aria-pressed={angle === deg}
                  aria-label={deg === 0 ? 'No rotation' : `Rotate ${deg} degrees`}
                  onClick={() => setParams((p) => ({ ...p, angle: deg }))}
                >
                  {deg === 0 ? 'None' : `${deg}°`}
                </Button>
              ))}
            </div>
          </div>
          {angle !== 0 && angle !== 180 && (
            <div className="space-y-2">
              <Label>Direction</Label>
              <RadioGroup
                value={params.direction ?? 'clockwise'}
                onValueChange={(v) => setParams((p) => ({ ...p, direction: v as ToolParams['direction'] }))}
                className="flex gap-4"
              >
                <Label htmlFor="dir-cw" className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="clockwise" id="dir-cw" />
                  <span className="text-sm font-medium">Clockwise</span>
                </Label>
                <Label htmlFor="dir-ccw" className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="counterclockwise" id="dir-ccw" />
                  <span className="text-sm font-medium">Counter-clockwise</span>
                </Label>
              </RadioGroup>
            </div>
          )}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="vflip-h">Flip horizontal</Label>
                <p className="text-xs text-muted-foreground">Mirror left to right</p>
              </div>
              <Switch id="vflip-h" checked={!!params.flipH} onCheckedChange={(v) => setParams((p) => ({ ...p, flipH: v }))} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="vflip-v">Flip vertical</Label>
                <p className="text-xs text-muted-foreground">Mirror top to bottom</p>
              </div>
              <Switch id="vflip-v" checked={!!params.flipV} onCheckedChange={(v) => setParams((p) => ({ ...p, flipV: v }))} />
            </div>
          </div>
        </div>
      );
    }

    // -------------------------------------------------------------- gif-maker
    case 'gif-maker': {
      const start = params.start ?? 0;
      const end = params.end ?? 5;
      const segLen = Math.max(0, end - start);
      const tooLong = segLen > 30;
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="gif-start">Start (seconds)</Label>
              <Input
                id="gif-start"
                type="number"
                min={0}
                step={0.1}
                value={start}
                onChange={(e) => setParams((p) => ({ ...p, start: numValue(e.target.value) }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gif-end">End (seconds)</Label>
              <Input
                id="gif-end"
                type="number"
                min={0}
                step={0.1}
                value={end}
                onChange={(e) => {
                  const next = numValue(e.target.value);
                  if (next - (params.start ?? 0) > 30) {
                    setParams((p) => ({ ...p, end: (p.start ?? 0) + 30 }));
                    toast.error('GIF segments are limited to 30 seconds — end time adjusted.');
                    return;
                  }
                  setParams((p) => ({ ...p, end: next }));
                }}
              />
            </div>
          </div>
          <p className={cn('text-xs', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
            Segment length: {segLen.toFixed(1)} s {tooLong ? '— over the 30 s limit' : '(max 30 s)'}
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>FPS</Label>
              <span className="text-sm font-medium tabular-nums">{params.fps ?? 12}</span>
            </div>
            <Slider
              min={5}
              max={20}
              step={1}
              value={[params.fps ?? 12]}
              onValueChange={([v]) => setParams((p) => ({ ...p, fps: v }))}
              aria-label="GIF frames per second"
            />
          </div>
          <div className="space-y-2">
            <Label>Output width</Label>
            <Select value={String(params.gifWidth ?? 480)} onValueChange={(v) => setParams((p) => ({ ...p, gifWidth: Number(v) }))}>
              <SelectTrigger className="min-h-11 w-full" aria-label="Output width">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="480">480 px — large</SelectItem>
                <SelectItem value="360">360 px — medium</SelectItem>
                <SelectItem value="256">256 px — small</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }

    // --------------------------------------------------------- video-thumbnail
    case 'video-thumbnail': {
      const time = params.time ?? 0;
      return (
        <div className="space-y-3">
          {duration != null ? (
            <>
              <div className="flex items-center justify-between">
                <Label>Frame time</Label>
                <span className="text-sm font-medium tabular-nums">
                  {time.toFixed(1)} s / {formatDurationClient(duration)}
                </span>
              </div>
              <Slider
                min={0}
                max={Math.max(0.1, duration)}
                step={0.1}
                value={[Math.min(time, duration)]}
                onValueChange={([v]) => setParams((p) => ({ ...p, time: v }))}
                aria-label="Frame time in seconds"
              />
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="thumb-time-num">Frame time (seconds)</Label>
              <Input
                id="thumb-time-num"
                type="number"
                min={0}
                step={0.1}
                value={time}
                onChange={(e) => setParams((p) => ({ ...p, time: numValue(e.target.value) }))}
              />
              <p className="text-xs text-muted-foreground">Upload a video to scrub its duration.</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">The PNG frame is produced synchronously — no queue.</p>
        </div>
      );
    }

    // --------------------------------------------------------- video-watermark
    case 'video-watermark': {
      const wm = params.watermark ?? DEFAULT_WATERMARK;
      const setWm = (patch: Partial<WatermarkParams>) =>
        setParams((p) => ({ ...p, watermark: { ...(p.watermark ?? DEFAULT_WATERMARK), ...patch } }));
      const sizePct = Math.round((wm.size ?? 0.1) * 100);
      const scalePct = Math.round((wm.scale ?? 0.2) * 100);
      const opacityPct = Math.round((wm.opacity ?? 0.9) * 100);
      return (
        <Tabs value={wm.type} onValueChange={(v) => setWm({ type: v as WatermarkParams['type'] })}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text">Text watermark</TabsTrigger>
            <TabsTrigger value="image">Image watermark</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wm-text">Text</Label>
              <Input
                id="wm-text"
                value={wm.text ?? ''}
                placeholder="© Your Name"
                maxLength={120}
                onChange={(e) => setWm({ text: e.target.value })}
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Text size</Label>
                <span className="text-sm font-medium tabular-nums">{sizePct}% of height</span>
              </div>
              <Slider min={2} max={30} step={1} value={[sizePct]} onValueChange={([v]) => setWm({ size: v / 100 })} aria-label="Text size" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wm-color">Color</Label>
              <div className="flex items-center gap-3">
                <input
                  id="wm-color"
                  type="color"
                  value={wm.color ?? '#ffffff'}
                  onChange={(e) => setWm({ color: e.target.value })}
                  className="h-11 w-14 cursor-pointer rounded-md border bg-background p-1"
                  aria-label="Watermark color"
                />
                <span className="font-mono text-sm text-muted-foreground">{(wm.color ?? '#ffffff').toUpperCase()}</span>
              </div>
            </div>
            <PositionSliders x={wm.x ?? 0.5} y={wm.y ?? 0.5} onX={(v) => setWm({ x: v })} onY={(v) => setWm({ y: v })} />
            <OpacitySlider value={wm.opacity ?? 0.9} onChange={(v) => setWm({ opacity: v })} />
          </TabsContent>

          <TabsContent value="image" className="mt-4 space-y-4">
            {!watermarkImage ? (
              <Dropzone
                category="image"
                compact
                label="Upload the watermark image"
                hint="PNG with transparency recommended"
                onUploaded={onWatermarkImage}
              />
            ) : (
              <div className="space-y-2">
                <UploadedFileCard file={watermarkImage} onRemove={() => onWatermarkImage(null)} />
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <Label>Image width</Label>
                    <span className="text-sm font-medium tabular-nums">{scalePct}% of video width</span>
                  </div>
                  <Slider min={5} max={80} step={1} value={[scalePct]} onValueChange={([v]) => setWm({ scale: v / 100 })} aria-label="Image scale" />
                </div>
              </div>
            )}
            <PositionSliders x={wm.x ?? 0.5} y={wm.y ?? 0.5} onX={(v) => setWm({ x: v })} onY={(v) => setWm({ y: v })} />
            <OpacitySlider value={wm.opacity ?? 0.9} onChange={(v) => setWm({ opacity: v })} />
            {wm.type === 'image' && !watermarkImage && (
              <p className="text-xs text-muted-foreground">Upload an image to enable processing.</p>
            )}
          </TabsContent>
        </Tabs>
      );
    }

    // -------------------------------------------------------------- video-mute
    case 'video-mute':
      return (
        <p className="text-sm text-muted-foreground">
          This removes the entire audio stream from the uploaded video. The video track is re-muxed without re-encoding
          where possible.
        </p>
      );

    default:
      return null;
  }
}

function PositionSliders({
  x, y, onX, onY,
}: {
  x: number;
  y: number;
  onX: (v: number) => void;
  onY: (v: number) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Horizontal position</Label>
          <span className="text-sm font-medium tabular-nums">{Math.round(x * 100)}%</span>
        </div>
        <Slider min={0} max={1} step={0.01} value={[x]} onValueChange={([v]) => onX(v)} aria-label="Horizontal position" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Vertical position</Label>
          <span className="text-sm font-medium tabular-nums">{Math.round(y * 100)}%</span>
        </div>
        <Slider min={0} max={1} step={0.01} value={[y]} onValueChange={([v]) => onY(v)} aria-label="Vertical position" />
      </div>
      <p className="text-xs text-muted-foreground">Anchor: {positionHint(x, y)} · x {x.toFixed(2)} / y {y.toFixed(2)}</p>
    </div>
  );
}

function OpacitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Opacity</Label>
        <span className="text-sm font-medium tabular-nums">{Math.round(value * 100)}%</span>
      </div>
      <Slider min={0} max={1} step={0.01} value={[value]} onValueChange={([v]) => onChange(v)} aria-label="Watermark opacity" />
    </div>
  );
}
