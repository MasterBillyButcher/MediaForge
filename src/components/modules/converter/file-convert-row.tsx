'use client';

import {
  AudioLines, File as FileIcon, FileAudio, FileImage, FileVideo, Loader2, Minimize2,
  Play, TriangleAlert, VolumeX, XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { formatBytes, formatDuration } from '@/lib/api-client';
import type { MediaFileRecord } from '@/lib/types';
import type { ConverterMode } from './types';

export type QuickAction = 'extract-audio' | 'remove-audio' | 'compress';

/** Static icon for a file, chosen without creating components during render. */
function FileGlyph({ mime, name, className }: { mime: string; name: string; className?: string }) {
  const n = name.toLowerCase();
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v|ts|mpg|mpeg|flv|wmv)$/.test(n)) {
    return <FileVideo className={className} aria-hidden />;
  }
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|amr|aiff)$/.test(n)) {
    return <FileAudio className={className} aria-hidden />;
  }
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|avif|bmp|tiff?|gif)$/.test(n)) {
    return <FileImage className={className} aria-hidden />;
  }
  return <FileIcon className={className} aria-hidden />;
}

export interface FileConvertRowProps {
  file: MediaFileRecord;
  operation: ConverterMode;
  /** Human readable action, e.g. "Convert to MP4". */
  actionLabel: string;
  warning: string | null;
  error: string | null;
  starting: boolean;
  isVideoMode: boolean;
  onConvert: () => void;
  onQuickAction: (action: QuickAction) => void;
}

/** One conversion row per uploaded file: summary, inline warnings and the convert action. */
export function FileConvertRow({
  file, operation, actionLabel, warning, error, starting, isVideoMode, onConvert, onQuickAction,
}: FileConvertRowProps) {
  const meta = file.meta;

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FileGlyph mime={file.mime} name={file.originalName} className="h-4 w-4 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.originalName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {formatBytes(file.sizeBytes)}
            {meta && meta.duration > 0 && ` · ${formatDuration(meta.duration)}`}
            {meta && meta.width > 0 && ` · ${meta.width}×${meta.height}`}
            {meta && meta.hasAudio === false && ' · no audio'}
            {meta && meta.hasVideo === false && ' · no video'}
          </p>
        </div>
        <Badge variant="secondary" className="max-w-[40%] shrink-0 sm:max-w-none">
          <span className="truncate">{actionLabel}</span>
        </Badge>
      </div>

      {warning && (
        <div
          role="status"
          className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-400"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="text-xs sm:text-sm">{warning}</p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-destructive"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="break-words text-xs sm:text-sm">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {isVideoMode && (
          <>
            <Button
              type="button"
              variant={operation === 'extract-audio' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              aria-pressed={operation === 'extract-audio'}
              aria-label="Switch operation to extract audio as MP3"
              onClick={() => onQuickAction('extract-audio')}
            >
              <AudioLines className="mr-1.5 h-4 w-4" aria-hidden /> Extract audio (MP3)
            </Button>
            <Button
              type="button"
              variant={operation === 'remove-audio' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              aria-pressed={operation === 'remove-audio'}
              aria-label="Switch operation to remove the audio track"
              onClick={() => onQuickAction('remove-audio')}
            >
              <VolumeX className="mr-1.5 h-4 w-4" aria-hidden /> Remove audio
            </Button>
            <Button
              type="button"
              variant={operation === 'compress' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              aria-pressed={operation === 'compress'}
              aria-label="Switch operation to compress"
              onClick={() => onQuickAction('compress')}
            >
              <Minimize2 className="mr-1.5 h-4 w-4" aria-hidden /> Compress
            </Button>
            <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
          </>
        )}
        <Button
          type="button"
          size="sm"
          className="ml-auto min-h-[36px] px-4"
          onClick={onConvert}
          disabled={starting}
          aria-label={`${actionLabel}: ${file.originalName}`}
        >
          {starting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> Starting…
            </>
          ) : (
            <>
              <Play className="mr-1.5 h-4 w-4" aria-hidden /> Convert
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
