'use client';

import { useRef, useState } from 'react';
import {
  Copy, Download, FileDown, Loader2, Plus, Timer, Trash2, Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Dropzone, UploadedFileCard } from '@/components/shared/dropzone';
import { extractSubtitles, fileUrl, formatBytes, saveBlob } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import type { MediaFileRecord } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  parseSubtitles, parseTimeLenient, formatTimestamp, serializeSubtitles,
  stripExtension, type Cue, type ParseResult, type SubtitleFormat,
} from './srt';

type Tab = 'editor' | 'sync' | 'convert' | 'extract';

interface TrackInfo {
  index: number;
  codec: string;
  language: string;
}

const SCALE_PRESETS: Array<{ label: string; factor: number }> = [
  { label: '23.976 → 25', factor: 25 / 23.976 },
  { label: '25 → 23.976', factor: 23.976 / 25 },
  { label: '24 → 25', factor: 25 / 24 },
  { label: '29.97 → 30', factor: 30 / 29.97 },
  { label: '30 → 25', factor: 25 / 30 },
];

export function SubtitleToolsModule() {
  // page.tsx keys this module by payload.tool — read (not consume) the payload here so the
  // preselected tab survives; navigate() overwrites the payload on every navigation anyway.
  const [tab, setTab] = useState<Tab>(() =>
    useAppStore.getState().payload?.tool === 'subtitle-extract' ? 'extract' : 'editor'
  );
  const [cues, setCues] = useState<Cue[]>([]);
  const [snapshots, setSnapshots] = useState<Cue[][]>([]);
  const [baseName, setBaseName] = useState('subtitles');
  const [sourceFormat, setSourceFormat] = useState<SubtitleFormat | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);

  const newCueId = useRef(0);

  const pushSnapshot = () => {
    setSnapshots((prev) => [...prev.slice(-24), cues]);
  };

  const applyParsed = (parsed: ParseResult, name?: string): boolean => {
    if (!parsed.cues.length) {
      toast.error('No cues were found — is this a valid SRT or VTT file?');
      return false;
    }
    pushSnapshot();
    setCues(parsed.cues);
    setSourceFormat(parsed.format);
    setLoadWarnings(parsed.errors);
    if (name) setBaseName(stripExtension(name));
    toast.success(`Loaded ${parsed.cues.length} cues.`);
    return true;
  };

  const loadUploadedFile = async (record: MediaFileRecord) => {
    try {
      const res = await fetch(fileUrl(record.id));
      if (!res.ok) throw new Error(`Could not read the uploaded file (${res.status}).`);
      const text = await res.text();
      applyParsed(parseSubtitles(text), record.originalName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load the subtitle file.');
    }
  };

  const parsePasted = () => {
    if (!pasteText.trim()) {
      toast.error('Paste some SRT or VTT text first.');
      return;
    }
    applyParsed(parseSubtitles(pasteText), 'pasted');
  };

  // ------------------------------------------------------------- cue editing
  const updateCue = (id: string, patch: Partial<Cue>) => {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addCue = () => {
    newCueId.current += 1;
    const last = cues[cues.length - 1];
    const start = last ? Math.max(0, last.end) : 0;
    setCues((prev) => [...prev, { id: `cue-new-${newCueId.current}`, start, end: start + 2, text: '' }]);
  };

  const duplicateCue = (cue: Cue) => {
    newCueId.current += 1;
    setCues((prev) => {
      const idx = prev.findIndex((c) => c.id === cue.id);
      if (idx < 0) return prev;
      const copy: Cue = { ...cue, id: `cue-new-${newCueId.current}` };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  };

  const deleteCue = (id: string) => setCues((prev) => prev.filter((c) => c.id !== id));

  // --------------------------------------------------------------- sync ops
  const undo = () => {
    if (!snapshots.length) return;
    const previous = snapshots[snapshots.length - 1];
    setSnapshots((s) => s.slice(0, -1));
    setCues(previous);
    toast.success('Reverted the last change.');
  };

  const exportAs = (fmt: SubtitleFormat) => {
    if (!cues.length) return;
    const text = serializeSubtitles(cues, fmt);
    const name = `${baseName || 'subtitles'}-edited.${fmt}`;
    saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name);
    toast.success(`Downloaded ${name}`);
  };

  const invalidCount = cues.filter((c) => c.end <= c.start).length;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Subtitle Tools</h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          Edit, re-time, convert and extract subtitles — all parsing and export runs locally in your browser.
        </p>
      </header>

      {/* ------------------------------------------------------- shared loader */}
      <Card className="mb-6">
        <CardHeader className="pb-4">
          <CardTitle className="text-base sm:text-lg">Load subtitles</CardTitle>
          <CardDescription>Upload an SRT/VTT file or paste its content. {sourceFormat ? `Current source: ${sourceFormat.toUpperCase()} · ${cues.length} cues.` : 'Nothing loaded yet.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Dropzone category="subtitle" compact onUploaded={loadUploadedFile} label="Drop an .srt or .vtt file here" hint="Parsed locally — nothing leaves the browser after upload" />
          <div className="space-y-2">
            <Label htmlFor="paste">Or paste subtitle text</Label>
            <Textarea
              id="paste"
              rows={4}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'1\n00:00:01,000 --> 00:00:03,500\nHello world'}
              className="font-mono text-xs"
            />
            <Button variant="outline" onClick={parsePasted} className="min-h-11">
              Parse pasted text
            </Button>
          </div>
          {loadWarnings.length > 0 && (
            <Alert>
              <AlertDescription>
                Parsed with {loadWarnings.length} skipped line{loadWarnings.length === 1 ? '' : 's'} — first issue:{' '}
                {loadWarnings[0]}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60">
          <TabsTrigger value="editor">SRT Editor</TabsTrigger>
          <TabsTrigger value="sync">Sync &amp; Shift</TabsTrigger>
          <TabsTrigger value="convert">Converter</TabsTrigger>
          <TabsTrigger value="extract">Extract from Video</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------ SRT Editor */}
        <TabsContent value="editor" className="mt-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base sm:text-lg">Cue editor</CardTitle>
                  <CardDescription>
                    {cues.length ? `${cues.length} cues` : 'No cues loaded yet.'}
                    {invalidCount > 0 && <span className="text-destructive"> · {invalidCount} invalid</span>}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="min-h-11" onClick={addCue}>
                    <Plus className="h-4 w-4 mr-1.5" aria-hidden /> Add cue
                  </Button>
                  <Button variant="outline" size="sm" className="min-h-11" disabled={!cues.length} onClick={() => exportAs('srt')}>
                    <FileDown className="h-4 w-4 mr-1.5" aria-hidden /> Download SRT
                  </Button>
                  <Button variant="outline" size="sm" className="min-h-11" disabled={!cues.length} onClick={() => exportAs('vtt')}>
                    <FileDown className="h-4 w-4 mr-1.5" aria-hidden /> Download VTT
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {cues.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Load a subtitle file above, paste text, or click &quot;Add cue&quot; to start from scratch.
                </p>
              ) : (
                <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1 scrollbar-slim">
                  {cues.map((cue, idx) => {
                    const orderInvalid = cue.end <= cue.start;
                    return (
                      <div key={cue.id} className={cn('rounded-lg border p-3', orderInvalid && 'border-destructive/50 bg-destructive/5')}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="shrink-0">{idx + 1}</Badge>
                          <TimeInput
                            value={cue.start}
                            onCommit={(v) => updateCue(cue.id, { start: v })}
                            ariaLabel={`Start time of cue ${idx + 1}`}
                          />
                          <span className="text-xs text-muted-foreground" aria-hidden>→</span>
                          <TimeInput
                            value={cue.end}
                            onCommit={(v) => updateCue(cue.id, { end: v })}
                            invalid={orderInvalid}
                            ariaLabel={`End time of cue ${idx + 1}`}
                          />
                          {orderInvalid && <span className="text-xs text-destructive">End must be after start</span>}
                          <div className="ml-auto flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9"
                              onClick={() => duplicateCue(cue)}
                              aria-label={`Duplicate cue ${idx + 1}`}
                            >
                              <Copy className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-destructive hover:text-destructive"
                              onClick={() => deleteCue(cue.id)}
                              aria-label={`Delete cue ${idx + 1}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        </div>
                        <Textarea
                          value={cue.text}
                          rows={2}
                          placeholder="Cue text"
                          aria-label={`Text of cue ${idx + 1}`}
                          onChange={(e) => updateCue(cue.id, { text: e.target.value })}
                          className="mt-2 text-sm"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------- Sync & Shift */}
        <TabsContent value="sync" className="mt-4">
          <SyncPanel
            cues={cues}
            snapshots={snapshots}
            onPushSnapshot={pushSnapshot}
            onUndo={undo}
            setCues={setCues}
            onExport={exportAs}
          />
        </TabsContent>

        {/* -------------------------------------------------------- Converter */}
        <TabsContent value="convert" className="mt-4">
          <ConverterPanel cues={cues} sourceFormat={sourceFormat} baseName={baseName} />
        </TabsContent>

        {/* ------------------------------------------------ Extract from Video */}
        <TabsContent value="extract" className="mt-4">
          <ExtractPanel
            onLoadedIntoEditor={(parsed, name) => {
              const ok = applyParsed(parsed, name);
              if (ok) setTab('editor');
              return ok;
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time input with lenient parsing
// ---------------------------------------------------------------------------

function TimeInput({
  value, onCommit, invalid, ariaLabel,
}: {
  value: number;
  onCommit: (v: number) => void;
  invalid?: boolean;
  ariaLabel: string;
}) {
  const [text, setText] = useState(() => formatTimestamp(value, false));
  const [focused, setFocused] = useState(false);
  const [lastExternal, setLastExternal] = useState(value);
  // Reset the visible text when the committed value changes from outside (render-adjust pattern).
  if (lastExternal !== value) {
    setLastExternal(value);
    if (!focused) setText(formatTimestamp(value, false));
  }

  const parseInvalid = parseTimeLenient(text) == null;

  return (
    <Input
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const sec = parseTimeLenient(e.target.value);
        if (sec != null) onCommit(sec);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(formatTimestamp(value, false));
      }}
      className={cn('h-9 w-36 font-mono text-xs', (invalid || parseInvalid) && 'border-destructive focus-visible:ring-destructive')}
    />
  );
}

// ---------------------------------------------------------------------------
// Sync & Shift panel
// ---------------------------------------------------------------------------

function SyncPanel({
  cues, snapshots, onPushSnapshot, onUndo, setCues, onExport,
}: {
  cues: Cue[];
  snapshots: Cue[][];
  onPushSnapshot: () => void;
  onUndo: () => void;
  setCues: React.Dispatch<React.SetStateAction<Cue[]>>;
  onExport: (fmt: SubtitleFormat) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [factor, setFactor] = useState(1);

  const empty = cues.length === 0;

  const applyShift = () => {
    if (empty) {
      toast.error('Load some cues first.');
      return;
    }
    if (!Number.isFinite(offset) || offset === 0) {
      toast.error('Enter a non-zero offset in seconds.');
      return;
    }
    onPushSnapshot();
    setCues((prev) => prev.map((c) => ({ ...c, start: Math.max(0, c.start + offset), end: Math.max(0, c.end + offset) })));
    toast.success(`Shifted ${cues.length} cues by ${offset > 0 ? '+' : ''}${offset.toFixed(1)} s.`);
  };

  const applyScale = () => {
    if (empty) {
      toast.error('Load some cues first.');
      return;
    }
    if (!Number.isFinite(factor) || factor <= 0) {
      toast.error('The scale factor must be a positive number.');
      return;
    }
    onPushSnapshot();
    setCues((prev) => prev.map((c) => ({ ...c, start: Math.max(0, c.start * factor), end: Math.max(0, c.end * factor) })));
    toast.success(`Scaled ${cues.length} cues by ×${factor.toFixed(6)}.`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base sm:text-lg">Shift all timings</CardTitle>
          <CardDescription>Move every cue earlier or later by a fixed offset.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="offset">Offset (seconds, ±)</Label>
              <Input
                id="offset"
                type="number"
                step={0.1}
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
                className="w-40"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => setOffset((v) => Math.round((v - 0.5) * 10) / 10)}>-0.5 s</Button>
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => setOffset((v) => Math.round((v + 0.5) * 10) / 10)}>+0.5 s</Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Will shift <span className="font-medium text-foreground">{cues.length}</span> cues by{' '}
            <span className="font-medium text-foreground tabular-nums">
              {offset >= 0 ? '+' : ''}{Number.isFinite(offset) ? offset.toFixed(1) : '—'} s
            </span>
            . Negative results are clamped to 0.
          </p>
          <Button onClick={applyShift} disabled={empty} className="min-h-11">Shift all timings</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base sm:text-lg">Linear scale</CardTitle>
          <CardDescription>Multiply all times by a factor — useful for frame-rate conversions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="factor">Scale factor</Label>
            <Input
              id="factor"
              type="number"
              step={0.0001}
              min={0}
              value={factor}
              onChange={(e) => setFactor(Number(e.target.value))}
              className="w-44"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {SCALE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                className="min-h-9"
                onClick={() => setFactor(Math.round(preset.factor * 1e6) / 1e6)}
                aria-label={`Set scale factor for ${preset.label}`}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Will scale <span className="font-medium text-foreground">{cues.length}</span> cues by{' '}
            <span className="font-medium text-foreground tabular-nums">×{Number.isFinite(factor) ? factor.toFixed(6) : '—'}</span>.
          </p>
          <Button onClick={applyScale} disabled={empty} className="min-h-11">Apply scale</Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={onUndo} disabled={snapshots.length === 0} className="min-h-11">
          <Undo2 className="h-4 w-4 mr-2" aria-hidden /> Undo last apply
        </Button>
        <span className="text-xs text-muted-foreground">
          {snapshots.length ? `${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'} available` : 'No snapshots yet'}
        </span>
        <Separator orientation="vertical" className="mx-1 hidden h-8 sm:block" />
        <Button variant="outline" size="sm" className="min-h-11" disabled={!cues.length} onClick={() => onExport('srt')}>
          <FileDown className="h-4 w-4 mr-1.5" aria-hidden /> Download SRT
        </Button>
        <Button variant="outline" size="sm" className="min-h-11" disabled={!cues.length} onClick={() => onExport('vtt')}>
          <FileDown className="h-4 w-4 mr-1.5" aria-hidden /> Download VTT
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Converter panel
// ---------------------------------------------------------------------------

function ConverterPanel({
  cues, sourceFormat, baseName,
}: {
  cues: Cue[];
  sourceFormat: SubtitleFormat | null;
  baseName: string;
}) {
  const [target, setTarget] = useState<SubtitleFormat>('vtt');
  const [output, setOutput] = useState<string | null>(null);

  const convert = () => {
    if (!cues.length) {
      toast.error('Load some cues first.');
      return;
    }
    const text = serializeSubtitles(cues, target);
    setOutput(text);
    toast.success(`Converted ${cues.length} cues to ${target.toUpperCase()}.`);
  };

  const download = () => {
    if (!output) return;
    const name = `${baseName || 'subtitles'}.${target}`;
    saveBlob(new Blob([output], { type: 'text/plain;charset=utf-8' }), name);
    toast.success(`Downloaded ${name}`);
  };

  const previewLines = output ? output.replace(/\n$/, '').split('\n') : [];

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base sm:text-lg">Convert between SRT and VTT</CardTitle>
        <CardDescription>
          {sourceFormat ? `Detected source format: ${sourceFormat.toUpperCase()}` : 'No file loaded'} · {cues.length} cues.
          Conversion rewrites the millisecond separator (comma ↔ dot) and adds or removes the WEBVTT header.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label>Target format</Label>
            <Select value={target} onValueChange={(v) => setTarget(v as SubtitleFormat)}>
              <SelectTrigger className="min-h-11 w-44" aria-label="Target format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="srt">SRT (SubRip)</SelectItem>
                <SelectItem value="vtt">VTT (WebVTT)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={convert} className="min-h-11">Convert</Button>
          <Button variant="outline" onClick={download} disabled={!output} className="min-h-11">
            <Download className="h-4 w-4 mr-2" aria-hidden /> Download .{target}
          </Button>
        </div>
        {output ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Preview (first {Math.min(20, previewLines.length)} of {previewLines.length} lines)
            </p>
            <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap scrollbar-slim">
              {previewLines.slice(0, 20).join('\n')}
              {previewLines.length > 20 ? '\n…' : ''}
            </pre>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Click Convert to generate the output preview.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Extract from video panel
// ---------------------------------------------------------------------------

function ExtractPanel({
  onLoadedIntoEditor,
}: {
  onLoadedIntoEditor: (parsed: ParseResult, name?: string) => boolean;
}) {
  const [video, setVideo] = useState<MediaFileRecord | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [resultFile, setResultFile] = useState<MediaFileRecord | null>(null);

  const doExtract = async (fileId: string, index?: number) => {
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await extractSubtitles(fileId, index);
      setTracks(res.availableTracks);
      setResultFile(res.file);
      toast.success(`Extracted a subtitle track (${res.availableTracks.length} available).`);
    } catch (err) {
      setTracks([]);
      setResultFile(null);
      const msg = err instanceof Error ? err.message : 'Subtitle extraction failed.';
      setExtractError(msg);
      toast.error(msg);
    } finally {
      setExtracting(false);
    }
  };

  const loadIntoEditor = async () => {
    if (!resultFile) return;
    try {
      const res = await fetch(fileUrl(resultFile.id));
      if (!res.ok) throw new Error(`Could not read the subtitle file (${res.status}).`);
      const text = await res.text();
      const parsed = parseSubtitles(text);
      if (!parsed.cues.length) throw new Error('The extracted subtitle file contains no cues.');
      onLoadedIntoEditor(parsed, resultFile.originalName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the subtitles into the editor.');
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base sm:text-lg">Extract embedded subtitles</CardTitle>
          <CardDescription>
            Pulls subtitle streams out of a video with ffmpeg. If the video has no embedded subtitle tracks, the server
            will tell you honestly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Dropzone
            category="video"
            compact={!!video}
            label="Drop a video file here"
            hint="MKV and MP4 files most commonly carry subtitle tracks"
            onUploaded={(record) => {
              setVideo(record);
              setResultFile(null);
              setTracks([]);
              setExtractError(null);
              void doExtract(record.id);
            }}
          />
          {video && <UploadedFileCard file={video} onRemove={() => { setVideo(null); setResultFile(null); setTracks([]); setExtractError(null); }} />}
          {extracting && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Extracting subtitle streams…
            </p>
          )}
          {extractError && (
            <Alert variant="destructive">
              <AlertDescription>{extractError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {tracks.length > 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-lg">Available tracks</CardTitle>
            <CardDescription>
              {tracks.length} subtitle track{tracks.length === 1 ? '' : 's'} found.
              {tracks.length > 1 && ' Extract a specific one below.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {tracks.map((t) => (
              <div key={t.index} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0 text-sm">
                  <span className="font-medium">Track {t.index}</span>
                  <span className="text-muted-foreground"> · {t.codec} · language: {t.language || 'unknown'}</span>
                </div>
                {tracks.length > 1 && (
                  <Button variant="outline" size="sm" className="min-h-9" disabled={extracting} onClick={() => video && void doExtract(video.id, t.index)}>
                    Extract this track
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {resultFile && (
        <div className="flex flex-col gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{resultFile.originalName}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(resultFile.sizeBytes)} · subtitle file</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => void loadIntoEditor()}>
              <Timer className="h-4 w-4 mr-1.5" aria-hidden /> Load into editor
            </Button>
            <Button asChild size="sm" className="min-h-11">
              <a href={fileUrl(resultFile.id)} download>
                <Download className="h-4 w-4 mr-2" aria-hidden /> Download
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
