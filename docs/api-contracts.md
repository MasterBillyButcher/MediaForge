# MediaForge — Module Development Contracts

This document is the single source of truth for frontend modules. Read it fully before writing code.

## Stack & conventions

- Next.js 16 App Router, TypeScript, Tailwind CSS 4, shadcn/ui (New York) — components in `src/components/ui/*` (button, card, input, select, tabs, slider, switch, progress, dialog, dropdown-menu, badge, separator, textarea, checkbox, radio-group, label, alert, skeleton, tooltip, popover, sheet, scroll-area, accordion, table...). Lucide icons via `lucide-react`.
- Every module component is a CLIENT component (`'use client'` at top).
- All UI text in English. No emojis in code. No blue/indigo color scheme — use existing CSS vars (`primary`, `accent`, `muted`...), violet accent is configured.
- Use `sonner` for toasts: `import { toast } from 'sonner'` — `toast.success(...)`, `toast.error(...)`.
- Responsive: mobile-first, grids collapse to 1 column, min touch target 44px.
- Long lists: `max-h-96 overflow-y-auto scrollbar-slim`.
- NEVER call `z-ai-web-dev-sdk` in frontend. NEVER use absolute fetch URLs — always relative paths.

## Navigation

```ts
import { useAppStore } from '@/lib/store';
const navigate = useAppStore((s) => s.navigate);
navigate('converter', { url?: string, tool?: string, fileId?: string, fileName?: string });
// ViewId: 'home' | 'downloader' | 'universal' | 'converter' | 'audio-converter'
//       | 'editor' | 'image-tools' | 'audio-tools' | 'subtitle-tools' | 'files' | 'settings'
```

## API client — `@/lib/api-client` (already implemented, use it, do not re-implement)

```ts
import {
  uploadFile, getJob, cancelJob, pollJob, resultDownloadUrl,
  startConvert, startTool, startEdlRender, processImage,
  probeUrl, downloadUrl, saveBlob,
  fetchHistory, deleteHistory, fetchFiles, deleteFile,
  extractSubtitles, cleanupStorage,
  fileUrl, formatBytes, formatDuration,
  ApiError,
} from '@/lib/api-client';

// uploadFile(file: File, onProgress?: (percent, speedMbps|null) => void, signal?: AbortSignal)
//   -> Promise<{ file: MediaFileRecord }>   // server probes metadata

// startConvert(fileId, settings: ConvertSettings) -> Promise<JobSnapshot>
// startTool(op: string, params: object) -> Promise<JobSnapshot>
// startEdlRender(edl: Edl, format: 'mp4'|'webm'|'mov'|'mkv', projectName?) -> Promise<JobSnapshot>

// pollJob(id, (job: JobSnapshot) => void, intervalMs=700) -> { stop() }
//   job.state: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
//   job.progress: 0..100 (REAL ffmpeg progress), job.speed ('2.4x'), job.etaSeconds
//   job.error: string | null;  job.result: { fileId, name, sizeBytes, mime } | null

// resultDownloadUrl(jobId) -> href for <a download>
// fileUrl(fileId, inline?) -> href to stored file (preview with ?inline=1)

// probeUrl(url) -> UrlProbeResult { ok, direct, platform, contentType?, sizeBytes?, fileName?, mediaCategory?, note?, error? }
// downloadUrl(url, onProgress, signal) -> { blob, fileName, category }  (real streaming progress; then saveBlob(blob, fileName))

// processImage(file: File|Blob, fileName, ops: ImageOps) -> { file: MediaFileRecord, originalSize }
// extractSubtitles(fileId, index?) -> { file, availableTracks }
// fetchHistory() / deleteHistory(id?) / fetchFiles(kind?) / deleteFile(id) / cleanupStorage()
```

## Key types — `@/lib/types`

```ts
interface MediaFileRecord { id, kind: 'upload'|'result'|'download', originalName, sizeBytes, mime, meta: ProbeResult|null, operation?, sourceUrl?, sourceType?, createdAt, expiresAt }
interface ProbeResult { duration, width, height, fps, videoCodec, audioCodec, hasVideo, hasAudio, bitrate, sizeBytes, format }

interface ConvertSettings {
  format: 'mp4'|'webm'|'mov'|'mkv'|'gif' | 'mp3'|'wav'|'m4a'|'aac'|'flac'|'ogg';
  resolution?: 'original'|'2160p'|'1440p'|'1080p'|'720p'|'480p'|'360p'|'240p'|'144p';
  fps?: 'original'|12|15|24|25|30|50|60;
  videoBitrateKbps?: number|null; audioBitrateKbps?: number|null;
  audioSampleRate?: 'original'|44100|48000|22050|16000;
  quality?: 'high'|'balanced'|'compressed';
  mode?: 'convert'|'extract-audio'|'remove-audio'|'compress';
  trimStart?: number; trimEnd?: number; normalizeAudio?: boolean;
}

interface ImageOps {
  rotate?: 0|90|180|270; flipH?: boolean; flipV?: boolean;
  crop?: { left, top, width, height };  // SOURCE pixel coords
  grayscale?: boolean;
  resize?: { width?, height?, fit?: 'cover'|'contain'|'fill'|'inside'|'outside', background? };
  format?: 'png'|'jpeg'|'webp'|'avif'|'tiff'|'gif'; quality?: number; // 1..100
}
```

