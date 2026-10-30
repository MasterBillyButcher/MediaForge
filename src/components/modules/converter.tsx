'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileVideo, Music } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dropzone, UploadedFileCard } from '@/components/shared/dropzone';
import { startConvert } from '@/lib/api-client';
import type { AudioFormat, ConvertSettings, MediaFileRecord, VideoFormat } from '@/lib/types';
import { useAppStore } from '@/lib/store';

import { FormatGrid } from './converter/format-grid';
import { SettingsPanel, GifNote, CompressNote } from './converter/settings-panel';
import { FileConvertRow } from './converter/file-convert-row';
import type { QuickAction } from './converter/file-convert-row';
import { ConverterJobCard } from './converter/job-card';
import {
  actionLabel as buildActionLabel, AUDIO_FORMAT_OPTIONS, DEFAULT_SETTINGS, isVideoBitrateValid,
  VIDEO_FORMAT_OPTIONS,
} from './converter/types';
import type { ConverterMode, JobEntry, SettingsState } from './converter/types';

/**
 * Video / Audio Converter module.
 * Batch uploads, per-file conversion rows, real server-side ffmpeg jobs.
 */
export function ConverterModule({ mode, initialTool }: { mode: 'video' | 'audio'; initialTool?: string | null }) {
  const isVideoMode = mode === 'video';

  const [files, setFiles] = useState<MediaFileRecord[]>([]);
  const [operation, setOperation] = useState<ConverterMode>('convert');
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('mp4');
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('mp3');
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [startingIds, setStartingIds] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({});

  const runningRef = useRef<Set<string>>(new Set());
  const processingRef = useRef<HTMLElement | null>(null);
  const prevJobCountRef = useRef(0);

  // One-shot navigation payload: preselect an operation when coming from another tool.
  const lastToolRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialTool || lastToolRef.current === initialTool) return;
    lastToolRef.current = initialTool;
    useAppStore.getState().consumePayload();
    if (!isVideoMode) return;
    if (initialTool === 'compress') {
      setOperation('compress');
    } else if (initialTool === 'extract') {
      setOperation('extract-audio');
      setAudioFormat('mp3');
    }
  }, [initialTool, isVideoMode]);

  // Scroll to the Processing section whenever a new job is queued.
  useEffect(() => {
    if (jobs.length > prevJobCountRef.current) {
      processingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevJobCountRef.current = jobs.length;
  }, [jobs.length]);

  // The format grid shows audio formats for audio mode and for "Extract audio".
  const pickingAudioFormat = !isVideoMode || operation === 'extract-audio';
  const formatOptions = pickingAudioFormat ? AUDIO_FORMAT_OPTIONS : VIDEO_FORMAT_OPTIONS;
  const targetFormat = pickingAudioFormat ? audioFormat : videoFormat;
  const isGif = isVideoMode && operation !== 'extract-audio' && videoFormat === 'gif';

  const patchSettings = useCallback((patch: Partial<SettingsState>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleFormatChange = useCallback(
    (value: string) => {
      if (pickingAudioFormat) setAudioFormat(value as AudioFormat);
      else setVideoFormat(value as VideoFormat);
    },
    [pickingAudioFormat]
  );

  const handleQuickAction = useCallback((action: QuickAction) => {
    if (action === 'extract-audio') {
      setOperation('extract-audio');
      setAudioFormat('mp3');
    } else {
      setOperation(action);
    }
  }, []);

  const buildSettings = useCallback((): ConvertSettings => {
    const audioBitrateKbps = settings.audioBitrate === 'original'
      ? null
      : Number(settings.audioBitrate);
    const audioSampleRate = settings.sampleRate === 'original'
      ? ('original' as const)
      : (Number(settings.sampleRate) as 44100 | 48000 | 22050 | 16000);

    if (!isVideoMode) {
      return {
        format: audioFormat,
        audioBitrateKbps,
        audioSampleRate,
        normalizeAudio: settings.normalizeAudio,
      };
    }

    if (operation === 'extract-audio') {
      return {
        format: audioFormat,
        mode: 'extract-audio',
        audioBitrateKbps,
        audioSampleRate,
        normalizeAudio: settings.normalizeAudio,
      };
    }

    return {
      format: videoFormat,
      mode: operation,
      resolution: settings.resolution,
      fps: settings.fps,
      quality: isGif ? undefined : settings.quality,
      videoBitrateKbps: isGif || !isVideoBitrateValid(settings.videoBitrate) || settings.videoBitrate.trim() === ''
        ? null
        : Number(settings.videoBitrate),
      audioBitrateKbps: isGif || operation === 'remove-audio' ? null : audioBitrateKbps,
      audioSampleRate: isGif ? 'original' : audioSampleRate,
      normalizeAudio: isGif || operation === 'remove-audio' ? false : settings.normalizeAudio,
    };
  }, [audioFormat, isGif, isVideoMode, operation, settings, videoFormat]);

  const startForFile = useCallback(
    async (file: MediaFileRecord) => {
      if (runningRef.current.has(file.id)) return;
      runningRef.current.add(file.id);
      setStartingIds((prev) => ({ ...prev, [file.id]: true }));
      setRowErrors((prev) => ({ ...prev, [file.id]: null }));
      try {
        const job = await startConvert(file.id, buildSettings());
        setJobs((prev) => [
          {
            key: job.id,
            jobId: job.id,
            fileName: file.originalName,
            action: buildActionLabel(isVideoMode, operation, targetFormat),
          },
          ...prev,
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not start the conversion.';
        setRowErrors((prev) => ({ ...prev, [file.id]: msg }));
        toast.error('Could not start conversion', { description: `${file.originalName}: ${msg}` });
      } finally {
        runningRef.current.delete(file.id);
        setStartingIds((prev) => ({ ...prev, [file.id]: false }));
      }
    },
    [buildSettings, isVideoMode, operation, targetFormat]
  );

  const startAll = useCallback(async () => {
    for (const file of files) {
      await startForFile(file);
    }
  }, [files, startForFile]);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const warningFor = useCallback(
    (file: MediaFileRecord): string | null => {
      const meta = file.meta;
      if (!meta) return null;
      if (pickingAudioFormat && !meta.hasAudio) {
        return 'This file has no audio stream. The server will reject audio extraction for it.';
      }
      if (isVideoMode && operation !== 'extract-audio' && !meta.hasVideo) {
        return 'This file has no video stream. The server will reject this job — try "Extract audio" instead.';
      }
      return null;
    },
    [isVideoMode, operation, pickingAudioFormat]
  );

  const anyStarting = Object.values(startingIds).some(Boolean);
  const rowActionLabel = buildActionLabel(isVideoMode, operation, targetFormat);

  const operationDescription = !isVideoMode
    ? 'Re-encode each file into the selected audio format with the settings below.'
    : operation === 'convert'
      ? 'Re-encode each file into the selected container with the settings below.'
      : operation === 'extract-audio'
        ? 'Drop the video track and save the audio as the selected audio format.'
        : operation === 'remove-audio'
          ? 'Keep the video stream and strip all audio tracks from the output.'
          : 'Shrink file sizes with a stronger server-side encoding preset.';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            {isVideoMode
              ? <FileVideo className="h-6 w-6 text-primary" aria-hidden />
              : <Music className="h-6 w-6 text-primary" aria-hidden />}
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {isVideoMode ? 'Video Converter' : 'Audio Converter'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isVideoMode ? 'MP4 · WebM · MOV · MKV · GIF' : 'MP3 · WAV · M4A · AAC · FLAC · OGG'}
            </p>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-sm text-muted-foreground sm:text-base">
          {isVideoMode
            ? 'Convert videos between MP4, WebM, MOV, MKV and GIF with full control over resolution, frame rate and quality. Extract or remove audio tracks and compress files in one click.'
            : 'Convert audio files between MP3, WAV, M4A, AAC, FLAC and OGG with custom bitrates, sample rates and loudness normalization.'}
          {' '}All processing runs server-side with FFmpeg; jobs show real progress and can be cancelled.
        </p>
      </header>

      <div className="space-y-6">
        {/* Step 1 — files */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <StepBadge n={1} /> Add files
            </CardTitle>
            <CardDescription>
              {isVideoMode
                ? 'Upload one or more videos. Every file gets its own conversion row.'
                : 'Upload one or more audio files. Every file gets its own conversion row.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Dropzone
              category={isVideoMode ? 'video' : 'audio'}
              multiple
              label={isVideoMode ? 'Drop videos here or click to browse' : 'Drop audio files here or click to browse'}
              hint={isVideoMode
                ? 'MP4, WebM, MOV, MKV, AVI and more · up to 250 MB per file'
                : 'MP3, WAV, M4A, AAC, FLAC, OGG and more · up to 250 MB per file'}
              onUploaded={(file) => setFiles((prev) => [...prev, file])}
            />
            {files.length > 0 && (
              <div className="max-h-96 space-y-3 overflow-y-auto pr-1 scrollbar-slim">
                {files.map((file) => (
                  <UploadedFileCard
                    key={file.id}
                    file={file}
                    onRemove={() => removeFile(file.id)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2 — output settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <StepBadge n={2} /> Output settings
            </CardTitle>
            <CardDescription>
              The operation and target format apply to every uploaded file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isVideoMode && (
              <>
                <Tabs
                  value={operation}
                  onValueChange={(v) => setOperation(v as ConverterMode)}
                >
                  <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
                    <TabsTrigger value="convert" className="py-2">Convert</TabsTrigger>
                    <TabsTrigger value="extract-audio" className="py-2">Extract audio</TabsTrigger>
                    <TabsTrigger value="remove-audio" className="py-2">Remove audio</TabsTrigger>
                    <TabsTrigger value="compress" className="py-2">Compress</TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-sm text-muted-foreground" aria-live="polite">{operationDescription}</p>
              </>
            )}

            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {pickingAudioFormat ? 'Audio format' : 'Video format'}
                </p>
                <Badge variant="secondary" aria-label={`Selected target format: ${targetFormat.toUpperCase()}`}>
                  {targetFormat.toUpperCase()}
                </Badge>
              </div>
              <FormatGrid
                options={formatOptions}
                value={targetFormat}
                onChange={handleFormatChange}
                label="Output format"
              />
            </div>

            {isGif && <GifNote compressActive={operation === 'compress'} />}
            {!isGif && isVideoMode && operation === 'compress' && <CompressNote />}

            <SettingsPanel
              isVideoMode={isVideoMode}
              operation={operation}
              isGif={isGif}
              settings={settings}
              onChange={patchSettings}
            />
          </CardContent>
        </Card>

        {/* Step 3 — per-file conversion rows */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <StepBadge n={3} /> Convert
            </CardTitle>
            <CardDescription>
              Start a conversion job per file. Quick actions switch the operation for all files.
            </CardDescription>
            <CardAction>
              {files.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void startAll()}
                  disabled={anyStarting}
                >
                  Start all ({files.length})
                </Button>
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {files.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Upload files above to set up conversions.
              </p>
            ) : (
              files.map((file) => (
                <FileConvertRow
                  key={file.id}
                  file={file}
                  operation={operation}
                  actionLabel={rowActionLabel}
                  warning={warningFor(file)}
                  error={rowErrors[file.id] ?? null}
                  starting={startingIds[file.id] ?? false}
                  isVideoMode={isVideoMode}
                  onConvert={() => void startForFile(file)}
                  onQuickAction={handleQuickAction}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Processing — one real JobProgress card per started job, visible until dismissed */}
        {jobs.length > 0 && (
          <section ref={processingRef} aria-label="Processing jobs" className="scroll-mt-24">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2.5">
                  Processing
                  <Badge aria-label={`${jobs.length} job${jobs.length === 1 ? '' : 's'}`}>{jobs.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Jobs keep running on the server. You can stay on this page or come back later.
                </CardDescription>
                <CardAction>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setJobs([])}
                    aria-label="Clear all jobs from the list"
                  >
                    Clear all
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-5">
                {jobs.map((entry) => (
                  <ConverterJobCard
                    key={entry.key}
                    entry={entry}
                    onDismiss={(key) => setJobs((prev) => prev.filter((j) => j.key !== key))}
                  />
                ))}
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
      aria-hidden
    >
      {n}
    </span>
  );
}
