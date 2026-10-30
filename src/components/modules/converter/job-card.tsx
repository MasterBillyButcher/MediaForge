'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { JobProgress } from '@/components/shared/job-progress';
import { pollJob, formatBytes } from '@/lib/api-client';
import type { JobSnapshot } from '@/lib/types';
import type { JobEntry } from './types';

interface ConverterJobCardProps {
  entry: JobEntry;
  onDismiss: (key: string) => void;
}

/**
 * Wraps the shared JobProgress (real polling, cancel, download) with:
 * - a lightweight secondary watcher that raises an honest toast when the job fails;
 * - a success toast when the job completes;
 * - a dismiss control so finished entries stay visible until the user removes them.
 */
export function ConverterJobCard({ entry, onDismiss }: ConverterJobCardProps) {
  const { jobId, fileName } = entry;

  useEffect(() => {
    let stopped = false;
    // Secondary low-frequency poll used only for failure/success notifications;
    // the visible progress UI is driven by JobProgress itself.
    const watcher = pollJob(
      jobId,
      (job) => {
        if (stopped) return;
        if (job.state === 'failed') {
          stopped = true;
          watcher.stop();
          toast.error(`${fileName}: job failed`, {
            description: job.error ?? 'The server reported an unknown error.',
          });
        } else if (job.state === 'completed' || job.state === 'cancelled') {
          stopped = true;
          watcher.stop();
        }
      },
      1500
    );
    return () => {
      stopped = true;
      watcher.stop();
    };
  }, [jobId, fileName]);

  const handleComplete = (job: JobSnapshot) => {
    toast.success(`${fileName} finished`, {
      description: job.result
        ? `${job.result.name} (${formatBytes(job.result.sizeBytes)}) is ready to download.`
        : 'The result is ready to download.',
    });
  };

  return (
    <div className="space-y-1">
      <JobProgress jobId={jobId} label={fileName} onComplete={handleComplete} />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onDismiss(entry.key)}
          aria-label={`Dismiss job for ${fileName}`}
        >
          <X className="mr-1 h-3.5 w-3.5" aria-hidden /> Dismiss
        </Button>
      </div>
    </div>
  );
}
