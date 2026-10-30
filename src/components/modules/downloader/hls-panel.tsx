'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AudioLines, CheckCircle2, Download, Film, Info, Loader2,
  Radio, Timer, Volume2, X,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cancelJob, formatBytes, formatDuration, pollJob, resultDownloadUrl, saveBlob, startHlsDownload } from '@/lib/api-client';
import type { HlsAnalyzeResult, HlsVariantInfo, JobSnapshot } from '@/lib/types';

const HLS_FORMATS = [
  { value: 'mp4', label: 'MP4 — fast, plays everywhere', hint: 'Stream copy, no quality loss' },
  { value: 'mkv', label: 'MKV — original stream copy', hint: 'Most tolerant container' },
  { value: 'ts', label: 'MPEG-TS — raw stream', hint: 'Segments exactly as broadcast' },
  { value: 'mp3', label: 'MP3 — audio only (192 kbps)', hint: 'Audio extracted & encoded' },
  { value: 'wav', label: 'WAV — audio only (lossless)', hint: 'Uncompressed PCM' },
] as const;

/** Rough average bitrate table — only used when the manifest has no BANDWIDTH. */
function heightToBps(height: number): number {
  if (height >= 2000) return 20_000_000;
  if (height >= 1400) return 10_000_000;
  if (height >= 1000) return 8_000_000;
  if (height >= 700) return 5_000_000;
  if (height >= 450) return 2_500_000;
  if (height >= 350) return 1_200_000;
  if (height >= 240) return 700_000;
  return 400_000;
}

function estimateSize(v: HlsVariantInfo | null, seconds: number | null): number | null {
  if (!v || !seconds || seconds <= 0) return null;
  const bps = v.bandwidth ?? (v.height ? heightToBps(v.height) : null);
  if (!bps) return null;
  return Math.round((bps * seconds) / 8);
}

function variantLabel(v: HlsVariantInfo): string {
  const parts: string[] = [v.label];
  if (v.width && v.height && !v.label.includes(v.height.toString())) {
    parts.push(`${v.width}×${v.height}`);
  }
  if (v.fps) parts.push(`${v.fps} fps`);
  if (v.bandwidth) parts.push(`${(v.bandwidth / 1_000_000).toFixed(1)} Mbps`);
  return parts.filter(Boolean).join(' · ');
}

