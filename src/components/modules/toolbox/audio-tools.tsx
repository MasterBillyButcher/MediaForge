'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ToolCard } from '@/components/shared/tool-card';
import { Dropzone, UploadedFileCard } from '@/components/shared/dropzone';
import { JobProgress } from '@/components/shared/job-progress';
import { pollJob, startTool } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import type { JobSnapshot, MediaFileRecord } from '@/lib/types';
import {
  TOOLS, ToolInputs, buildOpParams, defaultParams, validateParams,
  type ToolDef, type ToolParams,
} from './audio-panels';

/** Polls a job to its terminal state; resolves with the snapshot or rejects with the real error. */
function awaitJob(id: string): Promise<JobSnapshot> {
  return new Promise((resolve, reject) => {
    const poller = pollJob(id, (job) => {
      if (job.state === 'completed') {
        poller.stop();
        resolve(job);
      } else if (job.state === 'failed' || job.state === 'cancelled') {
        poller.stop();
        reject(new Error(job.error ?? 'Processing failed.'));
      }
    }, 500);
  });
}

export function AudioToolsModule() {
  // page.tsx keys this module by payload.tool — read (not consume) the payload here so the
  // preselected tool survives; navigate() overwrites the payload on every navigation anyway.
  const [activeId, setActiveId] = useState<string | null>(() => {
    const t = useAppStore.getState().payload?.tool;
    return t && TOOLS.some((tool) => tool.id === t) ? t : null;
  });

  const active = activeId ? TOOLS.find((tool) => tool.id === activeId) ?? null : null;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Audio &amp; Video Tools</h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          One-click tools powered by real ffmpeg processing — cut, merge, convert, resize, caption and more.
        </p>
      </header>

      {active ? (
        <ActiveToolPanel tool={active} onBack={() => setActiveId(null)} />
      ) : (
        <section aria-label="All tools">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {TOOLS.map((tool) => (
              <ToolCard
                key={tool.id}
                icon={tool.icon}
                title={tool.title}
                description={tool.description}
                onClick={() => setActiveId(tool.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active tool panel
// ---------------------------------------------------------------------------

function ActiveToolPanel({ tool, onBack }: { tool: ToolDef; onBack: () => void }) {
  const [files, setFiles] = useState<MediaFileRecord[]>([]);
  const [params, setParams] = useState<ToolParams>(() => defaultParams(tool.id));
  const [watermarkImage, setWatermarkImage] = useState<MediaFileRecord | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const thumbUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
    };
  }, []);

  const minFilesOk = files.length >= tool.minFiles;
  const Icon = tool.icon;

  const onUploaded = (file: MediaFileRecord) => {
    setError(null);
    setFiles((prev) => {
      if (tool.multiple) {
        if (prev.length >= 10) {
          toast.error('You can merge at most 10 files at once.');
          return prev;
        }
        return [...prev, file];
      }
      return [file];
    });
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const fail = (message: string) => {
    setError(message);
    toast.error(message);
  };

  const grabThumbnail = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/media/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'video-thumbnail',
          params: { fileIds: [files[0].id], time: params.time ?? 0 },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status}).`);
      }
      const blob = await res.blob();
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
      const url = URL.createObjectURL(blob);
      thumbUrlRef.current = url;
      setThumbUrl(url);
      toast.success('Thumbnail captured.');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not grab the thumbnail.');
    } finally {
      setBusy(false);
    }
  };

  const process = async () => {
    setError(null);
    if (!minFilesOk) {
      fail(tool.multiple ? `Upload at least ${tool.minFiles} files to continue.` : 'Upload a file first.');
      return;
    }
    if (tool.id === 'video-thumbnail') {
      await grabThumbnail();
      return;
    }
    const validation = validateParams(tool.id, params, files);
    if (validation) {
      fail(validation);
      return;
    }
    setBusy(true);
    try {
      const fileIds = files.map((f) => f.id);
      if (tool.id === 'video-rotate' && (params.flipH || params.flipV)) {
        // Rotation and flips are two real server ops — chain them when both are requested.
        let sourceId = fileIds[0];
        if ((params.angle ?? 0) > 0) {
          const rotateJob = await startTool('video-rotate', {
            fileIds,
            angle: params.angle ?? 90,
            direction: params.direction ?? 'clockwise',
          });
          setJobId(rotateJob.id);
          const rotated = await awaitJob(rotateJob.id);
          if (!rotated.result) throw new Error('Rotation finished without a result file.');
          sourceId = rotated.result.fileId;
        }
        const flipJob = await startTool('video-flip', {
          fileIds: [sourceId],
          flipH: !!params.flipH,
          flipV: !!params.flipV,
        });
        setJobId(flipJob.id);
        await awaitJob(flipJob.id);
      } else {
        const job = await startTool(tool.id, { ...buildOpParams(tool.id, params), fileIds });
        setJobId(job.id);
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Processing failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 min-h-9">
          <ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden /> All tools
        </Button>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg sm:text-xl font-bold">{tool.title}</h2>
            <p className="text-sm text-muted-foreground">{tool.note}</p>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-5 p-4 sm:p-6">
          <div className="space-y-3">
            <Dropzone
              category={tool.category}
              multiple={tool.multiple}
              compact={files.length > 0}
              label={
                tool.multiple
                  ? `Drop ${tool.category} files here (2–10, in order)`
                  : `Drop a ${tool.category} file here or click to browse`
              }
              onUploaded={onUploaded}
            />

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((file, idx) => (
                  <div key={file.id} className="relative">
                    {tool.multiple && (
                      <Badge className="absolute -left-1.5 -top-2 z-10 h-5 min-w-5 justify-center rounded-full px-1">
                        {idx + 1}
                      </Badge>
                    )}
                    <UploadedFileCard file={file} onRemove={() => removeFile(file.id)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {files.length > 0 && (
            <>
              <hr className="border-border" />
              <ToolInputs
                toolId={tool.id}
                params={params}
                setParams={setParams}
                files={files}
                watermarkImage={watermarkImage}
                onWatermarkImage={(f) => {
                  setWatermarkImage(f);
                  if (f) {
                    setParams((p) => ({
                      ...p,
                      watermark: { ...(p.watermark ?? { type: 'image' as const }), fileId: f.id },
                    }));
                  }
                }}
              />
            </>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button onClick={process} disabled={busy} size="lg" className="h-11 w-full sm:w-auto sm:min-w-48">
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : null}
            {busy ? 'Working…' : tool.processLabel}
          </Button>
        </CardContent>
      </Card>

      {jobId && <JobProgress jobId={jobId} label={`${tool.title}`} />}

      {thumbUrl && (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <h3 className="text-sm font-semibold">Captured frame</h3>
            <img
              src={thumbUrl}
              alt="Grabbed video frame"
              className="max-h-96 w-auto max-w-full rounded-lg border bg-muted object-contain"
            />
            <Button asChild size="sm" className="min-h-11">
              <a href={thumbUrl} download="thumbnail.png">
                <Download className="h-4 w-4 mr-2" aria-hidden /> Download thumbnail.png
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
