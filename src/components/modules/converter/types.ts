// Local types, constants and helpers for the Converter module (video + audio).

import type { LucideIcon } from 'lucide-react';
import {
  AudioLines, AudioWaveform, Box, Clapperboard, Disc3, FileVideo, Film,
  Image, ListMusic, Music, Music2,
} from 'lucide-react';
import type { AudioFormat, ConvertSettings, VideoFormat } from '@/lib/types';

/** Operation selected with the segmented control (video mode only; audio mode always converts). */
export type ConverterMode = 'convert' | 'extract-audio' | 'remove-audio' | 'compress';

export type ResolutionValue = NonNullable<ConvertSettings['resolution']>;
export type FpsValue = NonNullable<ConvertSettings['fps']>;
export type SampleRateValue = NonNullable<ConvertSettings['audioSampleRate']>;
export type QualityValue = NonNullable<ConvertSettings['quality']>;

export interface FormatOption {
  value: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const VIDEO_FORMAT_OPTIONS: FormatOption[] = [
  { value: 'mp4', label: 'MP4', hint: 'H.264 + AAC', icon: FileVideo },
  { value: 'webm', label: 'WebM', hint: 'VP9 + Opus', icon: Clapperboard },
  { value: 'mov', label: 'MOV', hint: 'QuickTime', icon: Film },
  { value: 'mkv', label: 'MKV', hint: 'Matroska', icon: Box },
  { value: 'gif', label: 'GIF', hint: 'Animated, palette', icon: Image },
];

export const AUDIO_FORMAT_OPTIONS: FormatOption[] = [
  { value: 'mp3', label: 'MP3', hint: 'Universal lossy', icon: Music },
  { value: 'wav', label: 'WAV', hint: 'Uncompressed PCM', icon: AudioWaveform },
  { value: 'm4a', label: 'M4A', hint: 'AAC in MP4', icon: Music2 },
  { value: 'aac', label: 'AAC', hint: 'Raw AAC stream', icon: AudioLines },
  { value: 'flac', label: 'FLAC', hint: 'Lossless', icon: Disc3 },
  { value: 'ogg', label: 'OGG', hint: 'Vorbis lossy', icon: ListMusic },
];

export const RESOLUTION_OPTIONS: Array<{ value: ResolutionValue; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: '2160p', label: '2160p (4K)' },
  { value: '1440p', label: '1440p (2K)' },
  { value: '1080p', label: '1080p (Full HD)' },
  { value: '720p', label: '720p (HD)' },
  { value: '480p', label: '480p' },
  { value: '360p', label: '360p' },
  { value: '240p', label: '240p' },
  { value: '144p', label: '144p' },
];

/**
 * For GIF the resolution acts as a WIDTH cap (matches the server mapping):
 * original/other -> 640 px, 480p -> 854 px, 360p -> 640 px, 240p -> 426 px, 144p -> 256 px.
 */
export const GIF_RESOLUTION_OPTIONS: Array<{ value: ResolutionValue; label: string }> = [
  { value: 'original', label: 'Original (cap 640 px)' },
  { value: '480p', label: '480p (cap 854 px)' },
  { value: '360p', label: '360p (cap 640 px)' },
  { value: '240p', label: '240p (cap 426 px)' },
  { value: '144p', label: '144p (cap 256 px)' },
];

export const FPS_OPTIONS: Array<{ value: FpsValue; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: 12, label: '12 fps' },
  { value: 15, label: '15 fps' },
  { value: 24, label: '24 fps' },
  { value: 25, label: '25 fps' },
  { value: 30, label: '30 fps' },
  { value: 50, label: '50 fps' },
  { value: 60, label: '60 fps' },
];

export const AUDIO_BITRATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'original', label: 'Original (codec default)' },
  { value: '96', label: '96 kbps' },
  { value: '128', label: '128 kbps' },
  { value: '160', label: '160 kbps' },
  { value: '192', label: '192 kbps' },
  { value: '256', label: '256 kbps' },
  { value: '320', label: '320 kbps' },
];

export const SAMPLE_RATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: '48000', label: '48 kHz' },
  { value: '44100', label: '44.1 kHz' },
  { value: '22050', label: '22.05 kHz' },
  { value: '16000', label: '16 kHz' },
];

export const QUALITY_OPTIONS: Array<{ value: QualityValue; label: string; hint: string }> = [
  { value: 'high', label: 'High', hint: 'CRF 18 - best quality, larger files' },
  { value: 'balanced', label: 'Balanced', hint: 'CRF 23 - recommended default' },
  { value: 'compressed', label: 'Compressed', hint: 'CRF 30 - smallest files' },
];

/** Raw settings as edited by the controls (strings kept for select/input friendly handling). */
export interface SettingsState {
  resolution: ResolutionValue;
  fps: FpsValue;
  quality: QualityValue;
  /** '' = auto (quality preset / CRF) */
  videoBitrate: string;
  /** 'original' = omit and let the codec pick its default */
  audioBitrate: string;
  sampleRate: SampleRateValue;
  normalizeAudio: boolean;
}

export const DEFAULT_SETTINGS: SettingsState = {
  resolution: 'original',
  fps: 'original',
  quality: 'balanced',
  videoBitrate: '',
  audioBitrate: 'original',
  sampleRate: 'original',
  normalizeAudio: false,
};

/** A started conversion job rendered in the Processing section. */
export interface JobEntry {
  key: string;
  jobId: string;
  fileName: string;
  /** Human readable action captured when the job started, e.g. "Convert to MP4". */
  action: string;
}

export function actionLabel(isVideoMode: boolean, operation: ConverterMode, format: string): string {
  const f = format.toUpperCase();
  if (!isVideoMode || operation === 'convert') return `Convert to ${f}`;
  if (operation === 'extract-audio') return `Extract audio to ${f}`;
  if (operation === 'remove-audio') return `Remove audio, keep ${f}`;
  return `Compress as ${f}`;
}

/** Video bitrate validity (mirrors the server contract: 100..100000 kbps). */
export function isVideoBitrateValid(raw: string): boolean {
  if (raw.trim() === '') return true;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 100 && n <= 100_000;
}
