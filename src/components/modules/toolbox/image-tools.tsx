'use client';

import { useRef, useState } from 'react';
import {
  Crop, Download, Image as ImageIcon, Loader2, Maximize2, Proportions,
  RefreshCcw, Replace, SlidersHorizontal, Sparkles, Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Dropzone } from '@/components/shared/dropzone';
import { fileUrl, formatBytes, processImage } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import type { ImageOps, MediaFileRecord } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CropBox, fitRectToAspect, rectToSourcePixels, type NormRect } from './crop-box';
import { extensionOf, stripExtension } from './srt';

type ImageTab = 'convert' | 'compress' | 'resize' | 'crop' | 'rotate' | 'effects';
type ConvertFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'tiff';
type AspectPreset = 'free' | '1:1' | '16:9' | '9:16' | '4:5';

const ASPECT_VALUES: Record<Exclude<AspectPreset, 'free'>, number> = {
  '1:1': 1,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:5': 4 / 5,
};

const CONVERT_FORMATS: Array<{ value: ConvertFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'tiff', label: 'TIFF' },
];

const RESIZE_PRESETS = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '720p', width: 1280, height: 720 },
  { label: '480p', width: 854, height: 480 },
  { label: 'Square 1080', width: 1080, height: 1080 },
];

interface Dimension {
  w: number;
  h: number;
}

interface ProcessResult {
  file: MediaFileRecord;
  originalSize: number;
}

