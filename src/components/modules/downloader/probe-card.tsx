'use client';

import { AlertCircle, CheckCircle2, Download, Loader2, ShieldAlert, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { formatBytes, formatDuration } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { categoryMeta, hostOf, platformLabel } from './types';
import type { UrlDownloadProgress, UrlProbeResult } from './types';

// ---------------------------------------------------------------------------
// Shared progress row (used by the single-URL card and the queue list)
// ---------------------------------------------------------------------------

export function DownloadProgressRow({ progress }: { progress: UrlDownloadProgress }) {
  const speed = progress.speedMbps != null ? `${progress.speedMbps.toFixed(1)} Mbps` : null;
  return (
    <div className="w-full space-y-1.5">
      {progress.percent != null ? (
        <Progress value={progress.percent} aria-label="Download progress" />
      ) : (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-primary/20"
          role="progressbar"
          aria-label="Downloading, total size unknown"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
        </div>
      )}
      <p className="text-xs text-muted-foreground tabular-nums">
        {progress.percent != null
          ? `${Math.floor(progress.percent)}%${progress.totalBytes != null ? ` of ${formatBytes(progress.totalBytes)}` : ''}`
          : `Received ${formatBytes(progress.receivedBytes)}`}
        {speed && <span> · {speed}</span>}
        {progress.etaSeconds != null && progress.etaSeconds > 0 && (
          <span> · {formatDuration(progress.etaSeconds)} left</span>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Direct download metadata card
// ---------------------------------------------------------------------------

export interface ProbeDirectCardProps {
  result: UrlProbeResult;
  /** active download progress, or null when idle */
  downloadProgress: UrlDownloadProgress | null;
  /** set right after the file was saved to the device */
  saved: { fileName: string; sizeBytes: number } | null;
  /** last download error message, if any */
  downloadError: string | null;
  /** true when the same URL is already being downloaded elsewhere (queue) */
  busyElsewhere: boolean;
  onDownload: () => void;
  onCancel: () => void;
}

export function ProbeDirectCard({
  result,
  downloadProgress,
  saved,
  downloadError,
  busyElsewhere,
  onDownload,
  onCancel,
}: ProbeDirectCardProps) {
  const { icon: CategoryIcon, label: categoryLabel } = categoryMeta(result.mediaCategory);
  const sizeKnown = result.sizeBytes != null && result.sizeBytes > 0;

  return (
    <div className="space-y-4 rounded-xl border bg-muted/30 p-4 sm:p-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <CategoryIcon className="h-6 w-6 text-primary" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={result.fileName ?? undefined}>
            {result.fileName || 'media file'}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">{platformLabel(result.platform)}</Badge>
            <Badge variant="outline" className="gap-1">
              <CategoryIcon className="h-3 w-3" aria-hidden /> {categoryLabel}
            </Badge>
            <span>{formatBytes(result.sizeBytes)}</span>
            {result.contentType && <span className="hidden font-mono sm:inline">{result.contentType}</span>}
          </div>
          <p className="mt-1.5 truncate text-xs text-muted-foreground/70" title={result.url}>
            {result.url}
          </p>
        </div>
      </div>

      <Separator />

      {downloadProgress ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <DownloadProgressRow progress={downloadProgress} />
          </div>
          <Button
            variant="outline"
            onClick={onCancel}
            className="h-11 shrink-0"
            aria-label="Cancel download"
          >
            <X className="h-4 w-4" aria-hidden /> Cancel
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Button
            size="lg"
            className="h-12 w-full text-base sm:w-auto sm:px-10"
            onClick={onDownload}
            disabled={busyElsewhere}
          >
            <Download className="h-5 w-5" aria-hidden />
            Download{sizeKnown ? ` · ${formatBytes(result.sizeBytes)}` : ''}
          </Button>
          {busyElsewhere && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              This URL is already downloading in the batch queue.
            </p>
          )}
          {saved && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              Saved {saved.fileName} ({formatBytes(saved.sizeBytes)}) to your device.
            </p>
          )}
          {downloadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Download failed</AlertTitle>
              <AlertDescription>{downloadError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Honest "not directly downloadable" panel
// ---------------------------------------------------------------------------

export function ProbeUnsupportedPanel({ result }: { result: UrlProbeResult }) {
  const host = hostOf(result.url);
  const navigate = useAppStore((s) => s.navigate);
  return (
    <Alert className="border-amber-500/40 bg-amber-500/5 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>Direct download not available</AlertTitle>
      <AlertDescription className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{platformLabel(result.platform)}</Badge>
          {host && <span className="text-xs text-muted-foreground">{host}</span>}
        </div>
        {result.note && <p className="text-sm">{result.note}</p>}
        <p className="text-sm">
          Direct downloads work for publicly accessible media file URLs (ending in .mp4, .webm, .mp3, .png,
          etc.). Platform-hosted streams require authorized access and are not supported.
        </p>
        <p className="text-sm">
          Need a whole playlist or an authorized download?{' '}
          <button
            type="button"
            className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
            onClick={() => navigate('playlist')}
          >
            Open the Playlist Downloader
          </button>{' '}
          — it supports cookie-authorized access and any output format.
        </p>
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Probe error panel (SSRF rejections, unreachable hosts, ...)
// ---------------------------------------------------------------------------

export function ProbeErrorPanel({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Could not inspect that URL</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
