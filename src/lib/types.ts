// Shared types used by both backend API routes and frontend modules.

/** ffprobe metadata for a media file */
export interface ProbeResult {
  duration: number; // seconds (0 for images)
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  bitrate: number; // bits per second
  sizeBytes: number;
  format: string; // container / format name
}

export type MediaKind = 'upload' | 'result' | 'download';

export interface MediaFileRecord {
  id: string;
  kind: MediaKind;
  originalName: string;
  sizeBytes: number;
  mime: string;
  meta: ProbeResult | null;
  operation?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export type JobState = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface JobResult {
  fileId: string;
  name: string;
  sizeBytes: number;
  mime: string;
}

export interface JobSnapshot {
  id: string;
  type: string; // 'convert' | 'edl-render' | 'extract-subtitles' | 'gif' | ...
  state: JobState;
  progress: number; // 0..100
  speed: string | null; // e.g. '2.4x'
  etaSeconds: number | null;
  label: string;
  error: string | null;
  result: JobResult | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

// ---------------------------------------------------------------------------
// Conversion contracts
// ---------------------------------------------------------------------------

export type VideoFormat = 'mp4' | 'webm' | 'mov' | 'mkv' | 'gif';
export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'aac' | 'flac' | 'ogg';

export interface ConvertSettings {
  /** target container format */
  format: VideoFormat | AudioFormat;
  /** 'original' keeps source resolution; otherwise capped height */
  resolution?: 'original' | '2160p' | '1440p' | '1080p' | '720p' | '480p' | '360p' | '240p' | '144p';
  fps?: 'original' | 12 | 15 | 24 | 25 | 30 | 50 | 60;
  /** video bitrate in kbps; omitted => quality based CRF */
  videoBitrateKbps?: number | null;
  /** audio bitrate in kbps */
  audioBitrateKbps?: number | null;
  audioSampleRate?: 'original' | 44100 | 48000 | 22050 | 16000;
  quality?: 'high' | 'balanced' | 'compressed';
  mode?: 'convert' | 'extract-audio' | 'remove-audio' | 'compress';
  /** trim window (seconds, source timeline) — optional */
  trimStart?: number;
  trimEnd?: number;
  /** normalize audio loudness */
  normalizeAudio?: boolean;
}

// ---------------------------------------------------------------------------
// Video Editor EDL (Edit Decision List) — rendered server-side by ffmpeg
// ---------------------------------------------------------------------------

export interface EdlFilters {
  brightness?: number; // -1..1  (0 = neutral)
  contrast?: number; // -1..1  (0 = neutral)
  saturation?: number; // -1..1  (0 = neutral)
  blur?: number; // 0..10 px
  sharpen?: number; // 0..5
  grayscale?: boolean;
  sepia?: boolean;
}

export interface EdlClip {
  fileId: string; // uploaded MediaFile id on the server
  in: number; // seconds into source
  out: number; // seconds into source
  speed: number; // 0.25..4
  volume: number; // 0..2  (-1 => mute)
  crop?: { x: number; y: number; w: number; h: number }; // normalized 0..1
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  filters?: EdlFilters;
  fadeIn?: number; // seconds
  fadeOut?: number; // seconds
}

export interface EdlAudioTrack {
  fileId: string;
  start: number; // seconds on output timeline
  volume: number; // 0..2
  fadeIn?: number;
  fadeOut?: number;
}

export interface EdlText {
  text: string;
  start: number; // seconds on output timeline
  end: number;
  /** normalized 0..1 position of the text anchor (0.5,0.5 = center) */
  x: number;
  y: number;
  size: number; // px relative to output height (e.g. 48)
  color: string; // '#ffffff'
  font?: 'sans' | 'sans-bold' | 'mono' | 'serif' | 'serif-bold';
  bgColor?: string | null; // box color, null = none
  outline?: boolean;
  shadow?: boolean;
  animation?: 'none' | 'fade' | 'slide-up';
}

export interface EdlOverlay {
  fileId: string; // uploaded image (png with transparency recommended)
  start: number;
  end: number;
  /** normalized 0..1 position of overlay center */
  x: number;
  y: number;
  /** normalized width relative to output width (e.g. 0.2) */
  scale: number;
  opacity: number; // 0..1
}

export interface Edl {
  width: number; // output canvas width (even)
  height: number; // output canvas height (even)
  fps: number;
  background: string; // '#000000'
  clips: EdlClip[];
  audioTracks: EdlAudioTrack[];
  texts: EdlText[];
  overlays: EdlOverlay[];
}

export type EdlOutputFormat = 'mp4' | 'webm' | 'mov' | 'mkv';

// ---------------------------------------------------------------------------
// Image processing contract (sharp)
// ---------------------------------------------------------------------------

export interface ImageOps {
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  /** crop rect in SOURCE pixel coordinates (applied after rotate) */
  crop?: { left: number; top: number; width: number; height: number };
  grayscale?: boolean;
  resize?: {
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    /** background for contain/pad */
    background?: string;
  };
  format?: 'png' | 'jpeg' | 'webp' | 'avif' | 'tiff' | 'gif';
  quality?: number; // 1..100 for lossy formats
}

// ---------------------------------------------------------------------------
// URL probe / download contract
// ---------------------------------------------------------------------------

export interface UrlProbeResult {
  ok: boolean;
  direct: boolean; // true => server can fetch the media file directly
  platform: string; // 'direct' | 'youtube' | 'tiktok' | ...
  url: string;
  contentType?: string;
  sizeBytes?: number | null;
  fileName?: string;
  mediaCategory?: 'video' | 'audio' | 'image' | 'file';
  note?: string; // explanation for non-direct platforms
  error?: string;
}

// ---------------------------------------------------------------------------
// HLS (m3u8) streaming contract
// ---------------------------------------------------------------------------

export type HlsOutputFormat = 'mp4' | 'mkv' | 'ts' | 'mp3' | 'wav';

export interface HlsVariantInfo {
  id: number;
  url: string;
  label: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  /** bits per second, when the manifest declares it */
  bandwidth: number | null;
  codecs: string | null;
  isAudioOnly: boolean;
  /** bandwidth x duration estimate, when computable */
  estimatedBytes: number | null;
}

export interface HlsAnalyzeResult {
  ok: true;
  kind: 'hls';
  playlistType: 'master' | 'media';
  url: string;
  resolvedUrl: string;
  title: string;
  isTwitch: boolean;
  duration: number | null;
  segmentCount: number | null;
  discontinuities: number;
  variants: HlsVariantInfo[];
  unmutedAudio: { available: boolean; url: string | null };
  warnings: string[];
}

export interface HlsDownloadInput {
  url: string;
  audioUrl?: string | null;
  format: HlsOutputFormat;
  title?: string;
  duration?: number | null;
  /** optional cap on output length in seconds (for huge VODs) */
  maxDurationSec?: number | null;
  /** client-side size estimate for the disk pre-check */
  estimatedBytes?: number | null;
}

// ---------------------------------------------------------------------------
// Video/audio tool presets (used by additional tools modules)
// ---------------------------------------------------------------------------

export type SimpleToolId =
  | 'video-compress'
  | 'video-trim'
  | 'video-crop'
  | 'video-merge'
  | 'video-resize'
  | 'video-rotate'
  | 'video-speed'
  | 'video-reverse'
  | 'video-thumbnail'
  | 'gif-maker'
  | 'video-mute'
  | 'video-watermark'
  | 'audio-cut'
  | 'audio-merge'
  | 'audio-compress'
  | 'audio-volume'
  | 'audio-speed'
  | 'audio-extract'
  | 'audio-convert'
  | 'subtitle-extract';
