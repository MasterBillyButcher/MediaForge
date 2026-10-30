'use client';

import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  Edl,
  EdlClip,
  EdlText,
  EdlAudioTrack,
  EdlOverlay,
  MediaFileRecord,
  EdlOutputFormat,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceItem {
  file: MediaFileRecord;
  url: string;
}

/** Internal clip = EdlClip + stable id for selection/timeline interactions. */
export interface EditorClip extends EdlClip {
  id: string;
}

export interface EditorText extends EdlText {
  id: string;
}

export interface EditorAudio extends EdlAudioTrack {
  id: string;
}

export interface EditorOverlay extends EdlOverlay {
  id: string;
}

export interface EditorOutput {
  width: number;
  height: number;
  fps: number;
  background: string;
}

export const LIMITS = { clips: 20, audioTracks: 6, texts: 40, overlays: 12 };

const uid = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export const DEFAULT_OUTPUT: EditorOutput = {
  width: 1280,
  height: 720,
  fps: 30,
  background: '#000000',
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Output duration of one clip in timeline seconds. */
export function clipDuration(c: EdlClip): number {
  return Math.max(0, (c.out - c.in) / (c.speed || 1));
}

export function computeTotalDuration(clips: EdlClip[]): number {
  return clips.reduce((acc, c) => acc + clipDuration(c), 0);
}

export interface ClipAt {
  clip: EditorClip;
  index: number;
  /** timeline time where this clip starts */
  start: number;
  /** timeline time where this clip ends */
  end: number;
}

/** Walk the clip list and find the clip playing at timeline time t. */
export function findClipAt(clips: EditorClip[], t: number): ClipAt | null {
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const d = clipDuration(clips[i]);
    if (t < acc + d) {
      return { clip: clips[i], index: i, start: acc, end: acc + d };
    }
    acc += d;
  }
  return null;
}

/** Timeline time at which the given clip starts (0 if not found). */
export function clipTimelineStart(clips: EditorClip[], clipId: string): number {
  let acc = 0;
  for (const c of clips) {
    if (c.id === clipId) return acc;
    acc += clipDuration(c);
  }
  return acc;
}