## Tool ops — `startTool(op, params)` (ALL REAL, server ffmpeg)

ops: `video-trim` `{fileIds:[id], start, end}` · `video-resize` `{fileIds, width, height, fit:'cover'|'contain'|'fill'}` · `video-rotate` `{fileIds, angle:90|180|270, direction:'clockwise'|'counterclockwise'}` · `video-flip` `{fileIds, flipH?|flipV?}` · `video-crop` `{fileIds, crop:{x,y,w,h}}` (normalized 0..1) · `video-speed` `{fileIds, speed:0.25..4}` · `video-reverse` `{fileIds}` (max 120s) · `video-mute` `{fileIds}` · `video-compress` `{fileIds, bitrateKbps?}` · `video-watermark` `{fileIds, watermark:{type:'text'|'image', text?, size? (0.02..0.4 of height), x?, y? (0..1), color?, opacity?, fileId? (image), scale? (image width rel.)}}` · `gif-maker` `{fileIds, start, end, fps:5..20, gifWidth:120..640}` (max 30s) · `video-thumbnail` `{fileIds, time}` → synchronous: returns `{ job }` but server returns PNG directly? NO — see below · `audio-cut` `{fileIds, start, end}` · `audio-convert` `{fileIds, format:'mp3'|'wav'|'m4a'|'aac'|'flac'|'ogg', bitrateKbps?}` · `audio-compress` `{fileIds, bitrateKbps?}` (loudnorm) · `audio-volume` `{fileIds, gainDb:-30..4}` (volume change in dB) · `audio-speed` `{fileIds, speed}` · `audio-extract` `{fileIds, format}` · `video-merge` `{fileIds:[...2..10]}` · `audio-merge` `{fileIds:[...2..10]}`

**IMPORTANT exception**: `video-thumbnail` is SYNCHRONOUS. `startTool` will fail parsing it — instead call it and handle: the server responds `422 { error }` if... Actually: for `video-thumbnail` the server returns the PNG bytes directly with 200. `startTool` tries to parse JSON and will throw. For thumbnails use fetch directly:
```ts
const res = await fetch('/api/media/tool', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ op:'video-thumbnail', params:{ fileIds:[fileId], time } }) });
if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
const blob = await res.blob(); // image/png, show in <img src=URL.createObjectURL(blob)>
```

`subtitle-extract` is NOT in startTool: use `extractSubtitles(fileId, index?)`.

## Editor EDL — `startEdlRender(edl, format, projectName)` (server renders with ffmpeg)

```ts
interface Edl {
  width: number; height: number; fps: number; background: string; // '#000000'
  clips: Array<{
    fileId: string; in: number; out: number; // seconds in SOURCE
    speed: number; // 0.25..4
    volume: number; // 0..2, use 0 to mute
    crop?: { x, y, w, h };        // normalized 0..1
    rotate?: 0|90|180|270; flipH?: boolean; flipV?: boolean;
    filters?: { brightness?: number; contrast?: number; saturation?: number; blur?: number; sharpen?: number; grayscale?: boolean; sepia?: boolean };
    fadeIn?: number; fadeOut?: number; // seconds (video+audio fades)
  }>;
  audioTracks: Array<{ fileId, start, volume, fadeIn?, fadeOut? }>; // bg music / voiceover
  texts: Array<{ text, start, end, x, y, size (px), color ('#ffffff'), font?: 'sans'|'sans-bold'|'mono'|'serif'|'serif-bold', bgColor?: string|null, outline?, shadow?, animation?: 'none'|'fade'|'slide-up' }>;
  overlays: Array<{ fileId, start, end, x, y, scale (width rel. 0..1), opacity }>; // image overlays/watermark
}
```
Limits: max 20 clips, 6 audio tracks, 40 texts. All effects are genuinely applied.

## UX requirements

- Show real upload progress (Dropzone already does).
- Show real processing progress via `pollJob` (JobProgress component already does).
- Allow cancel during processing. Allow retry after failure (re-submit same settings).
- Honest errors: surface `job.error` / `ApiError.message` in the UI (toast + inline).
- Never show a fake progress bar or fake format. Only list formats the server supports (listed above).
- Downloads: `<a href={resultDownloadUrl(jobId)} download>` or `saveBlob(blob, name)`.

## Reusable components you MUST use (already implemented)

```tsx
import { Dropzone, UploadedFileCard, categoryIcon, formatDurationClient } from '@/components/shared/dropzone';
import { JobProgress, ResultCard } from '@/components/shared/job-progress';
import { ToolCard, SectionHeading } from '@/components/shared/tool-card';
```

- `Dropzone { category?: 'video'|'audio'|'image'|'subtitle'|'any', multiple?, label?, hint?, compact?, onUploaded(file: MediaFileRecord) }`
- `JobProgress { jobId, label?, onComplete?, hideResult?, compact? }` — full polling UI with cancel + download.
