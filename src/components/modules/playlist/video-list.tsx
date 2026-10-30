'use client';

import { useMemo, useState } from 'react';
import { CheckSquare, ListMusic, Search, Square, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatBytes, formatDuration } from '@/lib/api-client';
import { estimateItemBytes, type PlaylistEntryDto } from '@/lib/playlist/client';
import { cn } from '@/lib/utils';

interface VideoListProps {
  entries: PlaylistEntryDto[];
  selected: Set<number>;
  onToggle: (i: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onInvert: () => void;
  format: string;
  quality: string;
  bitrate: string;
}

const PAGE = 60;

export function VideoList(props: VideoListProps) {
  const { entries, selected, onToggle, onSelectAll, onSelectNone, onInvert, format, quality, bitrate } = props;
  const [filter, setFilter] = useState('');
  const [visible, setVisible] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => (e.title ?? '').toLowerCase().includes(q) || (e.uploader ?? '').toLowerCase().includes(q)
    );
  }, [entries, filter]);

  const selectedCount = selected.size;
  const totalDuration = entries.reduce((acc, e) => acc + (e.duration ?? 0), 0);
  const selectedDuration = entries.reduce((acc, e) => acc + (selected.has(e.i) ? (e.duration ?? 0) : 0), 0);
  const selectedBytes = entries.reduce(
    (acc, e) => acc + (selected.has(e.i) ? (estimateItemBytes(e.duration, format, quality, bitrate) ?? 0) : 0),
    0
  );
  const allSelected = selectedCount === entries.length;

  return (
    <div className="space-y-4">
      {/* Selection toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onSelectAll}>
            <CheckSquare className="h-4 w-4" aria-hidden /> All
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onSelectNone}>
            <Square className="h-4 w-4" aria-hidden /> None
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onInvert}>
            Invert
          </Button>
          <Badge variant="secondary" aria-live="polite">
            {selectedCount} / {entries.length} selected
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" aria-hidden />
            {formatDuration(selectedDuration)} selected
            {totalDuration > 0 && <span className="hidden sm:inline">· playlist {formatDuration(totalDuration)}</span>}
          </span>
          {selectedBytes > 0 && <span>≈ {formatBytes(selectedBytes)} estimated</span>}
        </div>
      </div>

      {/* Filter */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setVisible(PAGE);
          }}
          placeholder="Filter videos by title or author..."
          className="pl-9"
          aria-label="Filter videos"
        />
      </div>

      {/* List */}
      <ScrollArea className="max-h-[420px] overflow-y-auto rounded-lg border" type="always">
        <ul className="divide-y" role="listbox" aria-label="Playlist videos" aria-multiselectable>
          {filtered.slice(0, visible).map((e) => {
            const isSel = selected.has(e.i);
            return (
              <li key={e.i}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60',
                    isSel && 'bg-primary/5'
                  )}
                >
                  <Checkbox
                    checked={isSel}
                    onCheckedChange={() => onToggle(e.i)}
                    aria-label={`Select ${e.title ?? `video ${e.i + 1}`}`}
                    className="shrink-0"
                  />
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {e.i + 1}
                  </span>
                  {e.thumbnail ? (
                    <img
                      src={e.thumbnail}
                      alt=""
                      loading="lazy"
                      className="h-9 w-16 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span className="flex h-9 w-16 shrink-0 items-center justify-center rounded bg-muted">
                      <ListMusic className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {e.title ?? `Track ${e.i + 1}`}
                    </span>
                    {e.uploader && (
                      <span className="block truncate text-xs text-muted-foreground">{e.uploader}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {e.duration != null ? formatDuration(e.duration) : '—'}
                  </span>
                </label>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              No videos match “{filter}”.
            </li>
          )}
        </ul>
      </ScrollArea>
      {visible < filtered.length && (
        <div className="text-center">
          <Button type="button" variant="ghost" size="sm" onClick={() => setVisible((v) => v + PAGE)}>
            Show {Math.min(PAGE, filtered.length - visible)} more ({filtered.length - visible} hidden)
          </Button>
        </div>
      )}
    </div>
  );
}
