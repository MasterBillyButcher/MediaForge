'use client';

import { useCallback } from 'react';
import { Plus, X, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dropzone } from '@/components/shared/dropzone';
import type { MediaFileRecord } from '@/lib/types';
import { useEditorStore, formatTimecode, type SourceItem } from './editor-store';

export function MediaBin() {
  const sources = useEditorStore((s) => s.sources);
  const addSource = useEditorStore((s) => s.addSource);
  const clipsCount = useEditorStore((s) => s.clips.length);

  const onUploaded = useCallback(
    (file: MediaFileRecord) => {
      addSource(file);
    },
    [addSource]
  );

  return (
    <section aria-label="Media bin" className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Film className="h-4 w-4 text-primary" aria-hidden /> Media bin
        </h2>
        <Badge variant="outline" className="font-mono text-[10px]">
          {clipsCount} clip{clipsCount === 1 ? '' : 's'} on timeline
        </Badge>
      </div>

      <Dropzone
        category="video"
        multiple
        compact
        label="Drop videos here or click to browse"
        hint="Multiple files supported · each becomes a source you can trim"
        onUploaded={onUploaded}
      />

      {sources.length > 0 && (
        <ul
          className="mt-3 grid max-h-60 grid-cols-1 gap-2 overflow-y-auto scrollbar-slim sm:grid-cols-2"
          aria-label="Uploaded sources"
        >
          {sources.map((s) => (
            <SourceCard key={s.file.id} source={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SourceCard({ source }: { source: SourceItem }) {
  const addClip = useEditorStore((s) => s.addClipFromSource);
  const removeSource = useEditorStore((s) => s.removeSource);
  const meta = source.file.meta;
  const isVideo = source.file.mime.startsWith('video/');
  const isImage = source.file.mime.startsWith('image/');
  const dur = meta?.duration ?? 0;

  return (
    <li className="flex items-center gap-2.5 rounded-lg border p-2">
      {isVideo ? (
        <video
          src={source.url}
          preload="metadata"
          muted
          aria-label={`Thumbnail of ${source.file.originalName}`}
          className="h-12 w-20 shrink-0 rounded-md bg-black object-cover"
        />
      ) : isImage ? (
        <img
          src={source.url}
          alt={`Thumbnail of ${source.file.originalName}`}
          className="h-12 w-20 shrink-0 rounded-md bg-muted object-cover"
        />
      ) : (
        <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-medium uppercase text-primary">
          audio
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{source.file.originalName}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {dur > 0 ? formatTimecode(dur) : '—'}
          {meta && meta.width > 0 ? ` · ${meta.width}×${meta.height}` : ''}
          {source.file.sizeBytes ? ` · ${Math.max(1, Math.round(source.file.sizeBytes / 1024 / 1024))} MB` : ''}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0 text-xs"
        onClick={() => addClip(source.file.id)}
        aria-label={`Add ${source.file.originalName} to timeline`}
      >
        <Plus className="mr-1 h-3 w-3" aria-hidden /> Add
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => removeSource(source.file.id)}
        aria-label={`Remove ${source.file.originalName} from media bin`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
