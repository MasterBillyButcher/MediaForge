'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, X, Loader2, FileVideo, FileAudio, FileImage, FileText, File as FileIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { uploadFile, formatBytes, fileUrl } from '@/lib/api-client';
import type { MediaFileRecord } from '@/lib/types';
import { cn } from '@/lib/utils';

export type FileCategory = 'video' | 'audio' | 'image' | 'subtitle' | 'any';

const ACCEPT_MAP: Record<FileCategory, string> = {
  video: 'video/*,.mp4,.webm,.mov,.mkv,.avi,.gif,.m4v,.ogv,.3gp,.flv,.wmv,.ts,.mpg,.mpeg',
  audio: 'audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.wma,.amr,.aiff',
  image: 'image/*,.png,.jpg,.jpeg,.webp,.avif,.bmp,.tiff,.tif,.gif',
  subtitle: '.srt,.vtt,.ass,text/plain',
  any: 'video/*,audio/*,image/*,.srt,.vtt,.ass',
};

export function categoryIcon(mime: string, name?: string) {
  const n = (name ?? '').toLowerCase();
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/.test(n)) return FileVideo;
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/.test(n)) return FileAudio;
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/.test(n)) return FileImage;
  if (/\.(srt|vtt|ass)$/.test(n) || mime.includes('subrip') || mime === 'text/vtt') return FileText;
  return FileIcon;
}

/** Rendered icon component (declared outside render paths to satisfy react-hooks rules). */
export function CategoryIcon({ mime, name, className }: { mime: string; name?: string; className?: string }) {
  const kind = ((): 'video' | 'audio' | 'image' | 'subtitle' | 'file' => {
    const n = (name ?? '').toLowerCase();
    if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/.test(n)) return 'video';
    if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/.test(n)) return 'audio';
    if (mime.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/.test(n)) return 'image';
    if (/\.(srt|vtt|ass)$/.test(n) || mime.includes('subrip') || mime === 'text/vtt') return 'subtitle';
    return 'file';
  })();
  const cls = className ?? 'h-6 w-6 text-primary';
  if (kind === 'video') return <FileVideo className={cls} aria-hidden />;
  if (kind === 'audio') return <FileAudio className={cls} aria-hidden />;
  if (kind === 'image') return <FileImage className={cls} aria-hidden />;
  if (kind === 'subtitle') return <FileText className={cls} aria-hidden />;
  return <FileIcon className={cls} aria-hidden />;
}

export interface DropzoneProps {
  category?: FileCategory;
  multiple?: boolean;
  label?: string;
  hint?: string;
  className?: string;
  /** called per file once fully uploaded */
  onUploaded: (file: MediaFileRecord) => void;
  compact?: boolean;
}

/**
 * Drag-and-drop upload zone with real upload progress.
 * Emits MediaFileRecord (server-probed) for each uploaded file.
 */
export function Dropzone({ category = 'any', multiple = false, label, hint, className, onUploaded, compact }: DropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(0); // number of files uploading
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setError(null);
      setBusy(list.length);
      setProgress(0);
      let done = 0;
      for (const file of list) {
        try {
          const res = await uploadFile(file, (pct) => {
            const perFile = 100 / list.length;
            setProgress(done * perFile + (pct / list.length));
          });
          onUploadedRef.current(res.file);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Upload failed.');
          break;
        }
        done++;
        setProgress(done * (100 / list.length));
      }
      setBusy(0);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    },
    []
  );

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label={label ?? 'Upload files'}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors text-center select-none',
          compact ? 'p-4' : 'p-8 sm:p-10',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/40',
          busy && 'pointer-events-none opacity-80'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPT_MAP[category]}
          multiple={multiple}
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
          aria-hidden
        />
        {busy > 0 ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm font-medium">Uploading… {Math.round(progress)}%</p>
            <Progress value={progress} className="h-1.5 w-40" />
          </>
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <UploadCloud className="h-6 w-6 text-primary" aria-hidden />
            </span>
            <p className="text-sm sm:text-base font-medium">
              {label ?? (multiple ? 'Drop files here or click to browse' : 'Drop a file here or click to browse')}
            </p>
            <p className="text-xs text-muted-foreground">
              {hint ?? 'Drag & drop or click · max 250 MB per file'}
            </p>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uploaded file card with metadata + preview
// ---------------------------------------------------------------------------

export function UploadedFileCard({ file, onRemove, showPreview = true }: {
  file: MediaFileRecord;
  onRemove?: () => void;
  showPreview?: boolean;
}) {
  const isVideo = file.mime.startsWith('video/');
  const isAudio = file.mime.startsWith('audio/');
  const isImage = file.mime.startsWith('image/');
  const meta = file.meta;

  return (
    <div className="flex gap-3 rounded-xl border bg-card p-3 sm:p-4 items-center">
      {showPreview && isVideo && meta && meta.width > 0 ? (
        <video
          src={fileUrl(file.id, true)}
          className="h-16 w-24 rounded-lg object-cover bg-black shrink-0"
          muted
          preload="metadata"
          aria-label={`Preview of ${file.originalName}`}
        />
      ) : showPreview && isImage ? (
        <img
          src={fileUrl(file.id, true)}
          alt={`Preview of ${file.originalName}`}
          className="h-16 w-24 rounded-lg object-cover shrink-0 bg-muted"
        />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 shrink-0">
          <CategoryIcon mime={file.mime} name={file.originalName} className="h-6 w-6 text-primary" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{file.originalName}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatBytes(file.sizeBytes)}
          {meta && meta.duration > 0 && ` · ${formatDurationClient(meta.duration)}`}
          {meta && meta.width > 0 && ` · ${meta.width}×${meta.height}`}
          {meta && meta.fps > 0 && ` · ${Math.round(meta.fps)}fps`}
          {meta && meta.videoCodec && ` · ${meta.videoCodec}`}
          {meta && meta.audioCodec && ` · ${meta.audioCodec}`}
        </p>
      </div>
      {onRemove && (
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${file.originalName}`}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export function formatDurationClient(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

