'use client';

import type { ComponentType } from 'react';
import { Check, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DIRECT_SOURCES, AUTHORIZED_SOURCES,
  type SourceInfo,
} from './types';

function SourceChip({ source, highlightVideo }: { source: SourceInfo; highlightVideo: boolean }) {
  const Icon = source.icon;
  return (
    <div className="flex min-h-11 items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">{source.label}</span>
      {highlightVideo && source.video && (
        <Badge variant="secondary" className="hidden sm:inline-flex text-[10px] px-1.5 py-0">Video</Badge>
      )}
    </div>
  );
}

function SourceGroup({
  title,
  caption,
  icon: GroupIcon,
  iconClassName,
  sources,
  highlightVideo,
}: {
  title: string;
  caption: string;
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  sources: SourceInfo[];
  highlightVideo: boolean;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <GroupIcon className={`h-4 w-4 ${iconClassName}`} aria-hidden />
          {title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map((s) => (
          <SourceChip key={s.id} source={s} highlightVideo={highlightVideo} />
        ))}
      </div>
    </section>
  );
}

/**
 * Honest capability overview: what this downloader can fetch directly and
 * which platforms require authorized access (and are therefore not downloaded).
 */
export function SupportedSources({ mode }: { mode: 'video' | 'universal' }) {
  const isVideo = mode === 'video';
  const direct = isVideo
    ? [...DIRECT_SOURCES].sort((a, b) => Number(b.video ?? false) - Number(a.video ?? false))
    : DIRECT_SOURCES;
  const authorized = isVideo
    ? [...AUTHORIZED_SOURCES].sort((a, b) => Number(b.video ?? false) - Number(a.video ?? false))
    : AUTHORIZED_SOURCES;

  return (
    <div className="space-y-8">
      {isVideo ? (
        <p className="text-sm text-muted-foreground">
          Direct links ending in <span className="font-mono text-xs">.mp4</span>,{' '}
          <span className="font-mono text-xs">.webm</span> or <span className="font-mono text-xs">.mkv</span>,{' '}
          <span className="font-mono text-xs">.m3u8</span> HLS streams (with quality selection and unmuted-audio
          recovery for Twitch VODs) plus files hosted on Archive.org, Reddit and GitHub download reliably. Platform
          pages are routed to the extraction engine automatically.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          All media categories are handled: video, audio, image and generic file URLs, HLS (m3u8) streams with
          quality selection, and platform pages via the extraction engine — the source type is detected
          automatically for every link.
        </p>
      )}

      <SourceGroup
        title="Direct download"
        caption="Publicly accessible media file URLs — fetched and streamed with real progress."
        icon={Check}
        iconClassName="text-emerald-600 dark:text-emerald-400"
        sources={direct}
        highlightVideo={isVideo}
      />

      <SourceGroup
        title="Authorized access only"
        caption="These platforms serve protected streams. MediaForge does not bypass their protections — use your own authorized tooling for content you own."
        icon={Lock}
        iconClassName="text-muted-foreground"
        sources={authorized}
        highlightVideo={isVideo}
      />
    </div>
  );
}
