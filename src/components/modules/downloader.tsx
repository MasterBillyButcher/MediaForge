'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardPaste, Download, Globe, Link2, ListPlus, ListVideo, Loader2, Scale, Search, Trash2, Youtube,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import {
  analyzeHls, cancelJob, deleteHistory, downloadUrl, fetchHistory, formatBytes, getJob, isHlsUrl,
  probeUrl, resultDownloadUrl, saveBlob, startHlsDownload,
} from '@/lib/api-client';
import type { HistoryRecord, UrlDownloadProgress } from '@/lib/api-client';
import type { HlsAnalyzeResult, JobSnapshot, UrlProbeResult } from '@/lib/types';
import {
  cancelPlaylistJob, createPlaylistJob, fetchPlaylistInfo, fetchPlaylistJob,
  playlistFileUrl, type PlaylistInfoDto, type PlaylistJobDto,
} from '@/lib/playlist/client';
import { genId } from './downloader/types';
import type { QueueItem } from './downloader/types';
import { SupportedSources } from './downloader/sources';
import { ProbeDirectCard, ProbeErrorPanel, ProbeUnsupportedPanel } from './downloader/probe-card';
import { HlsPanel } from './downloader/hls-panel';
import { ExtractionPanel } from './downloader/extraction-panel';
import { QueueList } from './downloader/queue-list';
import { HistoryTable } from './downloader/history-table';

type ProbeUi =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'direct'; result: UrlProbeResult }
  | { kind: 'hls'; result: HlsAnalyzeResult }
  | { kind: 'extract'; url: string; info: PlaylistInfoDto }
  | { kind: 'unsupported'; result: UrlProbeResult }
  | { kind: 'error'; message: string };

interface SingleDownload {
  url: string;
  progress: UrlDownloadProgress | null;
}

const URL_PATTERN = /^https?:\/\//i;

const COPY = {
  video: {
    title: 'Video Downloader',
    description:
      'Paste a direct video link, an HLS stream (.m3u8 — including Twitch VODs with unmuted-audio recovery) or a platform page. Everything runs for real: server-side ffmpeg assembly, live progress, no fake buttons.',
    fetchHint: 'Works with direct video file URLs and HLS (.m3u8) streams. Enter inspects the link before downloading.',
  },
  universal: {
    title: 'Universal Media Downloader',
    description:
      'Any media URL in one place: direct files stream with real progress, HLS (.m3u8) streams are assembled with quality selection plus unmuted-audio recovery for Twitch VODs, and platform pages are handled by the extraction engine.',
    fetchHint: 'Any media URL — direct file, HLS stream or platform page. The source type is detected automatically.',
  },
} as const;

