'use client';

import {
  Ban, CheckCircle2, Clock, Download, Loader2, Package, RotateCcw, Trash2, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { formatBytes, formatDuration } from '@/lib/api-client';
import { playlistFileUrl, playlistZipUrl, type PlaylistJobDto, type TaskStateDto } from '@/lib/playlist/client';
import { cn } from '@/lib/utils';

interface JobMonitorProps {
  job: PlaylistJobDto;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
  busyAction: boolean;
}

const STATE_META: Record<TaskStateDto, { label: string; className: string }> = {
  pending: { label: 'Queued', className: 'text-muted-foreground' },
  downloading: { label: 'Downloading', className: 'text-primary' },
  processing: { label: 'Converting', className: 'text-amber-600 dark:text-amber-400' },
  completed: { label: 'Done', className: 'text-emerald-600 dark:text-emerald-400' },
  failed: { label: 'Failed', className: 'text-red-600 dark:text-red-400' },
  cancelled: { label: 'Cancelled', className: 'text-muted-foreground' },
};

function StateIcon({ state }: { state: TaskStateDto }) {
  switch (state) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" aria-hidden />;
    case 'cancelled':
      return <Ban className="h-4 w-4 text-muted-foreground" aria-hidden />;
    case 'downloading':
    case 'processing':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />;
  }
}

export function JobMonitor({ job, onCancel, onRetry, onDelete, busyAction }: JobMonitorProps) {
  const active = job.state === 'active';
  const hasFailed = job.failed > 0;
  const hasCompleted = job.completed > 0;
  const upNext = job.videos.find((v) => v.state === 'pending');
  const runningVideos = job.videos.filter((v) => v.state === 'downloading' || v.state === 'processing');

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Package className="h-4 w-4 text-primary" aria-hidden />
              <span className="truncate">{job.title}</span>
              <Badge
                variant={job.state === 'active' ? 'default' : job.state === 'completed' ? 'secondary' : 'outline'}
              >
                {job.state}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              {job.completed + job.failed} / {job.total} processed
              {job.format && <> · target {job.format.toUpperCase()}</>}
              {job.quality !== 'best' && <> · {job.quality}p</>}
              {job.totalBytes > 0 && <> · {formatBytes(job.totalBytes)} ready</>}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {active && (
              <Button variant="outline" size="sm" onClick={onCancel} disabled={busyAction}>
                <Ban className="h-4 w-4" aria-hidden /> Cancel all
              </Button>
            )}
            {!active && hasFailed && (
              <Button variant="outline" size="sm" onClick={onRetry} disabled={busyAction}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Retry {job.failed} failed
              </Button>
            )}
            {hasCompleted && (
              <Button size="sm" asChild>
                <a href={playlistZipUrl(job.id)}>
                  <Download className="h-4 w-4" aria-hidden /> Download all (.zip)
                </a>
              </Button>
            )}
            {!active && (
              <Button variant="ghost" size="sm" onClick={onDelete} disabled={busyAction} aria-label="Delete job and files">
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall progress */}
        <div className="space-y-1.5" aria-live="polite">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {job.percent}% overall
              {runningVideos.length > 0 && ` · ${runningVideos.length} in progress`}
              {upNext && job.pending > 1 && ` · ${job.pending - runningVideos.length} queued`}
            </span>
            {active && runningVideos[0]?.speed && <span>{runningVideos[0].speed}</span>}
          </div>
          <Progress value={job.percent} className="h-2.5" />
          {job.error && <p className="text-xs text-red-600 dark:text-red-400">{job.error}</p>}
        </div>

        {/* Running tasks detail */}
        {runningVideos.length > 0 && (
          <div className="space-y-2">
            {runningVideos.map((v) => (
              <div key={v.i} className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {v.i + 1}. {v.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {v.progress}%{v.speed ? ` · ${v.speed}` : ''}{v.eta != null ? ` · ETA ${formatDuration(v.eta)}` : ''}
                  </span>
                </div>
                <Progress value={v.progress} className="mt-2 h-1.5" />
                <p className="mt-1 text-xs text-muted-foreground">
                  {v.phase === 'processing' ? 'Converting with ffmpeg…' : 'Downloading from source…'}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Full task list */}
        {job.videos.length > 0 && (
          <div className="max-h-96 overflow-y-auto rounded-lg border" role="region" aria-label="Download items">
            <ul className="divide-y">
              {job.videos.map((v) => {
                const meta = STATE_META[v.state];
                return (
                  <li key={v.i} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <StateIcon state={v.state} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{v.title}</span>
                      {v.state === 'failed' && v.error && (
                        <span className="mt-0.5 block truncate text-xs text-red-600 dark:text-red-400" title={v.error}>
                          {v.error}
                        </span>
                      )}
                    </span>
                    {v.state === 'downloading' || v.state === 'processing' ? (
                      <span className="w-10 shrink-0 text-right text-xs tabular-nums">{v.progress}%</span>
                    ) : v.state === 'completed' && v.fileUrl ? (
                      <span className="flex shrink-0 items-center gap-2">
                        {v.sizeBytes != null && (
                          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                            {formatBytes(v.sizeBytes)}
                          </span>
                        )}
                        <a
                          href={playlistFileUrl(job.id, v.i)}
                          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                          aria-label={`Download ${v.title}`}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden /> File
                        </a>
                      </span>
                    ) : (
                      <span className={cn('shrink-0 text-xs', meta.className)}>{meta.label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