export function HlsPanel({ result, onSaved }: { result: HlsAnalyzeResult; onSaved: () => void }) {
  const videoVariants = useMemo(
    () => result.variants.filter((v) => !v.isAudioOnly),
    [result.variants]
  );
  const [variantId, setVariantId] = useState<number>(() => videoVariants[0]?.id ?? result.variants[0]?.id ?? 0);
  const [format, setFormat] = useState<string>('mp4');
  const [useUnmuted, setUseUnmuted] = useState<boolean>(result.unmutedAudio.available);
  const [limitMin, setLimitMin] = useState<string>('');
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ name: string; sizeBytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => () => pollRef.current?.stop(), []);

  const selected = result.variants.find((v) => v.id === variantId) ?? videoVariants[0] ?? result.variants[0] ?? null;
  const isAudioOut = format === 'mp3' || format === 'wav';
  const busy = job != null && (job.state === 'queued' || job.state === 'processing');
  const capSeconds = (() => {
    const n = Number(limitMin);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : null;
  })();
  const estimated = estimateSize(selected, capSeconds ? Math.min(result.duration ?? capSeconds, capSeconds) : result.duration);

  const saveResult = useCallback(
    async (jobId: string, fileName: string) => {
      setSaving(true);
      try {
        const res = await fetch(resultDownloadUrl(jobId));
        if (!res.ok) throw new Error('Could not fetch the finished file from the server.');
        const blob = await res.blob();
        saveBlob(blob, fileName);
        setSaved({ name: fileName, sizeBytes: blob.size });
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the file.');
      } finally {
        setSaving(false);
      }
    },
    [onSaved]
  );

  const start = useCallback(async () => {
    if (!selected) return;
    setError(null);
    setSaved(null);
    try {
      const { job: created } = await startHlsDownload({
        url: selected.url,
        audioUrl: useUnmuted && result.unmutedAudio.available ? result.unmutedAudio.url : null,
        format: format as 'mp4' | 'mkv' | 'ts' | 'mp3' | 'wav',
        title: result.title,
        duration: result.duration,
        maxDurationSec: capSeconds,
        estimatedBytes: estimated,
      });
      setJob(created);
      pollRef.current?.stop();
      pollRef.current = pollJob(
        created.id,
        (snapshot) => {
          setJob(snapshot);
          if (snapshot.state === 'completed' && snapshot.result) {
            pollRef.current?.stop();
            void saveResult(snapshot.id, snapshot.result.name);
          } else if (snapshot.state === 'failed') {
            pollRef.current?.stop();
            setError(snapshot.error ?? 'Processing failed.');
          } else if (snapshot.state === 'cancelled') {
            pollRef.current?.stop();
          }
        },
        800
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the download.');
    }
  }, [capSeconds, estimated, format, result.duration, result.title, result.unmutedAudio.available, result.unmutedAudio.url, saveResult, selected, useUnmuted]);

  const cancel = useCallback(() => {
    if (job) void cancelJob(job.id);
  }, [job]);

  const pct = job?.progress ?? 0;

  return (
    <div className="space-y-4 rounded-xl border bg-muted/30 p-4 sm:p-5">
      {/* header */}
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Radio className="h-6 w-6 text-primary" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={result.title}>
            {result.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">HLS stream</Badge>
            <Badge variant="outline">{result.playlistType === 'master' ? 'master manifest' : 'media playlist'}</Badge>
            {result.isTwitch && <Badge variant="outline" className="border-violet-500/40 text-violet-600 dark:text-violet-400">Twitch VOD</Badge>}
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3" aria-hidden /> {formatDuration(result.duration)}
            </span>
            {result.segmentCount != null && <span>{result.segmentCount} segments</span>}
          </div>
          <p className="mt-1.5 truncate text-xs text-muted-foreground/70" title={result.resolvedUrl}>
            {result.resolvedUrl}
          </p>
        </div>
      </div>

      {result.warnings.length > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/5 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
          <Info className="h-4 w-4" />
          <AlertTitle>Stream notes</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      {/* options */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="hls-quality">Quality</Label>
          <Select
            value={String(variantId)}
            onValueChange={(val) => setVariantId(Number(val))}
            disabled={busy || videoVariants.length <= 1}
          >
            <SelectTrigger id="hls-quality" className="h-11 w-full">
              <SelectValue placeholder="Select quality" />
            </SelectTrigger>
            <SelectContent>
              {(videoVariants.length > 0 ? videoVariants : result.variants).map((v) => (
                <SelectItem key={v.id} value={String(v.id)}>
                  {variantLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {estimated != null && (
            <p className="text-xs text-muted-foreground">
              Estimated size: ~{formatBytes(estimated)} {result.duration ? `· ${formatDuration(result.duration)}` : ''}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="hls-format">Output format</Label>
          <Select value={format} onValueChange={setFormat} disabled={busy}>
            <SelectTrigger id="hls-format" className="h-11 w-full">
              <SelectValue placeholder="Select format" />
            </SelectTrigger>
            <SelectContent>
              {HLS_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {HLS_FORMATS.find((f) => f.value === format)?.hint}
          </p>
        </div>
      </div>

      {/* unmuted audio option */}
      {result.unmutedAudio.available && !isAudioOut && (
        <div className="flex items-start justify-between gap-4 rounded-lg border bg-background p-3.5">
          <div className="flex items-start gap-3">
            <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <div>
              <Label htmlFor="hls-unmuted" className="text-sm font-medium">
                Use unmuted audio track
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Twitch muted parts of this VOD in the video track. The separate audio-only rendition found next to
                it will be muxed back in so the whole VOD plays with its original sound.
              </p>
            </div>
          </div>
          <Switch
            id="hls-unmuted"
            checked={useUnmuted}
            onCheckedChange={setUseUnmuted}
            disabled={busy}
            aria-label="Use unmuted audio track"
          />
        </div>
      )}

      {/* duration limit for huge VODs */}
      <div className="space-y-1.5">
        <Label htmlFor="hls-limit" className="text-sm">
          Limit duration <span className="font-normal text-muted-foreground">(optional — for very long VODs)</span>
        </Label>
        <Input
          id="hls-limit"
          type="number"
          min={1}
          max={1440}
          step={1}
          inputMode="numeric"
          placeholder="full stream"
          className="h-11 max-w-48"
          value={limitMin}
          onChange={(e) => setLimitMin(e.target.value)}
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to download the entire stream ({formatDuration(result.duration)}). Enter minutes to stop
          early — e.g. 15 keeps just the first 15 minutes.
        </p>
      </div>

      {/* progress / actions */}
      {busy ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            <span>
              {job?.state === 'queued' ? 'Waiting in queue...' : 'Downloading & assembling stream'}
              <span className="ml-2 font-semibold tabular-nums">{Math.floor(pct)}%</span>
            </span>
          </div>
          <Progress value={pct} aria-label="Stream download progress" />
          <p className="text-xs tabular-nums text-muted-foreground">
            ffmpeg is fetching segments on the server and writing a single {format.toUpperCase()} file.
            {job?.speed ? ` Speed ${job.speed}.` : ''}
            {job?.etaSeconds != null ? ` About ${formatDuration(job.etaSeconds)} left.` : ''}
          </p>
          <Button variant="outline" onClick={cancel} className="h-11">
            <X className="h-4 w-4" aria-hidden /> Cancel
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Button
            size="lg"
            className="h-12 w-full text-base sm:w-auto sm:px-10"
            onClick={() => void start()}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Download className="h-5 w-5" aria-hidden />}
            {saving ? 'Saving...' : `Download ${format.toUpperCase()}`}
            {estimated != null && !saving ? ` · ~${formatBytes(estimated)}` : ''}
          </Button>
          {saved && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              Saved {saved.name} ({formatBytes(saved.sizeBytes)}) to your device. A copy also appears in My Files for 3 hours.
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Download failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* audio-only hint */}
      {isAudioOut && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AudioLines className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Audio will be taken from {useUnmuted && result.unmutedAudio.available ? 'the unmuted audio track' : 'the selected stream'}
          {useUnmuted && result.unmutedAudio.available ? ' — muted segments restored.' : '.'}
        </p>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Film className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Segments are fetched server-side and assembled by FFmpeg with stream copy — no re-encoding, no quality loss,
        real progress only.
      </p>
    </div>
  );
}
