'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Download, ListMusic, Loader2, Sparkles, X,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatBytes, formatDuration } from '@/lib/api-client';
import {
  TERMINAL_JOB_STATES, cancelPlaylistJob, createPlaylistJob, estimateItemBytes,
  fetchPlaylistJob, playlistFileUrl, type PlaylistInfoDto,
} from '@/lib/playlist/client';
import { AUDIO_FORMATS, BITRATES, QUALITIES, VIDEO_FORMATS, type PFormat } from '../playlist/format-picker';
import { useAppStore } from '@/lib/store';

const FORMAT_LABELS: Record<PFormat, string> = {
  mp4: 'MP4', webm: 'WebM', mkv: 'MKV', mov: 'MOV',
  mp3: 'MP3', m4a: 'M4A', aac: 'AAC', wav: 'WAV', flac: 'FLAC', ogg: 'OGG', opus: 'Opus',
};

/**
 * Single-URL extraction panel backed by the yt-dlp worker (the same engine
 * the Playlist Downloader uses). Shown when a URL is a platform page rather
 * than a direct media file / HLS manifest.
 */
export function ExtractionPanel({
  url, info, onSaved,
}: {
  url: string;
  info: PlaylistInfoDto;
  onSaved: () => void;
}) {
  const navigate = useAppStore((s) => s.navigate);

  // --- playlist redirect ----------------------------------------------------
  if (info.kind === 'playlist') {
    return (
      <Alert className="border-violet-500/40 bg-violet-500/5 [&>svg]:text-violet-600 dark:[&>svg]:text-violet-400">
        <ListMusic className="h-4 w-4" />
        <AlertTitle>Playlist detected — {info.count} videos</AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-sm">
            “{info.title}” is a playlist. The Playlist Downloader queues every video with the format and quality
            you choose, tracks progress per video and retries failures.
          </p>
          <Button onClick={() => navigate('playlist', { url })} className="h-11">
            <ListMusic className="h-4 w-4" aria-hidden /> Open in Playlist Downloader
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return <SingleExtract url={url} info={info} onSaved={onSaved} />;
}

function SingleExtract({
  url, info, onSaved,
}: {
  url: string;
  info: PlaylistInfoDto;
  onSaved: () => void;
}) {
  const entry = info.entries[0];
  const [format, setFormat] = useState<PFormat>('mp4');
  const [quality, setQuality] = useState('best');
  const [bitrate, setBitrate] = useState('best');
  const [cookies, setCookies] = useState('');
  const [cookiesOpen, setCookiesOpen] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'downloading' | 'processing' | null>(null);
  const [speed, setSpeed] = useState<string | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const [state, setState] = useState<string>('pending');
  const [error, setError] = useState<string | null>(null);
  const [savedFile, setSavedFile] = useState<{ name: string; size: number | null } | null>(null);
  const [starting, setStarting] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const isAudio = (AUDIO_FORMATS as readonly string[]).includes(format);
  const duration = entry?.duration ?? null;
  const estimated = estimateItemBytes(duration, format, quality, bitrate);
  const busy = jobId != null && !TERMINAL_JOB_STATES.has(state) && state !== 'pending';

  const poll = useCallback(
    (id: string) => {
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          const j = await fetchPlaylistJob(id);
          const v = j.videos[0];
          if (v) {
            setState(v.state);
            setProgress(v.progress);
            setPhase(v.phase);
            setSpeed(v.speed);
            setEta(v.eta);
            if (v.state === 'completed') {
              stopped = true;
              setSavedFile({ name: v.fileName ?? 'download', size: v.sizeBytes });
              // trigger the browser download of the finished file
              const a = document.createElement('a');
              a.href = playlistFileUrl(id, 0);
              a.download = v.fileName ?? 'download';
              document.body.appendChild(a);
              a.click();
              a.remove();
              onSaved();
              return;
            }
            if (v.state === 'failed' || v.state === 'cancelled') {
              stopped = true;
              setError(v.error ?? (v.state === 'cancelled' ? 'Cancelled.' : 'Extraction failed.'));
              return;
            }
          }
        } catch {
          // transient poll errors are ignored; next tick retries
        }
        setTimeout(() => void tick(), 1000);
      };
      void tick();
      stopRef.current = () => {
        stopped = true;
      };
    },
    [onSaved]
  );

  const start = useCallback(async () => {
    setError(null);
    setSavedFile(null);
    setStarting(true);
    try {
      const { jobId: id } = await createPlaylistJob({
        title: info.title || 'video',
        sourceUrl: url,
        format,
        quality,
        bitrate,
        ...(cookies.trim() ? { cookies: cookies.trim() } : {}),
        entries: [{ url, title: entry?.title ?? null }],
      });
      setJobId(id);
      setState('pending');
      poll(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the extraction.');
    } finally {
      setStarting(false);
    }
  }, [cookies, entry?.title, format, info.title, poll, quality, bitrate, url]);

  const cancel = useCallback(async () => {
    if (jobId) {
      stopRef.current?.();
      try { await cancelPlaylistJob(jobId); } catch { /* already finished */ }
      setState('cancelled');
    }
  }, [jobId]);

  return (
    <div className="space-y-4 rounded-xl border bg-muted/30 p-4 sm:p-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={entry?.title ?? info.title}>
            {entry?.title ?? info.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">{info.uploader ?? 'platform video'}</Badge>
            {duration != null && <span>{formatDuration(duration)}</span>}
            <span className="truncate">{url}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="extract-format">Format</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as PFormat)} disabled={busy}>
            <SelectTrigger id="extract-format" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Video</div>
              {VIDEO_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>{FORMAT_LABELS[f]}</SelectItem>
              ))}
              <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Audio</div>
              {AUDIO_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>{FORMAT_LABELS[f]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="extract-quality">{isAudio ? 'Audio bitrate' : 'Quality'}</Label>
          <Select value={isAudio ? bitrate : quality} onValueChange={(v) => (isAudio ? setBitrate(v) : setQuality(v))} disabled={busy}>
            <SelectTrigger id="extract-quality" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(isAudio ? BITRATES : QUALITIES).map((q) => (
                <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {estimated != null && (
            <p className="text-xs text-muted-foreground">Estimated size: ~{formatBytes(estimated)}</p>
          )}
        </div>
      </div>

      <Collapsible open={cookiesOpen} onOpenChange={setCookiesOpen}>
        <CollapsibleTrigger className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Advanced: authorized access (cookies)
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <Label htmlFor="extract-cookies" className="text-xs">
            Cookie header — only for media you own or are authorized to download (e.g. your own uploads)
          </Label>
          <Textarea
            id="extract-cookies"
            rows={2}
            placeholder="Paste a Cookie: name=value; ... header for authorized access"
            className="mt-1.5 min-h-16 font-mono text-xs"
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
            disabled={busy}
          />
        </CollapsibleContent>
      </Collapsible>

      {busy ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            <span>
              {phase === 'processing' ? 'Processing...' : 'Downloading'}
              <span className="ml-2 font-semibold tabular-nums">{Math.floor(progress)}%</span>
            </span>
          </div>
          <Progress value={progress} aria-label="Extraction progress" />
          <p className="text-xs tabular-nums text-muted-foreground">
            {speed ? `Speed ${speed}. ` : ''}
            {eta != null ? `About ${formatDuration(eta)} left. ` : ''}
            Processed by the extraction engine (yt-dlp + ffmpeg).
          </p>
          <Button variant="outline" onClick={() => void cancel()} className="h-11">
            <X className="h-4 w-4" aria-hidden /> Cancel
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Button size="lg" className="h-12 w-full text-base sm:w-auto sm:px-10" onClick={() => void start()} disabled={starting}>
            {starting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Download className="h-5 w-5" aria-hidden />}
            {starting ? 'Starting...' : `Download ${FORMAT_LABELS[format]}`}
          </Button>
          {savedFile && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              Saved {savedFile.name}
              {savedFile.size != null ? ` (${formatBytes(savedFile.size)})` : ''} to your device.
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Extraction failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