export function ImageToolsModule() {
  const [file, setFile] = useState<MediaFileRecord | null>(null);
  // page.tsx keys this module by payload.tool — read (not consume) the payload here so the
  // preselected tab survives; navigate() overwrites the payload on every navigation anyway.
  const [tab, setTab] = useState<ImageTab>(() => {
    const t = useAppStore.getState().payload?.tool ?? '';
    if (t.includes('crop')) return 'crop';
    if (t.includes('resize')) return 'resize';
    if (t.includes('compress')) return 'compress';
    if (t.includes('rotate') || t.includes('flip')) return 'rotate';
    if (t.includes('grayscale') || t.includes('effect')) return 'effects';
    return 'convert';
  });

  // Convert
  const [format, setFormat] = useState<ConvertFormat>('webp');
  // Compress
  const [quality, setQuality] = useState(80);
  const [compressFormat, setCompressFormat] = useState<'keep' | 'webp' | 'jpeg'>('keep');
  // Resize
  const [resizeW, setResizeW] = useState(1920);
  const [resizeH, setResizeH] = useState(1080);
  const [resizeFit, setResizeFit] = useState<'cover' | 'contain' | 'fill' | 'inside' | 'outside'>('cover');
  // Crop
  const [cropRect, setCropRect] = useState<NormRect>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [aspect, setAspect] = useState<AspectPreset>('free');
  // Rotate & flip
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(90);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  // Effects
  const [grayscale, setGrayscale] = useState(false);

  const [result, setResult] = useState<ProcessResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [imgDims, setImgDims] = useState<Dimension | null>(null);

  // Keep the actual uploaded bytes around so processing always restarts from the original.
  const blobCache = useRef<Map<string, Blob>>(new Map());
  const previewRef = useRef<HTMLImageElement>(null);

  const dims: Dimension | null =
    file?.meta && file.meta.width > 0 ? { w: file.meta.width, h: file.meta.height } : imgDims;

  const onUploaded = (record: MediaFileRecord) => {
    setFile(record);
    setResult(null);
    setError(null);
    setPreviewFailed(false);
    setImgDims(null);
    setCropRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    toast.success(`Loaded ${record.originalName}`);
  };

  const replaceImage = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setImgDims(null);
  };

  async function getSourceBlob(record: MediaFileRecord): Promise<Blob> {
    const cached = blobCache.current.get(record.id);
    if (cached) return cached;
    const res = await fetch(fileUrl(record.id));
    if (!res.ok) throw new Error('Could not read the uploaded image from the server.');
    const blob = await res.blob();
    blobCache.current.set(record.id, blob);
    return blob;
  }

  function buildOps(): { ops: ImageOps; suffix: string; ext?: string } {
    switch (tab) {
      case 'convert':
        return { ops: { format }, suffix: '', ext: format === 'jpeg' ? 'jpg' : format };
      case 'compress':
        return {
          ops: { quality, ...(compressFormat !== 'keep' ? { format: compressFormat } : {}) },
          suffix: '-compressed',
        };
      case 'resize':
        return { ops: { resize: { width: resizeW, height: resizeH, fit: resizeFit } }, suffix: `-${resizeW}x${resizeH}` };
      case 'crop': {
        if (!dims) throw new Error('Image dimensions are unavailable, cropping is disabled.');
        return { ops: { crop: rectToSourcePixels(cropRect, dims.w, dims.h) }, suffix: '-cropped' };
      }
      case 'rotate':
        return {
          ops: {
            ...(rotate > 0 ? { rotate } : {}),
            ...(flipH ? { flipH: true } : {}),
            ...(flipV ? { flipV: true } : {}),
          },
          suffix: '-rotated',
        };
      case 'effects':
        return { ops: { grayscale: true }, suffix: '-edited' };
    }
  }

  const process = async () => {
    if (!file) return;
    setError(null);
    if (tab === 'resize' && (!Number.isFinite(resizeW) || !Number.isFinite(resizeH) || resizeW < 1 || resizeH < 1)) {
      const msg = 'Enter a valid width and height in pixels.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (tab === 'rotate' && rotate === 0 && !flipH && !flipV) {
      const msg = 'Choose a rotation angle or enable a flip first.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (tab === 'crop' && !dims) {
      const msg = 'Image dimensions are unknown, cropping is unavailable for this file.';
      setError(msg);
      toast.error(msg);
      return;
    }

    setBusy(true);
    try {
      const blob = await getSourceBlob(file);
      const { ops, suffix, ext } = buildOps();
      const name = `${stripExtension(file.originalName)}${suffix}.${(ext ?? (extensionOf(file.originalName) || 'png')).replace('jpeg', 'jpg')}`;
      const res = await processImage(blob, name, ops);
      setResult({ file: res.file, originalSize: res.originalSize ?? file.sizeBytes });
      setPreviewFailed(false);
      toast.success('Image processed.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Image processing failed.';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const applyAspectPreset = (preset: AspectPreset) => {
    setAspect(preset);
    if (preset !== 'free' && dims) {
      const norm = ASPECT_VALUES[preset] * (dims.h / dims.w);
      setCropRect((r) => fitRectToAspect(r, norm));
    }
  };

  const sizePct = result && result.originalSize > 0
    ? Math.round((1 - result.file.sizeBytes / result.originalSize) * 100)
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Image Tools</h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          Convert, compress, resize, crop and enhance images — processed server-side with real pixel output.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------ Source panel */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base sm:text-lg">Source image</CardTitle>
                <CardDescription className="truncate">
                  {file ? file.originalName : 'No image loaded yet'}
                </CardDescription>
              </div>
              {file && (
                <Button variant="outline" size="sm" onClick={replaceImage}>
                  <Replace className="h-4 w-4 mr-1.5" aria-hidden /> Replace
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!file ? (
              <Dropzone category="image" onUploaded={onUploaded} label="Drop an image here or click to browse" hint="PNG, JPEG, WebP, AVIF, TIFF, GIF · max 250 MB" />
            ) : (
              <>
                {tab === 'crop' && dims ? (
                  <CropBox
                    src={fileUrl(file.id, true)}
                    naturalWidth={dims.w}
                    naturalHeight={dims.h}
                    rect={cropRect}
                    aspect={aspect === 'free' ? null : ASPECT_VALUES[aspect]}
                    onChange={setCropRect}
                    onNatural={(w, h) => setImgDims((prev) => (prev ? prev : { w, h }))}
                  />
                ) : (
                  <img
                    ref={previewRef}
                    src={fileUrl(file.id, true)}
                    alt={`Preview of ${file.originalName}`}
                    onLoad={() => {
                      const el = previewRef.current;
                      if (el && el.naturalWidth > 0) setImgDims((prev) => (prev ? prev : { w: el.naturalWidth, h: el.naturalHeight }));
                    }}
                    className="mx-auto max-h-[420px] w-auto max-w-full rounded-lg border bg-muted object-contain"
                  />
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>{formatBytes(file.sizeBytes)}</span>
                  {dims && (
                    <span>
                      {dims.w} × {dims.h} px
                    </span>
                  )}
                  <span className="uppercase">{extensionOf(file.originalName) || file.mime.replace('image/', '')}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------ Tool panel */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-lg">Tool</CardTitle>
            <CardDescription>Operations always start from the original image.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as ImageTab)}>
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60">
                <TabsTrigger value="convert" className="gap-1.5">
                  <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> Convert
                </TabsTrigger>
                <TabsTrigger value="compress" className="gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Compress
                </TabsTrigger>
                <TabsTrigger value="resize" className="gap-1.5">
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden /> Resize
                </TabsTrigger>
                <TabsTrigger value="crop" className="gap-1.5">
                  <Crop className="h-3.5 w-3.5" aria-hidden /> Crop
                </TabsTrigger>
                <TabsTrigger value="rotate" className="gap-1.5">
                  <Proportions className="h-3.5 w-3.5" aria-hidden /> Rotate &amp; Flip
                </TabsTrigger>
                <TabsTrigger value="effects" className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> Effects
                </TabsTrigger>
              </TabsList>

              {/* Convert */}
              <TabsContent value="convert" className="mt-4 space-y-4">
                <p className="text-sm text-muted-foreground">Transcode the image into another format losslessly where supported.</p>
                <RadioGroup value={format} onValueChange={(v) => setFormat(v as ConvertFormat)} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {CONVERT_FORMATS.map((f) => (
                    <Label
                      key={f.value}
                      htmlFor={`fmt-${f.value}`}
                      className={cn(
                        'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border p-3 font-normal transition-colors hover:bg-muted/50',
                        format === f.value && 'border-primary bg-primary/5'
                      )}
                    >
                      <RadioGroupItem value={f.value} id={`fmt-${f.value}`} />
                      <span className="text-sm font-medium">{f.label}</span>
                    </Label>
                  ))}
                </RadioGroup>
              </TabsContent>

              {/* Compress */}
              <TabsContent value="compress" className="mt-4 space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="quality">Quality</Label>
                    <span className="text-sm font-medium tabular-nums">{quality}</span>
                  </div>
                  <Slider min={1} max={100} step={1} value={[quality]} onValueChange={([v]) => setQuality(v)} aria-label="Compression quality" />
                  <p className="text-xs text-muted-foreground">Lower quality means smaller files. Applies to lossy formats.</p>
                </div>
                <div className="space-y-2">
                  <Label>Output format</Label>
                  <Select value={compressFormat} onValueChange={(v) => setCompressFormat(v as 'keep' | 'webp' | 'jpeg')}>
                    <SelectTrigger className="min-h-11 w-full" aria-label="Output format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep">Keep original format</SelectItem>
                      <SelectItem value="webp">Convert to WebP (best compression)</SelectItem>
                      <SelectItem value="jpeg">Convert to JPEG</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">After processing you will see the original and result size side by side.</p>
              </TabsContent>

              {/* Resize */}
              <TabsContent value="resize" className="mt-4 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="resize-w">Width (px)</Label>
                    <Input id="resize-w" type="number" min={1} step={1} value={resizeW} onChange={(e) => setResizeW(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="resize-h">Height (px)</Label>
                    <Input id="resize-h" type="number" min={1} step={1} value={resizeH} onChange={(e) => setResizeH(Number(e.target.value))} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {RESIZE_PRESETS.map((p) => (
                    <Button
                      key={p.label}
                      type="button"
                      variant={resizeW === p.width && resizeH === p.height ? 'default' : 'outline'}
                      size="sm"
                      className="min-h-9"
                      onClick={() => {
                        setResizeW(p.width);
                        setResizeH(p.height);
                      }}
                    >
                      {p.label} · {p.width}×{p.height}
                    </Button>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label>Fit mode</Label>
                  <Select value={resizeFit} onValueChange={(v) => setResizeFit(v as typeof resizeFit)}>
                    <SelectTrigger className="min-h-11 w-full" aria-label="Fit mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cover">Cover — fill the box, crop the overflow</SelectItem>
                      <SelectItem value="contain">Contain — fit inside, letterbox with padding</SelectItem>
                      <SelectItem value="fill">Fill — stretch to the box, distorts</SelectItem>
                      <SelectItem value="inside">Inside — shrink only, never upscale</SelectItem>
                      <SelectItem value="outside">Outside — cover and extend beyond</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              {/* Crop */}
              <TabsContent value="crop" className="mt-4 space-y-4">
                {!file && <p className="text-sm text-muted-foreground">Load an image first — the crop box appears over the preview.</p>}
                {file && !dims && (
                  <Alert>
                    <AlertDescription>Image dimensions are unknown for this file, so precise cropping is unavailable.</AlertDescription>
                  </Alert>
                )}
                {file && dims && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground mr-1">Aspect lock:</span>
                      {(['free', '1:1', '16:9', '9:16', '4:5'] as AspectPreset[]).map((p) => (
                        <Button
                          key={p}
                          type="button"
                          size="sm"
                          variant={aspect === p ? 'default' : 'outline'}
                          className="min-h-9"
                          onClick={() => applyAspectPreset(p)}
                        >
                          {p === 'free' ? 'Free' : p}
                        </Button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-xs sm:grid-cols-4">
                      <div>
                        <span className="block text-muted-foreground font-sans">Left</span>
                        {rectToSourcePixels(cropRect, dims.w, dims.h).left} px
                      </div>
                      <div>
                        <span className="block text-muted-foreground font-sans">Top</span>
                        {rectToSourcePixels(cropRect, dims.w, dims.h).top} px
                      </div>
                      <div>
                        <span className="block text-muted-foreground font-sans">Width</span>
                        {rectToSourcePixels(cropRect, dims.w, dims.h).width} px
                      </div>
                      <div>
                        <span className="block text-muted-foreground font-sans">Height</span>
                        {rectToSourcePixels(cropRect, dims.w, dims.h).height} px
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Drag inside the box to move it, drag corners or edges to resize. Values are in source pixels.</p>
                  </>
                )}
              </TabsContent>

              {/* Rotate & Flip */}
              <TabsContent value="rotate" className="mt-4 space-y-5">
                <div className="space-y-2">
                  <Label>Rotation</Label>
                  <div className="flex flex-wrap gap-2">
                    {([0, 90, 180, 270] as const).map((deg) => (
                      <Button
                        key={deg}
                        type="button"
                        size="sm"
                        className="min-h-11 min-w-14"
                        variant={rotate === deg ? 'default' : 'outline'}
                        onClick={() => setRotate(deg)}
                        aria-pressed={rotate === deg}
                        aria-label={deg === 0 ? 'No rotation' : `Rotate ${deg} degrees clockwise`}
                      >
                        {deg === 0 ? 'None' : `${deg}°`}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">90° = quarter turn clockwise, 270° = 90° counter-clockwise.</p>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="flip-h">Flip horizontal</Label>
                    <p className="text-xs text-muted-foreground">Mirror left to right</p>
                  </div>
                  <Switch id="flip-h" checked={flipH} onCheckedChange={setFlipH} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="flip-v">Flip vertical</Label>
                    <p className="text-xs text-muted-foreground">Mirror top to bottom</p>
                  </div>
                  <Switch id="flip-v" checked={flipV} onCheckedChange={setFlipV} />
                </div>
              </TabsContent>

              {/* Effects */}
              <TabsContent value="effects" className="mt-4 space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="grayscale">Grayscale</Label>
                    <p className="text-xs text-muted-foreground">Desaturate the image to black and white</p>
                  </div>
                  <Switch id="grayscale" checked={grayscale} onCheckedChange={setGrayscale} />
                </div>
                {!grayscale && (
                  <p className="text-xs text-muted-foreground">Enable at least one effect before processing.</p>
                )}
              </TabsContent>
            </Tabs>

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button onClick={process} disabled={!file || busy} className="mt-5 h-11 w-full" size="lg">
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Wand2 className="h-4 w-4 mr-2" aria-hidden />}
              {busy ? 'Processing…' : 'Process image'}
            </Button>
            {!file && <p className="mt-2 text-center text-xs text-muted-foreground">Load an image on the left to enable processing.</p>}
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------ Result */}
      {result && (
        <Card className="mt-6">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base sm:text-lg">Result</CardTitle>
                <CardDescription className="truncate">{result.file.originalName}</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setResult(null)}>
                Process another
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-start">
              {!previewFailed ? (
                <img
                  src={fileUrl(result.file.id, true)}
                  alt={`Processed result ${result.file.originalName}`}
                  onError={() => setPreviewFailed(true)}
                  className="max-h-72 w-full rounded-lg border bg-muted object-contain"
                />
              ) : (
                <div className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border bg-muted text-muted-foreground">
                  <ImageIcon className="h-8 w-8" aria-hidden />
                  <span className="text-xs">Preview unavailable — download to view</span>
                </div>
              )}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Original</span>
                  <span className="font-medium">{formatBytes(result.originalSize)}</span>
                  <span className="text-muted-foreground">→ Result</span>
                  <span className="font-medium">{formatBytes(result.file.sizeBytes)}</span>
                  {sizePct != null && sizePct > 0 && (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      {sizePct}% smaller
                    </Badge>
                  )}
                  {sizePct != null && sizePct < 0 && (
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      {Math.abs(sizePct)}% larger
                    </Badge>
                  )}
                </div>
                {result.file.meta && result.file.meta.width > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Output dimensions: {result.file.meta.width} × {result.file.meta.height} px
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild className="min-h-11">
                    <a href={fileUrl(result.file.id)} download>
                      <Download className="h-4 w-4 mr-2" aria-hidden /> Download
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
