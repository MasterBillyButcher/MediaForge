'use client';

import { useState } from 'react';
import { Cookie, Settings2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export const VIDEO_FORMATS = ['mp4', 'webm', 'mkv', 'mov'] as const;
export const AUDIO_FORMATS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'] as const;
export type PFormat = (typeof VIDEO_FORMATS)[number] | (typeof AUDIO_FORMATS)[number];

export const QUALITIES = [
  { value: 'best', label: 'Best available' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1440', label: '1440p (2K)' },
  { value: '1080', label: '1080p (Full HD)' },
  { value: '720', label: '720p (HD)' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: '240', label: '240p' },
  { value: '144', label: '144p' },
] as const;

export const BITRATES = [
  { value: 'best', label: 'Best available' },
  { value: '320', label: '320 kbps' },
  { value: '256', label: '256 kbps' },
  { value: '192', label: '192 kbps' },
  { value: '128', label: '128 kbps' },
  { value: '96', label: '96 kbps' },
] as const;

const FORMAT_LABELS: Record<PFormat, string> = {
  mp4: 'MP4', webm: 'WebM', mkv: 'MKV', mov: 'MOV',
  mp3: 'MP3', m4a: 'M4A', aac: 'AAC', wav: 'WAV', flac: 'FLAC', ogg: 'OGG', opus: 'Opus',
};

const FORMAT_HINTS: Record<PFormat, string> = {
  mp4: 'H.264 + AAC — plays everywhere',
  webm: 'VP9 + Opus — efficient, open',
  mkv: 'Any codec, flexible container',
  mov: 'QuickTime — Final Cut / macOS',
  mp3: 'Universal audio',
  m4a: 'Apple-friendly AAC audio',
  aac: 'Raw AAC stream',
  wav: 'Uncompressed PCM — lossless',
  flac: 'Lossless compression',
  ogg: 'Vorbis in Ogg container',
  opus: 'Modern low-bitrate audio',
};

interface FormatPickerProps {
  format: PFormat;
  quality: string;
  bitrate: string;
  onFormat: (f: PFormat) => void;
  onQuality: (q: string) => void;
  onBitrate: (b: string) => void;
  cookies: string;
  onCookies: (c: string) => void;
}

export function FormatPicker(props: FormatPickerProps) {
  const { format, quality, bitrate, onFormat, onQuality, onBitrate, cookies, onCookies } = props;
  const isAudio = (AUDIO_FORMATS as readonly string[]).includes(format);
  const [advanced, setAdvanced] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Settings2 className="h-4 w-4 text-primary" aria-hidden /> Output format
        </CardTitle>
        <CardDescription>
          Every download is converted on the server — pick any container or codec combination.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Video formats */}
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Video</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Video formats">
            {VIDEO_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                onClick={() => onFormat(f)}
                title={FORMAT_HINTS[f]}
                className={cn(
                  'rounded-lg border px-4 py-2 text-sm font-semibold transition-all',
                  'min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  format === f
                    ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20'
                    : 'bg-card hover:bg-muted'
                )}
              >
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {/* Audio formats */}
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Audio</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Audio formats">
            {AUDIO_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                onClick={() => onFormat(f)}
                title={FORMAT_HINTS[f]}
                className={cn(
                  'rounded-lg border px-4 py-2 text-sm font-semibold transition-all',
                  'min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  format === f
                    ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20'
                    : 'bg-card hover:bg-muted'
                )}
              >
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{FORMAT_HINTS[format]}</p>
        </div>

        {/* Quality / bitrate */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pl-quality" className="text-sm">
              {isAudio ? 'Quality preset' : 'Video quality'}
            </Label>
            <select
              id="pl-quality"
              value={isAudio ? bitrate : quality}
              onChange={(e) => (isAudio ? onBitrate(e.target.value) : onQuality(e.target.value))}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {(isAudio ? BITRATES : QUALITIES).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isAudio
                ? 'Bitrate applies to lossy formats; WAV and FLAC are always lossless.'
                : 'Quality caps the resolution. If a source lacks that height, the closest available is used — nothing is upscaled.'}
            </p>
          </div>
        </div>

        {/* Advanced: authorized cookies */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Cookie className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-medium">Authorized access (cookies)</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Platforms like YouTube or Vimeo block cloud IPs for anonymous downloads. Paste your own
                  cookies.txt (Netscape format) to use <em>your</em> authorized session — e.g. to download
                  playlists you own or have rights to. Cookies are kept in server memory for this job only
                  and deleted afterwards.
                </p>
              </div>
            </div>
            <Switch
              checked={advanced}
              onCheckedChange={setAdvanced}
              aria-label="Toggle cookies input"
            />
          </div>
          {advanced && (
            <div className="mt-3 space-y-2">
              <Label htmlFor="pl-cookies" className="text-xs">
                cookies.txt contents (Netscape format)
              </Label>
              <Textarea
                id="pl-cookies"
                rows={5}
                spellCheck={false}
                placeholder={'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tKEY\tvalue\n...'}
                className="min-h-24 font-mono text-xs"
                value={cookies}
                onChange={(e) => onCookies(e.target.value)}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
