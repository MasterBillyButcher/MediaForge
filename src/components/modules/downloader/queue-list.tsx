'use client';

import {
  Ban, CheckCircle2, Clock, Download, ListVideo, Loader2, RotateCcw, X, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/api-client';
import { platformLabel } from './types';
import type { QueueItem, QueueItemState } from './types';
import { DownloadProgressRow } from './probe-card';

const STATE_META: Record<QueueItemState, { icon: LucideIcon; label: string; className: string; spin?: boolean }> = {
  waiting: { icon: Clock, label: 'Waiting', className: 'text-muted-foreground' },
  probing: { icon: Loader2, label: 'Probing', className: 'text-muted-foreground', spin: true },
  ready: { icon: Download, label: 'Ready', className: 'text-muted-foreground' },
  downloading: { icon: Download, label: 'Downloading', className: 'text-foreground' },
  completed: { icon: CheckCircle2, label: 'Completed', className: 'text-emerald-600 dark:text-emerald-400' },
  failed: { icon: XCircle, label: 'Failed', className: 'text-destructive' },
  unsupported: { icon: Ban, label: 'Unsupported', className: 'text-muted-foreground' },
};

export interface QueueListProps {
  items: QueueItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

export function QueueList({ items, onCancel, onRetry, onRemove }: QueueListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
        <ListVideo className="mb-2 h-8 w-8 text-muted-foreground/40" aria-hidden />
        <p className="text-sm font-medium">Queue is empty</p>
        <p className="mt-1 text-xs text-muted-foreground">Paste one or more URLs above to add them.</p>
      </div>
    );
  }

  return (
    <ul className="max-h-96 space-y-2 overflow-y-auto scrollbar-slim pr-1" aria-label="Download queue">
      {items.map((item) => (
        <QueueItemRow key={item.id} item={item} onCancel={onCancel} onRetry={onRetry} onRemove={onRemove} />
      ))}
    </ul>
  );
}

function QueueItemRow({
  item,
  onCancel,
  onRetry,
  onRemove,
}: {
  item: QueueItem;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const meta = STATE_META[item.state];
  const StateIcon = meta.icon;
  const removable = item.state !== 'downloading' && item.state !== 'probing';

  return (
    <li className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <StateIcon
          className={`h-4 w-4 shrink-0 ${meta.className}${meta.spin ? ' animate-spin' : ''}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={item.url}>
          {item.url}
        </span>
        {item.probe && (
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
            {platformLabel(item.probe.platform)}
          </Badge>
        )}
        <Badge
          variant={item.state === 'failed' ? 'destructive' : item.state === 'downloading' ? 'default' : 'secondary'}
          className="shrink-0"
        >
          {meta.label}
        </Badge>
        {item.state === 'downloading' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onCancel(item.id)}
            aria-label={`Cancel download of ${item.url}`}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        )}
        {item.state === 'failed' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onRetry(item.id)}
            aria-label={`Retry download of ${item.url}`}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </Button>
        )}
        {removable && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onRemove(item.id)}
            aria-label={`Remove ${item.url} from queue`}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      {item.state === 'downloading' && item.progress && (
        <div className="mt-2 pl-6.5 sm:pl-7">
          <DownloadProgressRow progress={item.progress} />
        </div>
      )}

      {item.state === 'completed' && (
        <p className="mt-1 pl-6.5 text-xs text-muted-foreground sm:pl-7">
          {item.fileName ?? 'file'} · {formatBytes(item.sizeBytes)} saved
        </p>
      )}

      {item.state === 'failed' && item.error && (
        <p className="mt-1 pl-6.5 text-xs text-destructive sm:pl-7" role="alert">
          {item.error}
        </p>
      )}

      {item.state === 'unsupported' && (
        <p className="mt-1 pl-6.5 text-xs text-muted-foreground sm:pl-7">
          Not a direct media file — platform-hosted streams require authorized access and are skipped.
        </p>
      )}
    </li>
  );
}
