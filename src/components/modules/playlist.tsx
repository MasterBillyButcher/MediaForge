'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardPaste, Cookie, Globe, Info, Link2, ListMusic, Loader2, Radio,
  ScrollText, ShieldCheck, TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { formatBytes } from '@/lib/api-client';
import {
  TERMINAL_JOB_STATES, createPlaylistJob, deletePlaylistJob, estimateItemBytes, fetchPlaylistInfo,
  fetchPlaylistJob, fetchPlaylistJobs, type PlaylistInfoDto, type PlaylistJobDto,
} from '@/lib/playlist/client';
import { FormatPicker, type PFormat } from './playlist/format-picker';
import { VideoList } from './playlist/video-list';
import { JobMonitor } from './playlist/job-monitor';
import { cn } from '@/lib/utils';

const MAX_PER_JOB = 2000;

type InfoUi =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; info: PlaylistInfoDto; isLocalList: boolean };

function guessTitleFromUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return last.replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 120) || u.hostname;
  } catch {
    return raw.slice(0, 80);
  }
}

export function PlaylistModule({ initialUrl }: { initialUrl?: string }) {
  const navigate = useAppStore((s) => s.navigate);

  // --- input & info --------------------------------------------------------
  const [url, setUrl] = useState('');
  const [infoUi, setInfoUi] = useState<InfoUi>({ kind: 'idle' });
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // --- format --------------------------------------------------------------
  const [format, setFormat] = useState<PFormat>('mp4');
  const [quality, setQuality] = useState('best');
  const [bitrate, setBitrate] = useState('best');
  const [cookies, setCookies] = useState('');

  // --- jobs ----------------------------------------------------------------
  const [job, setJob] = useState<PlaylistJobDto | null>(null);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof fetchPlaylistJobs>>['jobs']>([]);
  const [starting, setStarting] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const jobIdRef = useRef<string | null>(null);

  const refreshRecent = useCallback(async () => {
    try {
      const data = await fetchPlaylistJobs();
      setRecent(data.jobs);
      return data.jobs;
    } catch {
      return [];
    }
  }, []);

  // --- info fetch ----------------------------------------------------------
  const inspect = useCallback(
    async (raw: string, useCookies?: boolean) => {
      const lines = raw.split(/\s+/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        toast.error('Enter a playlist or media URL first.');
        return;
      }
      setInfoUi({ kind: 'loading' });

      // Multi-line input → treat as a direct URL list (always downloadable)
      if (lines.length > 1) {
        const valid = lines.filter((l) => /^https?:\/\//i.test(l));
        const invalid = lines.length - valid.length;
        const info: PlaylistInfoDto = {
          kind: 'playlist',
          title: 'Pasted URL list',
          uploader: null,
          webpageUrl: '',
          count: valid.length,
          entries: valid.map((l, i) => ({
            i, id: null, url: l, title: guessTitleFromUrl(l),
            duration: null, thumbnail: null, uploader: null,
          })),
          warnings: [
            'Direct URL list — each link is downloaded as-is, no platform extraction needed.',
            ...(invalid > 0 ? [`${invalid} line${invalid === 1 ? '' : 's'} skipped (not http(s) URLs).`] : []),
          ],
        };
        setInfoUi({ kind: 'ready', info, isLocalList: true });
        setSelected(new Set(info.entries.map((e) => e.i)));
        return;
      }

      try {
        const info = await fetchPlaylistInfo(lines[0], useCookies ? cookies || undefined : undefined);
        setInfoUi({ kind: 'ready', info, isLocalList: false });
        setSelected(new Set(info.entries.map((e) => e.i)));
        if (info.warnings.length > 0) toast.info(info.warnings[0]);
      } catch (err) {
        setInfoUi({ kind: 'error', message: err instanceof Error ? err.message : 'Could not inspect that URL.' });
      }
    },
    [cookies]
  );

  // consume navigation payload (e.g. from home hero) exactly once per URL
  const lastInspectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialUrl || lastInspectedRef.current === initialUrl) return;
    lastInspectedRef.current = initialUrl;
    useAppStore.getState().consumePayload();
    setUrl(initialUrl);
    void inspect(initialUrl);
  }, [initialUrl, inspect]);

  // restore an active job + recent list on mount
  useEffect(() => {
    void (async () => {
      const jobs = await refreshRecent();
      const activeJob = jobs.find((j) => !TERMINAL_JOB_STATES.has(j.state));
      if (activeJob) {
        try {
          const full = await fetchPlaylistJob(activeJob.id);
          jobIdRef.current = full.id;
          setJob(full);
        } catch { /* job vanished */ }
      }
    })();
  }, [refreshRecent]);

  // --- polling -------------------------------------------------------------
  const jobActive = job != null && !TERMINAL_JOB_STATES.has(job.state);
  useEffect(() => {
    if (!jobActive || !job) return;
    let alive = true;
    const id = job.id;
    const tick = async () => {
      try {
        const status = await fetchPlaylistJob(id);
        if (!alive || jobIdRef.current !== id) return;
        setJob(status);
        if (TERMINAL_JOB_STATES.has(status.state)) {
          void refreshRecent();
          if (status.state === 'completed' && status.failed === 0) {
            toast.success(`Playlist ready — ${status.completed} file${status.completed === 1 ? '' : 's'}.`, {
              description: 'Download files individually or grab the ZIP.',
            });
          } else if (status.state === 'completed') {
            toast.info(`${status.completed} downloaded, ${status.failed} failed.`, {
              description: 'Use "Retry failed" to re-attempt the failed videos.',
            });
          }
        }
      } catch { /* transient polling error; next tick retries */ }
    };
    void tick();
    const t = setInterval(tick, 1600);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [jobActive, job, refreshRecent]);

  // --- selection helpers ---------------------------------------------------
  const toggle = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);
  const selectAll = useCallback(() => {
    if (infoUi.kind !== 'ready') return;
    setSelected(new Set(infoUi.info.entries.map((e) => e.i)));
  }, [infoUi]);
  const selectNone = useCallback(() => setSelected(new Set()), []);
  const invert = useCallback(() => {
    if (infoUi.kind !== 'ready') return;
    setSelected((prev) => {
      const next = new Set<number>();
      for (const e of infoUi.info.entries) if (!prev.has(e.i)) next.add(e.i);
      return next;
    });
  }, [infoUi]);

  // --- start job -----------------------------------------------------------
  const startJob = useCallback(async () => {
    if (infoUi.kind !== 'ready') return;
    const entries = infoUi.info.entries
      .filter((e) => selected.has(e.i))
      .map((e) => ({ url: e.url, title: e.title }));
    if (entries.length === 0) {
      toast.error('Select at least one video.');
      return;
    }
    setStarting(true);
    try {
      // chunk very large selections into multiple jobs ("any number of videos")
      const chunks: Array<Array<{ url: string; title: string | null }>> = [];
      for (let i = 0; i < entries.length; i += MAX_PER_JOB) chunks.push(entries.slice(i, i + MAX_PER_JOB));
      let last: { jobId: string; total: number } | null = null;
      for (let c = 0; c < chunks.length; c++) {
        const res = await createPlaylistJob({
          title: chunks.length > 1 ? `${infoUi.info.title} (part ${c + 1}/${chunks.length})` : infoUi.info.title,
          sourceUrl: infoUi.info.webpageUrl || null,
          format,
          quality,
          bitrate,
          cookies: cookies || undefined,
          entries: chunks[c],
        });
        last = res;
      }
      if (!last) return;
      const full = await fetchPlaylistJob(last.jobId);
      jobIdRef.current = full.id;
      setJob(full);
      void refreshRecent();
      toast.success(`Downloading ${entries.length} video${entries.length === 1 ? '' : 's'} as ${format.toUpperCase()}${chunks.length > 1 ? ` (${chunks.length} jobs)` : ''}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the download.');
    } finally {
      setStarting(false);
    }
  }, [infoUi, selected, format, quality, bitrate, cookies, refreshRecent]);

  // --- job actions ---------------------------------------------------------
  const openJob = useCallback(async (id: string) => {
    try {
      const full = await fetchPlaylistJob(id);
      jobIdRef.current = full.id;
      setJob(full);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open that job.');
    }
  }, []);

  const handleCancel = useCallback(async () => {
    if (!job) return;
    setBusyAction(true);
    try {
      const { cancelPlaylistJob } = await import('@/lib/playlist/client');
      await cancelPlaylistJob(job.id);
      const status = await fetchPlaylistJob(job.id);
      setJob(status);
      toast.info('Download cancelled.');
      void refreshRecent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel.');
    } finally {
      setBusyAction(false);
    }
  }, [job, refreshRecent]);

  const handleRetry = useCallback(async () => {
    if (!job) return;
    setBusyAction(true);
    try {
      const { retryPlaylistJob } = await import('@/lib/playlist/client');
      await retryPlaylistJob(job.id);
      const status = await fetchPlaylistJob(job.id);
      jobIdRef.current = status.id;
      setJob(status);
      toast.info('Retrying failed videos…');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not retry.');
    } finally {
      setBusyAction(false);
    }
  }, [job]);

  const handleDelete = useCallback(async () => {
    if (!job) return;
    setBusyAction(true);
    try {
      await deletePlaylistJob(job.id);
      setJob(null);
      jobIdRef.current = null;
      void refreshRecent();
      toast.success('Job and files deleted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete.');
    } finally {
      setBusyAction(false);
    }
  }, [job, refreshRecent]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.info('The clipboard is empty.');
        return;
      }
      setUrl(text.trim());
    } catch {
      toast.error('Could not read the clipboard. Paste manually with Ctrl+V instead.');
    }
  }, []);

  // --- derived -------------------------------------------------------------
  const loading = infoUi.kind === 'loading';
  const ready = infoUi.kind === 'ready';
  const selectedCount = selected.size;
  const estBytes = ready
    ? infoUi.info.entries.reduce(
        (acc, e) => acc + (selected.has(e.i) ? (estimateItemBytes(e.duration, format, quality, bitrate) ?? 0) : 0),
        0
      )
    : 0;
  const activeJobCount = recent.filter((j) => !TERMINAL_JOB_STATES.has(j.state)).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
          <ListMusic className="h-6 w-6 text-primary sm:h-7 sm:w-7" aria-hidden />
          Playlist Downloader
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">
          Grab an <strong>entire playlist</strong> — any number of videos — in <strong>any format</strong>.
          Paste a playlist URL, pick exactly which videos you want, choose MP4, WebM, MKV, MOV, MP3, FLAC and
          more, then download files individually or as one ZIP. Or paste a list of direct URLs, one per line.
        </p>
      </header>

      <div className="space-y-6 sm:space-y-8">
        {/* Step 1 — URL */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Link2 className="h-4 w-4 text-primary" aria-hidden /> 1 · Playlist or video URL
            </CardTitle>
            <CardDescription>
              Playlist pages (e.g. SoundCloud sets, YouTube playlists with authorized access) are expanded to
              every video. Multiple pasted lines become a direct-URL list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void inspect(url);
              }}
            >
              <div className="relative flex-1">
                <Label htmlFor="pl-url" className="sr-only">Playlist URL</Label>
                <Input
                  id="pl-url"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://soundcloud.com/artist/sets/your-playlist  ·  or paste multiple URLs, one per line"
                  className="h-11 pr-11 text-sm sm:h-12 sm:text-base"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 sm:h-10 sm:w-10"
                  onClick={() => void pasteFromClipboard()}
                  aria-label="Paste URL from clipboard"
                >
                  <ClipboardPaste className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <Button type="submit" className="h-11 flex-1 sm:h-12 sm:flex-none sm:px-8" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Globe className="h-4 w-4" aria-hidden />}
                {loading ? 'Fetching playlist…' : 'Fetch'}
              </Button>
            </form>

            {infoUi.kind === 'error' && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" aria-hidden />
                <AlertTitle>Could not read that playlist</AlertTitle>
                <AlertDescription>{infoUi.message}</AlertDescription>
              </Alert>
            )}

            {ready && (
              <div className="space-y-2 border-t pt-4" aria-live="polite">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge variant={infoUi.info.kind === 'playlist' ? 'default' : 'secondary'}>
                    {infoUi.info.kind === 'playlist' ? 'Playlist' : 'Single media'}
                  </Badge>
                  <h2 className="min-w-0 flex-1 truncate text-base font-semibold sm:text-lg">
                    {infoUi.info.title}
                  </h2>
                  {infoUi.info.uploader && (
                    <span className="text-xs text-muted-foreground">by {infoUi.info.uploader}</span>
                  )}
                  <Badge variant="outline">{infoUi.info.count} item{infoUi.info.count === 1 ? '' : 's'}</Badge>
                  {estBytes > 0 && (
                    <Badge variant="outline">≈ {formatBytes(estBytes)} total</Badge>
                  )}
                </div>
                {infoUi.info.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {w}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2 — pick videos */}
        {ready && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Radio className="h-4 w-4 text-primary" aria-hidden /> 2 · Choose which videos to download
              </CardTitle>
              <CardDescription>
                Select any number — from one video to the entire playlist. Progress is tracked per video.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VideoList
                entries={infoUi.info.entries}
                selected={selected}
                onToggle={toggle}
                onSelectAll={selectAll}
                onSelectNone={selectNone}
                onInvert={invert}
                format={format}
                quality={quality}
                bitrate={bitrate}
              />
            </CardContent>
          </Card>
        )}

        {/* Step 3 — format + start */}
        {ready && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <ScrollText className="h-4 w-4 text-primary" aria-hidden /> 3 · Pick a format &amp; start
              </CardTitle>
              <CardDescription>
                Files are converted server-side with FFmpeg — one consistent format for the whole playlist.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FormatPicker
                format={format}
                quality={quality}
                bitrate={bitrate}
                onFormat={setFormat}
                onQuality={setQuality}
                onBitrate={setBitrate}
                cookies={cookies}
                onCookies={setCookies}
              />
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Ready to download <strong className="text-foreground">{selectedCount}</strong>{' '}
                  video{selectedCount === 1 ? '' : 's'} as <strong className="text-foreground">{format.toUpperCase()}</strong>
                  {estBytes > 0 && <> · approx. {formatBytes(estBytes)}</>}
                  {selectedCount > MAX_PER_JOB && (
                    <> · will be split into {Math.ceil(selectedCount / MAX_PER_JOB)} jobs</>
                  )}
                </p>
                <Button
                  size="lg"
                  className="h-12 px-8 text-base"
                  onClick={() => void startJob()}
                  disabled={starting || selectedCount === 0}
                >
                  {starting ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  ) : (
                    <ListMusic className="h-5 w-5" aria-hidden />
                  )}
                  {starting ? 'Starting…' : `Download ${selectedCount || ''} ${format.toUpperCase()}`}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live job monitor */}
        {job && (
          <JobMonitor
            job={job}
            onCancel={() => void handleCancel()}
            onRetry={() => void handleRetry()}
            onDelete={() => void handleDelete()}
            busyAction={busyAction}
          />
        )}

        {/* Recent jobs */}
        {recent.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <ScrollText className="h-4 w-4 text-primary" aria-hidden /> Download jobs
                {activeJobCount > 0 && <Badge variant="default">{activeJobCount} running</Badge>}
              </CardTitle>
              <CardDescription>
                Files stay available for 6 hours. Open a job to download or manage its files.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1" aria-label="Recent download jobs">
                {recent.map((j) => (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => void openJob(j.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60',
                        job?.id === j.id && 'border-primary/50 bg-primary/5'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{j.title}</span>
                      <Badge variant="outline">{j.format.toUpperCase()}</Badge>
                      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                        {j.completed}/{j.total}
                      </span>
                      <Badge
                        variant={j.state === 'active' ? 'default' : j.state === 'completed' ? 'secondary' : 'outline'}
                        className="shrink-0"
                      >
                        {j.state}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Honest capability note */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> What works, honestly
            </CardTitle>
            <CardDescription>No fake buttons — the engine reports exactly what happened per video.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="font-medium">✅ Fully supported</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
                <li>SoundCloud tracks &amp; sets — extraction + download verified</li>
                <li>Direct media URLs — paste any number, one per line</li>
                <li>Thousands of sources supported by the yt-dlp engine</li>
              </ul>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium flex items-center gap-1.5">
                <Cookie className="h-4 w-4" aria-hidden /> Needs your authorization
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
                <li>YouTube, Vimeo, Dailymotion — cloud IPs hit bot protection</li>
                <li>Paste your own cookies.txt (Advanced in step 3) for authorized access</li>
                <li>Only download content you own or are licensed to use</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Legal */}
      <div className="mt-12 border-t pt-6">
        <p className="text-center text-xs text-muted-foreground">
          Only download media you own or are authorized to use. Platform terms and copyright law apply.
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Need a single direct file instead?{' '}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => navigate('universal')}>
            Use the Universal Downloader
          </button>
          .
        </p>
      </div>
    </div>
  );
}

