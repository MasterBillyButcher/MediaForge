// Local types + small helpers shared by the Downloader module sub-components.
import type { LucideIcon } from 'lucide-react';
import {
  Film, Music, Image as ImageIcon, File,
  Youtube, Instagram, Twitter, Facebook, Github, Archive, BookOpen,
  MessageCircle, Pin, Music2, Clapperboard, MonitorPlay, AudioLines, Link2,
  Radio, Twitch,
} from 'lucide-react';
import type { UrlProbeResult } from '@/lib/types';
import type { UrlDownloadProgress } from '@/lib/api-client';

export type { UrlProbeResult, UrlDownloadProgress };

/** Lifecycle of one URL inside the batch queue. */
export type QueueItemState =
  | 'waiting'
  | 'probing'
  | 'ready'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'unsupported';

/** Server-side job tracking for HLS / extraction queue items. */
export interface QueueJobInfo {
  kind: 'hls' | 'extract';
  id: string;
  progress: number;
  speed: string | null;
  eta: number | null;
}

export interface QueueItem {
  id: string;
  url: string;
  state: QueueItemState;
  probe: UrlProbeResult | null;
  /** failure reason (probe or download), null otherwise */
  error: string | null;
  progress: UrlDownloadProgress | null;
  fileName: string | null;
  sizeBytes: number | null;
  /** set while the item is processed by a server-side job (HLS/extract) */
  job?: QueueJobInfo | null;
}

// ---------------------------------------------------------------------------
// Platform labels (client-side mirror of the server detection table)
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<string, string> = {
  direct: 'Direct link',
  hls: 'HLS stream',
  'twitch-vod': 'Twitch VOD',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X (Twitter)',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  soundcloud: 'SoundCloud',
  imgur: 'Imgur',
  github: 'GitHub',
  wikipedia: 'Wikipedia',
  archive: 'Archive.org',
};

export function platformLabel(id: string): string {
  return PLATFORM_LABELS[id] ?? id;
}

// ---------------------------------------------------------------------------
// Media category icons
// ---------------------------------------------------------------------------

export const CATEGORY_META: Record<'video' | 'audio' | 'image' | 'file', { icon: LucideIcon; label: string }> = {
  video: { icon: Film, label: 'Video' },
  audio: { icon: Music, label: 'Audio' },
  image: { icon: ImageIcon, label: 'Image' },
  file: { icon: File, label: 'File' },
};

export function categoryMeta(category: string | undefined): { icon: LucideIcon; label: string } {
  if (category && category in CATEGORY_META) return CATEGORY_META[category as keyof typeof CATEGORY_META];
  return CATEGORY_META.file;
}

// ---------------------------------------------------------------------------
// Supported sources catalogue (honest capability labels)
// ---------------------------------------------------------------------------

export interface SourceInfo {
  id: string;
  label: string;
  icon: LucideIcon;
  /** true when the source is a common source of video files */
  video?: boolean;
}

export const DIRECT_SOURCES: SourceInfo[] = [
  { id: 'direct', label: 'Direct link', icon: Link2, video: true },
  { id: 'hls', label: 'HLS / m3u8 streams', icon: Radio, video: true },
  { id: 'twitch', label: 'Twitch VODs (.m3u8)', icon: Twitch, video: true },
  { id: 'archive', label: 'Archive.org', icon: Archive, video: true },
  { id: 'wikipedia', label: 'Wikipedia', icon: BookOpen },
  { id: 'github', label: 'GitHub', icon: Github, video: true },
  { id: 'imgur', label: 'Imgur (CDN)', icon: ImageIcon },
  { id: 'reddit', label: 'Reddit (direct media)', icon: MessageCircle, video: true },
  { id: 'pinterest', label: 'Pinterest (CDN)', icon: Pin },
];

export const AUTHORIZED_SOURCES: SourceInfo[] = [
  { id: 'youtube', label: 'YouTube', icon: Youtube, video: true },
  { id: 'tiktok', label: 'TikTok', icon: Music2, video: true },
  { id: 'instagram', label: 'Instagram', icon: Instagram, video: true },
  { id: 'facebook', label: 'Facebook', icon: Facebook, video: true },
  { id: 'x', label: 'X', icon: Twitter, video: true },
  { id: 'vimeo', label: 'Vimeo', icon: Clapperboard, video: true },
  { id: 'dailymotion', label: 'Dailymotion', icon: MonitorPlay, video: true },
  { id: 'soundcloud', label: 'SoundCloud', icon: AudioLines },
];

/** hostname of a URL string, or '' when it cannot be parsed */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** small unique id generator with a non-secure-context fallback */
export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