/** mm:ss.s timecode used across the editor. */
export function formatTimecode(t: number): string {
  if (!Number.isFinite(t)) return '00:00.0';
  const sign = t < 0 ? '-' : '';
  const abs = Math.abs(t);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  const tenth = Math.floor((abs * 10) % 10);
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenth}`;
}

const FONT_FAMILIES: Record<NonNullable<EdlText['font']>, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  'sans-bold': 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  'serif-bold': 'Georgia, "Times New Roman", serif',
};

export function canvasFont(font: NonNullable<EdlText['font']> | undefined, size: number): string {
  const family = FONT_FAMILIES[font ?? 'sans'];
  const bold = font === 'sans-bold' || font === 'serif-bold';
  return `${bold ? '700 ' : ''}${size}px ${family}`;
}

/** CSS/canvas filter string for EdlFilters (sharpen has no live equivalent). */
export function filterString(f: EdlClip['filters']): string {
  if (!f) return 'none';
  const parts: string[] = [];
  if (f.brightness) parts.push(`brightness(${(1 + f.brightness).toFixed(3)})`);
  if (f.contrast) parts.push(`contrast(${(1 + f.contrast).toFixed(3)})`);
  if (f.saturation) parts.push(`saturate(${(1 + f.saturation).toFixed(3)})`);
  if (f.blur && f.blur > 0) parts.push(`blur(${f.blur.toFixed(2)}px)`);
  if (f.grayscale) parts.push('grayscale(1)');
  if (f.sepia) parts.push('sepia(1)');
  return parts.length ? parts.join(' ') : 'none';
}

export function hasFilters(f: EdlClip['filters']): boolean {
  if (!f) return false;
  return Boolean(
    (f.brightness && f.brightness !== 0) ||
      (f.contrast && f.contrast !== 0) ||
      (f.saturation && f.saturation !== 0) ||
      (f.blur && f.blur > 0) ||
      (f.sharpen && f.sharpen > 0) ||
      f.grayscale ||
      f.sepia
  );
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function even(n: number): number {
  return Math.max(16, Math.round(n / 2) * 2);
}

/** Build the server EDL object from editor state. */
export function buildEdl(s: {
  clips: EditorClip[];
  texts: EditorText[];
  overlays: EditorOverlay[];
  audioTracks: EditorAudio[];
  output: EditorOutput;
}): Edl {
  const clips: EdlClip[] = s.clips.map((c) => {
    const out: EdlClip = {
      fileId: c.fileId,
      in: round3(Math.max(0, c.in)),
      out: round3(Math.max(c.in + 0.1, c.out)),
      speed: clamp(c.speed || 1, 0.25, 4),
      volume: clamp(c.volume ?? 1, 0, 2),
    };
    if (c.crop && c.crop.w < 0.9995 && c.crop.h < 0.9995) {
      out.crop = {
        x: clamp(round3(c.crop.x), 0, 1),
        y: clamp(round3(c.crop.y), 0, 1),
        w: clamp(round3(c.crop.w), 0.01, 1),
        h: clamp(round3(c.crop.h), 0.01, 1),
      };
    }
    if (c.rotate) out.rotate = c.rotate;
    if (c.flipH) out.flipH = true;
    if (c.flipV) out.flipV = true;
    if (hasFilters(c.filters)) out.filters = { ...c.filters };
    if (c.fadeIn && c.fadeIn > 0) out.fadeIn = round3(c.fadeIn);
    if (c.fadeOut && c.fadeOut > 0) out.fadeOut = round3(c.fadeOut);
    return out;
  });

  const texts: EdlText[] = s.texts.map((t) => {
    const end = Math.max(t.start + 0.1, t.end);
    return {
      text: t.text,
      start: round3(Math.max(0, t.start)),
      end: round3(end),
      x: clamp(t.x, 0, 1),
      y: clamp(t.y, 0, 1),
      size: clamp(Math.round(t.size), 8, 400),
      color: t.color,
      font: t.font ?? 'sans',
      bgColor: t.bgColor ?? null,
      outline: Boolean(t.outline),
      shadow: Boolean(t.shadow),
      animation: t.animation ?? 'none',
    };
  });

  const audioTracks: EdlAudioTrack[] = s.audioTracks.map((a) => {
    const out: EdlAudioTrack = {
      fileId: a.fileId,
      start: round3(Math.max(0, a.start)),
      volume: clamp(a.volume ?? 1, 0, 2),
    };
    if (a.fadeIn && a.fadeIn > 0) out.fadeIn = round3(a.fadeIn);
    if (a.fadeOut && a.fadeOut > 0) out.fadeOut = round3(a.fadeOut);
    return out;
  });

  const overlays: EdlOverlay[] = s.overlays.map((o) => ({
    fileId: o.fileId,
    start: round3(Math.max(0, o.start)),
    end: round3(Math.max(o.start + 0.1, o.end)),
    x: clamp(o.x, 0, 1),
    y: clamp(o.y, 0, 1),
    scale: clamp(o.scale, 0.01, 2),
    opacity: clamp(o.opacity, 0, 1),
  }));

  return {
    width: even(s.output.width),
    height: even(s.output.height),
    fps: clamp(Math.round(s.output.fps), 1, 60),
    background: s.output.background || '#000000',
    clips,
    audioTracks,
    texts,
    overlays,
  };
}

/** Validate an EDL before submitting; returns an error message or null. */
export function validateEdl(edl: Edl): string | null {
  if (edl.clips.length === 0) return 'Add at least one clip to the timeline.';
  if (edl.clips.length > LIMITS.clips) return `Too many clips (max ${LIMITS.clips}).`;
  if (edl.audioTracks.length > LIMITS.audioTracks) return `Too many audio tracks (max ${LIMITS.audioTracks}).`;
  if (edl.texts.length > LIMITS.texts) return `Too many text items (max ${LIMITS.texts}).`;
  for (const c of edl.clips) {
    if (!(c.out > c.in)) return 'A clip has invalid trim range (out must be greater than in).';
    if (!c.fileId) return 'A clip references a missing source file.';
  }
  for (const t of edl.texts) {
    if (!(t.end > t.start)) return 'A text item has an invalid time range.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'mediaforge-editor-v1';

export interface PersistedDoc {
  version: 1;
  savedAt: number;
  clips: EditorClip[];
  texts: EditorText[];
  overlays: EditorOverlay[];
  audioTracks: EditorAudio[];
  output: EditorOutput;
}

export function saveDoc(s: {
  clips: EditorClip[];
  texts: EditorText[];
  overlays: EditorOverlay[];
  audioTracks: EditorAudio[];
  output: EditorOutput;
}): void {
  if (typeof window === 'undefined') return;
  try {
    const doc: PersistedDoc = {
      version: 1,
      savedAt: Date.now(),
      clips: s.clips,
      texts: s.texts,
      overlays: s.overlays,
      audioTracks: s.audioTracks,
      output: s.output,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // storage full / unavailable — non fatal
  }
}

export function loadDoc(): PersistedDoc | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as PersistedDoc;
    if (!doc || doc.version !== 1) return null;
    return doc;
  } catch {
    return null;
  }
}

/** Re-apply sane ranges to restored data before admitting it. */
export function sanitizeRestored(doc: PersistedDoc): PersistedDoc {
  const clips = (doc.clips ?? [])
    .filter((c) => c && typeof c.fileId === 'string' && Number.isFinite(c.in) && Number.isFinite(c.out) && c.out > c.in)
    .map((c) => ({
      ...c,
      id: c.id || uid(),
      in: Math.max(0, c.in),
      out: Math.max(c.in + 0.1, c.out),
      speed: clamp(c.speed || 1, 0.25, 4),
      volume: clamp(c.volume ?? 1, 0, 2),
    }));
  const texts = (doc.texts ?? [])
    .filter((t) => t && typeof t.text === 'string' && t.end > t.start)
    .map((t) => ({ ...t, id: t.id || uid() }));
  const overlays = (doc.overlays ?? [])
    .filter((o) => o && typeof o.fileId === 'string' && o.end > o.start)
    .map((o) => ({ ...o, id: o.id || uid() }));
  const audioTracks = (doc.audioTracks ?? [])
    .filter((a) => a && typeof a.fileId === 'string')
    .map((a) => ({ ...a, id: a.id || uid() }));
  const output = doc.output
    ? {
        width: even(doc.output.width),
        height: even(doc.output.height),
        fps: clamp(Math.round(doc.output.fps), 1, 60),
        background: doc.output.background || '#000000',
      }
    : { ...DEFAULT_OUTPUT };
  return { version: 1, savedAt: doc.savedAt ?? 0, clips, texts, overlays, audioTracks, output };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type InspectorTab = 'clip' | 'text' | 'audio' | 'effects' | 'export';

interface EditorState {
  sources: SourceItem[];
  clips: EditorClip[];
  texts: EditorText[];
  overlays: EditorOverlay[];
  audioTracks: EditorAudio[];
  output: EditorOutput;

  playhead: number;
  playing: boolean;

  selectedClipId: string | null;
  selectedTextId: string | null;
  selectedAudioId: string | null;
  selectedOverlayId: string | null;

  cropMode: boolean;
  activeTab: InspectorTab;
  /** e.g. 'trim' | 'crop' — briefly highlighted inspector section */
  highlight: string | null;

  addSource: (file: MediaFileRecord) => void;
  removeSource: (id: string) => void;

  addClipFromSource: (fileId: string) => void;
  updateClip: (id: string, patch: Partial<EditorClip>) => void;
  removeClip: (id: string) => void;
  duplicateClip: (id: string) => void;
  moveClip: (id: string, dir: -1 | 1) => void;
  splitAtPlayhead: () => void;
  removeClipFilters: (id: string) => void;

  addText: () => void;
  updateText: (id: string, patch: Partial<EditorText>) => void;
  removeText: (id: string) => void;

  addAudioTrack: (file: MediaFileRecord, start?: number) => void;
  updateAudioTrack: (id: string, patch: Partial<EditorAudio>) => void;
  removeAudioTrack: (id: string) => void;

  addOverlay: (file: MediaFileRecord) => void;
  updateOverlay: (id: string, patch: Partial<EditorOverlay>) => void;
  removeOverlay: (id: string) => void;

  setOutput: (patch: Partial<EditorOutput>) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlay: () => void;

  selectClip: (id: string | null) => void;
  selectText: (id: string | null) => void;
  selectAudio: (id: string | null) => void;
  selectOverlay: (id: string | null) => void;
  setCropMode: (on: boolean) => void;
  setActiveTab: (tab: InspectorTab) => void;
  setHighlight: (what: string | null) => void;

  admitRestore: (doc: PersistedDoc, admitted: { clips: EditorClip[]; texts: EditorText[]; overlays: EditorOverlay[]; audioTracks: EditorAudio[] }) => void;
  clearProject: () => void;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  sources: [],
  clips: [],
  texts: [],
  overlays: [],
  audioTracks: [],
  output: { ...DEFAULT_OUTPUT },

  playhead: 0,
  playing: false,

  selectedClipId: null,
  selectedTextId: null,
  selectedAudioId: null,
  selectedOverlayId: null,

  cropMode: false,
  activeTab: 'clip',
  highlight: null,

  // ------------------------------------------------------------- sources
  addSource: (file) =>
    set((s) => {
      if (s.sources.some((x) => x.file.id === file.id)) return s;
      return { sources: [...s.sources, { file, url: `/api/media/file/${file.id}?inline=1` }] };
    }),

  removeSource: (id) =>
    set((s) => {
      const removedClipIds = new Set(s.clips.filter((c) => c.fileId === id).map((c) => c.id));
      return {
        sources: s.sources.filter((x) => x.file.id !== id),
        clips: s.clips.filter((c) => c.fileId !== id),
        audioTracks: s.audioTracks.filter((a) => a.fileId !== id),
        overlays: s.overlays.filter((o) => o.fileId !== id),
        selectedClipId: s.selectedClipId && removedClipIds.has(s.selectedClipId) ? null : s.selectedClipId,
      };
    }),

  // --------------------------------------------------------------- clips
  addClipFromSource: (fileId) => {
    const s = get();
    if (s.clips.length >= LIMITS.clips) {
      toast.error(`Timeline limit reached (max ${LIMITS.clips} clips).`);
      return;
    }
    const src = s.sources.find((x) => x.file.id === fileId);
    if (!src) return;
    const dur = src.file.meta?.duration ?? 0;
    const out = dur > 0 ? Math.min(dur, 30) : 10;
    const clip: EditorClip = {
      id: uid(),
      fileId,
      in: 0,
      out,
      speed: 1,
      volume: 1,
    };
    set({ clips: [...s.clips, clip], selectedClipId: clip.id });
  },

  updateClip: (id, patch) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),

  removeClipFilters: (id) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, filters: undefined } : c)),
    })),

  removeClip: (id) =>
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== id),
      selectedClipId: s.selectedClipId === id ? null : s.selectedClipId,
    })),

  duplicateClip: (id) => {
    const s = get();
    if (s.clips.length >= LIMITS.clips) {
      toast.error(`Timeline limit reached (max ${LIMITS.clips} clips).`);
      return;
    }
    const idx = s.clips.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const src = s.clips[idx];
    const copy: EditorClip = {
      ...src,
      id: uid(),
      crop: src.crop ? { ...src.crop } : undefined,
      filters: src.filters ? { ...src.filters } : undefined,
    };
    const clips = [...s.clips];
    clips.splice(idx + 1, 0, copy);
    set({ clips, selectedClipId: copy.id });
  },

  moveClip: (id, dir) =>
    set((s) => {
      const idx = s.clips.findIndex((c) => c.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= s.clips.length) return s;
      const clips = [...s.clips];
      const [item] = clips.splice(idx, 1);
      clips.splice(to, 0, item);
      return { clips };
    }),

  splitAtPlayhead: () => {
    const s = get();
    const at = findClipAt(s.clips, s.playhead);
    if (!at) {
      toast.error('Move the playhead over a clip to split it.');
      return;
    }
    const { clip, start } = at;
    const local = clip.in + (s.playhead - start) * clip.speed;
    if (local - clip.in < 0.1 || clip.out - local < 0.1) {
      toast.error('Playhead is too close to the clip edge to split.');
      return;
    }
    const left: EditorClip = { ...clip, out: local };
    const right: EditorClip = {
      ...clip,
      id: uid(),
      in: local,
      crop: clip.crop ? { ...clip.crop } : undefined,
      filters: clip.filters ? { ...clip.filters } : undefined,
    };
    const idx = at.index;
    const clips = [...s.clips];
    clips.splice(idx, 1, left, right);
    set({ clips, selectedClipId: right.id });
  },

  // --------------------------------------------------------------- texts
  addText: () => {
    const s = get();
    if (s.texts.length >= LIMITS.texts) {
      toast.error(`Text limit reached (max ${LIMITS.texts}).`);
      return;
    }
    const start = s.playhead;
    const t: EditorText = {
      id: uid(),
      text: 'Your text here',
      start,
      end: Math.min(start + 3, Math.max(computeTotalDuration(s.clips), start + 3)),
      x: 0.5,
      y: 0.8,
      size: 48,
      color: '#ffffff',
      font: 'sans-bold',
      bgColor: null,
      outline: false,
      shadow: true,
      animation: 'none',
    };
    set({ texts: [...s.texts, t], selectedTextId: t.id });
  },

  updateText: (id, patch) =>
    set((s) => ({
      texts: s.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  removeText: (id) =>
    set((s) => ({
      texts: s.texts.filter((t) => t.id !== id),
      selectedTextId: s.selectedTextId === id ? null : s.selectedTextId,
    })),

  // -------------------------------------------------------- audio tracks
  addAudioTrack: (file, start = 0) => {
    const s = get();
    if (s.audioTracks.length >= LIMITS.audioTracks) {
      toast.error(`Audio track limit reached (max ${LIMITS.audioTracks}).`);
      return;
    }
    const a: EditorAudio = {
      id: uid(),
      fileId: file.id,
      start: Math.max(0, start),
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
    };
    set({ audioTracks: [...s.audioTracks, a], selectedAudioId: a.id });
  },

  updateAudioTrack: (id, patch) =>
    set((s) => ({
      audioTracks: s.audioTracks.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

  removeAudioTrack: (id) =>
    set((s) => ({
      audioTracks: s.audioTracks.filter((a) => a.id !== id),
      selectedAudioId: s.selectedAudioId === id ? null : s.selectedAudioId,
    })),

  // ------------------------------------------------------------ overlays
  addOverlay: (file) => {
    const s = get();
    if (s.overlays.length >= LIMITS.overlays) {
      toast.error(`Overlay limit reached (max ${LIMITS.overlays}).`);
      return;
    }
    const total = computeTotalDuration(s.clips);
    const o: EditorOverlay = {
      id: uid(),
      fileId: file.id,
      start: 0,
      end: Math.max(total, 5),
      x: 0.8,
      y: 0.8,
      scale: 0.2,
      opacity: 1,
    };
    set({ overlays: [...s.overlays, o], selectedOverlayId: o.id });
  },

  updateOverlay: (id, patch) =>
    set((s) => ({
      overlays: s.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    })),

  removeOverlay: (id) =>
    set((s) => ({
      overlays: s.overlays.filter((o) => o.id !== id),
      selectedOverlayId: s.selectedOverlayId === id ? null : s.selectedOverlayId,
    })),

  // ------------------------------------------------------------- output
  setOutput: (patch) => set((s) => ({ output: { ...s.output, ...patch } })),
  setPlayhead: (t) => {
    const total = computeTotalDuration(get().clips);
    set({ playhead: clamp(t, 0, Math.max(total, 0)) });
  },
  setPlaying: (playing) => set({ playing }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),

  selectClip: (id) =>
    set((s) => ({
      selectedClipId: id,
      // leaving crop mode when deselecting avoids confusing overlays
      cropMode: id === null ? false : s.cropMode,
    })),
  selectText: (id) => set({ selectedTextId: id }),
  selectAudio: (id) => set({ selectedAudioId: id }),
  selectOverlay: (id) => set({ selectedOverlayId: id }),
  setCropMode: (on) => set({ cropMode: on }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setHighlight: (what) => set({ highlight: what }),

  admitRestore: (doc, admitted) =>
    set((s) => ({
      clips: admitted.clips,
      texts: admitted.texts,
      overlays: admitted.overlays,
      audioTracks: admitted.audioTracks,
      output: doc.output ?? s.output,
    })),

  clearProject: () =>
    set((s) => ({
      clips: [],
      texts: [],
      overlays: [],
      audioTracks: [],
      selectedClipId: null,
      selectedTextId: null,
      selectedAudioId: null,
      selectedOverlayId: null,
      cropMode: false,
      playhead: 0,
      playing: false,
      sources: s.sources, // keep the media bin; user rebuilds the timeline
    })),
}));

// ---------------------------------------------------------------------------
// Derived hooks
// ---------------------------------------------------------------------------

export function useSelectedClip(): EditorClip | null {
  return useEditorStore((s) => s.clips.find((c) => c.id === s.selectedClipId) ?? null);
}

export function sourceDurationOf(fileId: string | undefined, sources: SourceItem[]): number {
  if (!fileId) return 0;
  const src = sources.find((x) => x.file.id === fileId);
  return src?.file.meta?.duration ?? 0;
}

export type { EdlOutputFormat };