export function DownloaderModule({ mode, initialUrl }: { mode: 'video' | 'universal'; initialUrl?: string }) {
  const copy = COPY[mode];

  // --- single URL flow -----------------------------------------------------
  const [url, setUrl] = useState('');
  const [probeUi, setProbeUi] = useState<ProbeUi>({ kind: 'idle' });
  const [singleDl, setSingleDl] = useState<SingleDownload | null>(null);
  const [singleSaved, setSingleSaved] = useState<{ url: string; fileName: string; sizeBytes: number } | null>(null);
  const [singleError, setSingleError] = useState<{ url: string; message: string } | null>(null);
  const singleAbortRef = useRef<AbortController | null>(null);
  const singleActiveRef = useRef(false);

  // --- batch queue ---------------------------------------------------------
  const [items, setItems] = useState<QueueItem[]>([]);
  const [queueText, setQueueText] = useState('');
  const itemsRef = useRef<QueueItem[]>([]);
  const pumpBusyRef = useRef(false);
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const queueJobCancelRef = useRef(new Map<string, () => void>());

  // --- history -------------------------------------------------------------
  const [history, setHistory] = useState<HistoryRecord[] | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      const records = await fetchHistory();
      setHistory(records);
    } catch {
      // history is non-critical; keep whatever is already loaded
      setHistory((prev) => prev ?? []);
    }
  }, []);

  // --- single URL probe ----------------------------------------------------
  const inspect = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      toast.error('Enter a URL first.');
      return;
    }
    if (!URL_PATTERN.test(trimmed)) {
      setProbeUi({ kind: 'error', message: 'Enter a full URL starting with http:// or https://.' });
      return;
    }
    setProbeUi({ kind: 'probing' });
    setSingleError(null);
    setSingleSaved(null);

    // HLS manifests: parse the stream (qualities + Twitch unmuted audio track)
    if (isHlsUrl(trimmed)) {
      try {
        const hls = await analyzeHls(trimmed);
        if (hls.ok) {
          setProbeUi({ kind: 'hls', result: hls });
          return;
        }
        // not an HLS manifest after all -> fall through to the regular probe
      } catch (err) {
        setProbeUi({
          kind: 'error',
          message: err instanceof Error ? err.message : 'The stream could not be inspected.',
        });
        return;
      }
    }

    try {
      const result = await probeUrl(trimmed);
      if (result.ok === false) {
        setProbeUi({ kind: 'error', message: result.error ?? 'The URL could not be inspected.' });
        return;
      }
      if (result.direct) {
        setProbeUi({ kind: 'direct', result });
        return;
      }
      // Platform page -> try the extraction engine (same one the Playlist Downloader uses)
      try {
        const info = await fetchPlaylistInfo(trimmed);
        setProbeUi({ kind: 'extract', url: trimmed, info });
      } catch {
        setProbeUi({ kind: 'unsupported', result });
      }
    } catch (err) {
      setProbeUi({ kind: 'error', message: err instanceof Error ? err.message : 'The URL could not be inspected.' });
    }
  }, []);

  // --- single URL download -------------------------------------------------
  const startSingleDownload = useCallback(async (result: UrlProbeResult) => {
    if (singleActiveRef.current) return;
    singleActiveRef.current = true;
    const ac = new AbortController();
    singleAbortRef.current = ac;
    setSingleSaved(null);
    setSingleError(null);
    setSingleDl({ url: result.url, progress: null });
    let lastUi = 0;
    try {
      const { blob, fileName } = await downloadUrl(
        result.url,
        (p) => {
          const now = performance.now();
          if (now - lastUi > 120) {
            lastUi = now;
            setSingleDl({ url: result.url, progress: p });
          }
        },
        ac.signal
      );
      saveBlob(blob, fileName);
      setSingleSaved({ url: result.url, fileName, sizeBytes: blob.size });
      toast.success(`Downloaded ${fileName}`, { description: formatBytes(blob.size) });
      void refreshHistory();
    } catch (err) {
      if (!ac.signal.aborted) {
        const message = err instanceof Error ? err.message : 'Download failed.';
        setSingleError({ url: result.url, message });
        toast.error(message);
        void refreshHistory();
      } else {
        toast.info('Download cancelled.');
      }
    } finally {
      singleActiveRef.current = false;
      singleAbortRef.current = null;
      setSingleDl(null);
    }
  }, [refreshHistory]);

  const cancelSingleDownload = useCallback(() => {
    singleAbortRef.current?.abort();
  }, []);

  // --- batch queue engine (sequential: probe, then download, one item at a time)
  const applyItems = useCallback((updater: (prev: QueueItem[]) => QueueItem[]) => {
    itemsRef.current = updater(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<QueueItem>) => {
      applyItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    },
    [applyItems]
  );

  /** Track a server-side HLS job until completion, then save the file. */
  const trackHlsJob = useCallback(
    async (id: string, jobId: string) => {
      queueJobCancelRef.current.set(id, () => {
        void cancelJob(jobId);
      });
      let lastUi = 0;
      let snapshot: JobSnapshot | null = null;
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        try { snapshot = await getJob(jobId); } catch { snapshot = null; }
        if (!snapshot) {
          queueJobCancelRef.current.delete(id);
          updateItem(id, { state: 'failed', error: 'Lost connection to the server.', job: null, progress: null });
          return;
        }
        if (snapshot.state === 'processing' || snapshot.state === 'queued') {
          const now = performance.now();
          if (now - lastUi > 150) {
            lastUi = now;
            updateItem(id, {
              state: 'downloading',
              job: { kind: 'hls', id: jobId, progress: snapshot.progress, speed: snapshot.speed, eta: snapshot.etaSeconds },
              progress: {
                receivedBytes: 0, totalBytes: null, percent: snapshot.progress,
                speedMbps: null, etaSeconds: snapshot.etaSeconds,
              },
            });
          }
          continue;
        }
        break; // terminal state
      }
      queueJobCancelRef.current.delete(id);
      if (snapshot.state === 'completed' && snapshot.result) {
        try {
          const res = await fetch(resultDownloadUrl(jobId));
          if (!res.ok) throw new Error('Could not fetch the finished file.');
          const blob = await res.blob();
          saveBlob(blob, snapshot.result.name);
          updateItem(id, { state: 'completed', fileName: snapshot.result.name, sizeBytes: blob.size, job: null, progress: null });
          toast.success(`Downloaded ${snapshot.result.name}`, { description: formatBytes(blob.size) });
          void refreshHistory();
        } catch (err) {
          updateItem(id, {
            state: 'failed',
            error: err instanceof Error ? err.message : 'Could not save the file.',
            job: null, progress: null,
          });
        }
      } else if (snapshot.state === 'failed') {
        updateItem(id, { state: 'failed', error: snapshot.error ?? 'Processing failed.', job: null, progress: null });
        void refreshHistory();
      } else {
        updateItem(id, { state: 'failed', error: 'Cancelled.', job: null, progress: null });
      }
    },
    [refreshHistory, updateItem]
  );

  /** Track an extraction-engine job (playlist worker) until completion. */
  const trackExtractJob = useCallback(
    async (id: string, jobId: string) => {
      queueJobCancelRef.current.set(id, () => {
        void cancelPlaylistJob(jobId);
      });
      updateItem(id, {
        state: 'downloading',
        job: { kind: 'extract', id: jobId, progress: 0, speed: null, eta: null },
        progress: { receivedBytes: 0, totalBytes: null, percent: 0, speedMbps: null, etaSeconds: null },
      });
      let lastUi = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        let j: PlaylistJobDto | null = null;
        try { j = await fetchPlaylistJob(jobId); } catch { j = null; }
        if (!j) {
          queueJobCancelRef.current.delete(id);
          updateItem(id, { state: 'failed', error: 'Lost connection to the extraction service.', job: null, progress: null });
          return;
        }
        const v = j.videos[0];
        if (!v) continue;
        if (v.state === 'pending' || v.state === 'downloading' || v.state === 'processing') {
          const now = performance.now();
          if (now - lastUi > 150) {
            lastUi = now;
            updateItem(id, {
              state: 'downloading',
              job: { kind: 'extract', id: jobId, progress: v.progress, speed: v.speed, eta: v.eta },
              progress: {
                receivedBytes: 0, totalBytes: null, percent: v.progress,
                speedMbps: null, etaSeconds: v.eta,
              },
            });
          }
          continue;
        }
        // terminal
        queueJobCancelRef.current.delete(id);
        if (v.state === 'completed') {
          const a = document.createElement('a');
          a.href = playlistFileUrl(jobId, 0);
          a.download = v.fileName ?? 'download';
          document.body.appendChild(a);
          a.click();
          a.remove();
          updateItem(id, { state: 'completed', fileName: v.fileName ?? 'download', sizeBytes: v.sizeBytes, job: null, progress: null });
          toast.success(`Downloaded ${v.fileName ?? 'file'}`, { description: formatBytes(v.sizeBytes) });
          void refreshHistory();
        } else if (v.state === 'failed') {
          updateItem(id, { state: 'failed', error: v.error ?? 'Extraction failed.', job: null, progress: null });
          void refreshHistory();
        } else {
          updateItem(id, { state: 'failed', error: 'Cancelled.', job: null, progress: null });
        }
        return;
      }
    },
    [refreshHistory, updateItem]
  );

  const downloadQueueItem = useCallback(
    async (id: string, itemUrl: string) => {
      const ac = new AbortController();
      abortControllersRef.current.set(id, ac);
      updateItem(id, { state: 'downloading', progress: null, fileName: null, sizeBytes: null });
      let lastUi = 0;
      try {
        const { blob, fileName } = await downloadUrl(
          itemUrl,
          (p) => {
            const now = performance.now();
            if (now - lastUi > 120) {
              lastUi = now;
              updateItem(id, { progress: p });
            }
          },
          ac.signal
        );
        saveBlob(blob, fileName);
        updateItem(id, { state: 'completed', fileName, sizeBytes: blob.size, progress: null });
        toast.success(`Downloaded ${fileName}`, { description: formatBytes(blob.size) });
        void refreshHistory();
      } catch (err) {
        if (ac.signal.aborted) {
          updateItem(id, { state: 'failed', error: 'Cancelled.', progress: null });
        } else {
          const message = err instanceof Error ? err.message : 'Download failed.';
          updateItem(id, { state: 'failed', error: message, progress: null });
          toast.error(`Download failed: ${message}`);
          void refreshHistory();
        }
      } finally {
        abortControllersRef.current.delete(id);
      }
    },
    [refreshHistory, updateItem]
  );

  const processQueueItem = useCallback(
    async (id: string, itemUrl: string) => {
      updateItem(id, { state: 'probing', error: null, progress: null, probe: null, job: null });

      // 1) HLS manifests — pick the best quality and download server-side
      //    with the unmuted audio track when one is available (Twitch VODs).
      if (isHlsUrl(itemUrl)) {
        try {
          const hls = await analyzeHls(itemUrl);
          if (hls.ok) {
            const best =
              [...hls.variants]
                .filter((v) => !v.isAudioOnly)
                .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0] ??
              hls.variants[0];
            const { job } = await startHlsDownload({
              url: best.url,
              audioUrl: hls.unmutedAudio.available ? hls.unmutedAudio.url : null,
              format: 'mp4',
              title: hls.title,
              duration: hls.duration,
            });
            await trackHlsJob(id, job.id);
            return;
          }
        } catch (err) {
          updateItem(id, {
            state: 'failed',
            error: err instanceof Error ? err.message : 'The stream could not be inspected.',
            progress: null,
          });
          return;
        }
      }

      // 2) direct file probe + stream
      let probe: UrlProbeResult;
      try {
        probe = await probeUrl(itemUrl);
      } catch (err) {
        updateItem(id, {
          state: 'failed',
          error: err instanceof Error ? err.message : 'The URL could not be inspected.',
          progress: null,
        });
        return;
      }
      if (probe.ok === false) {
        updateItem(id, { state: 'failed', error: probe.error ?? 'The URL could not be inspected.' });
        return;
      }
      if (probe.direct) {
        updateItem(id, { state: 'ready', probe });
        await downloadQueueItem(id, itemUrl);
        return;
      }

      // 3) platform page -> extraction engine (single videos only; playlists are skipped)
      try {
        const info = await fetchPlaylistInfo(itemUrl);
        if (info.kind === 'single' && info.entries.length > 0) {
          const { jobId } = await createPlaylistJob({
            title: info.title || 'video',
            sourceUrl: itemUrl,
            format: 'mp4',
            quality: 'best',
            bitrate: 'best',
            entries: info.entries.map((e) => ({ url: e.url || itemUrl, title: e.title })),
          });
          await trackExtractJob(id, jobId);
        } else {
          updateItem(id, { state: 'unsupported', probe });
        }
      } catch {
        updateItem(id, { state: 'unsupported', probe });
      }
    },
    [downloadQueueItem, trackExtractJob, trackHlsJob, updateItem]
  );

  const pump = useCallback(async () => {
    if (pumpBusyRef.current) return;
    pumpBusyRef.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.state === 'waiting');
        if (!next) break;
        await processQueueItem(next.id, next.url);
      }
    } finally {
      pumpBusyRef.current = false;
    }
  }, [processQueueItem]);

  /** Adds URLs to the queue; returns how many were actually added. */
  const addToQueue = useCallback(
    (rawUrls: string[]): number => {
      const all = rawUrls.map((u) => u.trim()).filter((u) => u.length > 0);
      if (all.length === 0) {
        toast.error('Enter at least one URL.');
        return 0;
      }
      const valid = all.filter((u) => URL_PATTERN.test(u));
      const invalid = all.length - valid.length;
      const activeUrls = new Set(
        itemsRef.current
          .filter((i) => i.state !== 'completed' && i.state !== 'failed' && i.state !== 'unsupported')
          .map((i) => i.url)
      );
      const fresh: QueueItem[] = [];
      let duplicates = 0;
      for (const itemUrl of valid) {
        if (activeUrls.has(itemUrl)) {
          duplicates += 1;
          continue;
        }
        activeUrls.add(itemUrl);
        fresh.push({
          id: genId(),
          url: itemUrl,
          state: 'waiting',
          probe: null,
          error: null,
          progress: null,
          fileName: null,
          sizeBytes: null,
          job: null,
        });
      }
      if (fresh.length > 0) {
        applyItems((prev) => [...prev, ...fresh]);
        toast.success(`${fresh.length} URL${fresh.length === 1 ? '' : 's'} added to queue.`);
        void pump();
      }
      const notes: string[] = [];
      if (duplicates > 0) notes.push(`${duplicates} duplicate${duplicates === 1 ? '' : 's'} already queued`);
      if (invalid > 0) {
        notes.push(`${invalid} invalid line${invalid === 1 ? '' : 's'} skipped (URLs must start with http:// or https://)`);
      }
      if (notes.length > 0) toast.info(notes.join(' · '));
      return fresh.length;
    },
    [applyItems, pump]
  );

  const clearQueue = useCallback(() => {
    for (const ac of abortControllersRef.current.values()) ac.abort();
    abortControllersRef.current.clear();
    for (const cancelFn of queueJobCancelRef.current.values()) cancelFn();
    queueJobCancelRef.current.clear();
    applyItems(() => []);
    toast.success('Queue cleared.');
  }, [applyItems]);

  const cancelQueueItem = useCallback((id: string) => {
    const cancelJobFn = queueJobCancelRef.current.get(id);
    if (cancelJobFn) {
      cancelJobFn();
      return;
    }
    abortControllersRef.current.get(id)?.abort();
  }, []);

  const retryQueueItem = useCallback(
    (id: string) => {
      updateItem(id, { state: 'waiting', error: null, progress: null, job: null });
      void pump();
    },
    [pump, updateItem]
  );

  const removeQueueItem = useCallback(
    (id: string) => {
      const cancelJobFn = queueJobCancelRef.current.get(id);
      if (cancelJobFn) cancelJobFn();
      queueJobCancelRef.current.delete(id);
      abortControllersRef.current.get(id)?.abort();
      applyItems((prev) => prev.filter((i) => i.id !== id));
    },
    [applyItems]
  );

  // --- history actions -----------------------------------------------------
  const handleClearHistory = useCallback(async () => {
    try {
      await deleteHistory();
      setHistory([]);
      toast.success('Download history cleared.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not clear the download history.');
    }
  }, []);

  const handleDeleteHistory = useCallback(async (id: string) => {
    try {
      await deleteHistory(id);
      setHistory((prev) => prev?.filter((h) => h.id !== id) ?? null);
      toast.success('History entry deleted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the history entry.');
    }
  }, []);

  // --- clipboard -----------------------------------------------------------
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

  // --- mount: inspect a pre-filled URL exactly once ------------------------
  const lastPayloadUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialUrl || lastPayloadUrlRef.current === initialUrl) return;
    lastPayloadUrlRef.current = initialUrl;
    useAppStore.getState().consumePayload();
    setUrl(initialUrl);
    void inspect(initialUrl);
  }, [initialUrl, inspect]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // abort everything on unmount
  useEffect(() => {
    return () => {
      singleAbortRef.current?.abort();
      for (const ac of abortControllersRef.current.values()) ac.abort();
    };
  }, []);
  // --- derived -------------------------------------------------------------
  const probing = probeUi.kind === 'probing';
  const inspectedUrl = probeUi.kind === 'direct' ? probeUi.result.url : null;
  const busyElsewhere =
    inspectedUrl != null &&
    items.some((i) => i.url === inspectedUrl && (i.state === 'probing' || i.state === 'downloading'));

  const HeaderIcon = mode === 'video' ? Youtube : Download;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Header */}
      <header className="mb-8">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
          <HeaderIcon className="h-6 w-6 text-primary sm:h-7 sm:w-7" aria-hidden />
          {copy.title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{copy.description}</p>
      </header>

      <div className="space-y-6 sm:space-y-8">
        {/* Single URL fetch */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Link2 className="h-4 w-4 text-primary" aria-hidden /> Fetch a media URL
            </CardTitle>
            <CardDescription>{copy.fetchHint}</CardDescription>
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
                <Label htmlFor="downloader-url" className="sr-only">
                  Media URL
                </Label>
                <Input
                  id="downloader-url"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://example.com/video.mp4"
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
              <div className="flex gap-2">
                <Button
                  type="submit"
                  className="h-11 flex-1 sm:h-12 sm:flex-none sm:px-8"
                  disabled={probing}
                >
                  {probing ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Search className="h-4 w-4" aria-hidden />
                  )}
                  {probing ? 'Fetching...' : 'Fetch'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 sm:h-12 sm:flex-none"
                  onClick={() => addToQueue([url])}
                >
                  <ListPlus className="h-4 w-4" aria-hidden /> Add to queue
                </Button>
              </div>
            </form>

            {probeUi.kind !== 'idle' && (
              <div className="border-t pt-4" aria-live="polite">
                {probeUi.kind === 'probing' && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Inspecting URL...
                  </p>
                )}
                {probeUi.kind === 'error' && <ProbeErrorPanel message={probeUi.message} />}
                {probeUi.kind === 'unsupported' && <ProbeUnsupportedPanel result={probeUi.result} />}
                {probeUi.kind === 'hls' && (
                  <HlsPanel result={probeUi.result} onSaved={() => void refreshHistory()} />
                )}
                {probeUi.kind === 'extract' && (
                  <ExtractionPanel url={probeUi.url} info={probeUi.info} onSaved={() => void refreshHistory()} />
                )}
                {probeUi.kind === 'direct' && (
                  <ProbeDirectCard
                    result={probeUi.result}
                    downloadProgress={singleDl && singleDl.url === probeUi.result.url ? singleDl.progress : null}
                    saved={singleSaved && singleSaved.url === probeUi.result.url ? singleSaved : null}
                    downloadError={
                      singleError && singleError.url === probeUi.result.url ? singleError.message : null
                    }
                    busyElsewhere={busyElsewhere}
                    onDownload={() => void startSingleDownload(probeUi.result)}
                    onCancel={cancelSingleDownload}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Batch queue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <ListVideo className="h-4 w-4 text-primary" aria-hidden /> Batch queue
              {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
            </CardTitle>
            <CardDescription>
              Queued URLs are handled one at a time, in order: HLS streams (.m3u8) are assembled server-side in
              best quality with unmuted audio when available, direct files stream directly, and platform pages go
              through the extraction engine. Unsupported links are marked and skipped.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="downloader-queue" className="sr-only">
                URLs to queue, one per line
              </Label>
              <Textarea
                id="downloader-queue"
                rows={3}
                spellCheck={false}
                placeholder={'https://example.com/clip.mp4\nhttps://example.com/stream/index.m3u8\nhttps://clips.example.com/watch/abc'}
                className="min-h-24 font-mono text-sm"
                value={queueText}
                onChange={(e) => setQueueText(e.target.value)}
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  One URL per line. Pasting multiple lines splits them into separate queue items.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={clearQueue} disabled={items.length === 0}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Clear queue
                  </Button>
                  <Button
                    onClick={() => {
                      const added = addToQueue(queueText.split(/\r?\n/));
                      if (added > 0) setQueueText('');
                    }}
                  >
                    <ListPlus className="h-4 w-4" aria-hidden /> Add to queue
                  </Button>
                </div>
              </div>
            </div>
            <QueueList items={items} onCancel={cancelQueueItem} onRetry={retryQueueItem} onRemove={removeQueueItem} />
          </CardContent>
        </Card>

        {/* Supported sources */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Globe className="h-4 w-4 text-primary" aria-hidden /> Supported sources
            </CardTitle>
            <CardDescription>
              An honest capability overview — what downloads directly and what requires authorized access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SupportedSources mode={mode} />
          </CardContent>
        </Card>

        {/* Download history */}
        <HistoryTable
          history={history}
          onRefresh={() => void refreshHistory()}
          onClear={() => void handleClearHistory()}
          onDelete={(id) => void handleDeleteHistory(id)}
        />
      </div>

      {/* Legal note */}
      <div className="mt-12 border-t pt-6">
        <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <Scale className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Only download media you own or are authorized to use. Platform terms and copyright apply.
        </p>
      </div>
    </div>
  );
}
