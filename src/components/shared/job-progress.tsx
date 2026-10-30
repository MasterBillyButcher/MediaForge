'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Download, Ban, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { pollJob, resultDownloadUrl, formatBytes } from '@/lib/api-client';
import type { JobSnapshot } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface JobProgressProps {
  jobId: string;
  label?: string;
  className?: string;
  /** called once when the job completes successfully */
  onComplete?: (job: JobSnapshot) => void;
  /** hide the built-in result download card */
  hideResult?: boolean;
  compact?: boolean;
}

/**
 * Real job progress: polls /api/jobs/[id], shows actual ffmpeg progress,
 * supports cancellation, and offers the genuine result file for download.
 */
export function JobProgress({ jobId, label, className, onComplete, hideResult, compact }: JobProgressProps) {
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [done, setDone] = useState(false);
  const onCompleteRef = useRef(onComplete);
  const doneRef = useRef(false);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let stopped = false;
    let poller: { stop: () => void } | null = null;
    const start = async () => {
      await Promise.resolve(); // defer: polling callbacks are async by nature
      if (stopped) return;
      setDone(false);
      setJob(null);
      poller = pollJob(jobId, (j) => {
        setJob(j);
        if (j.state === 'completed' && !doneRef.current) {
          doneRef.current = true;
          setDone(true);
          onCompleteRef.current?.(j);
        }
      });
    };
    void start();
    return () => {
      stopped = true;
      poller?.stop();
    };
  }, [jobId]);

  const cancel = async () => {
    await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  };

  if (!job) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center gap-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          <span className="text-sm text-muted-foreground">Connecting to job…</span>
        </CardContent>
      </Card>
    );
  }

  const active = job.state === 'queued' || job.state === 'processing';

  return (
    <Card className={className}>
      <CardContent className={compact ? 'p-4' : 'p-5'}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {label ?? job.label} <span className="text-muted-foreground font-normal">— {job.type}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {job.state === 'queued' && 'Waiting in queue…'}
              {job.state === 'processing' && (
                <>
                  Processing {job.progress}%
                  {job.speed && <> · {job.speed}</>}
                  {job.etaSeconds != null && job.etaSeconds > 0 && <> · ~{formatEta(job.etaSeconds)} left</>}
                </>
              )}
              {job.state === 'completed' && 'Completed'}
              {job.state === 'failed' && 'Failed'}
              {job.state === 'cancelled' && 'Cancelled'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {job.state === 'completed' && <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="Completed" />}
            {job.state === 'failed' && <XCircle className="h-5 w-5 text-destructive" aria-label="Failed" />}
            {(job.state === 'cancelled') && <Ban className="h-5 w-5 text-muted-foreground" aria-label="Cancelled" />}
            {active && (
              <Button variant="ghost" size="sm" onClick={cancel} aria-label="Cancel processing">
                <Ban className="h-4 w-4 mr-1" aria-hidden /> Cancel
              </Button>
            )}
          </div>
        </div>

        {active && <Progress value={job.state === 'queued' ? 0 : job.progress} className="h-2" />}

        {job.state === 'failed' && (
          <p className="text-sm text-destructive mt-2 bg-destructive/10 rounded-md px-3 py-2 break-words">{job.error}</p>
        )}

        {job.state === 'completed' && job.result && !hideResult && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{job.result.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(job.result.sizeBytes)} · available for 3 hours</p>
            </div>
            <Button asChild size="sm">
              <a href={resultDownloadUrl(jobId)} download>
                <Download className="h-4 w-4 mr-1.5" aria-hidden /> Download
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${seconds % 60}s`;
}

/** Standalone result card (also used after editor quick export). */
export function ResultCard({ name, sizeBytes, downloadHref, note, className }: {
  name: string;
  sizeBytes?: number | null;
  downloadHref: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4', className)}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-xs text-muted-foreground">
          {sizeBytes != null ? `${formatBytes(sizeBytes)} · ` : ''}{note ?? 'ready to download'}
        </p>
      </div>
      <Button asChild size="sm">
        <a href={downloadHref} download>
          <Download className="h-4 w-4 mr-1.5" aria-hidden /> Download
        </a>
      </Button>
    </div>
  );
}

export { RotateCcw };
