'use client';

import { useState } from 'react';
import { Captions, Cookie, Disc3, Gauge, Scissors, Settings2, Sparkles, Terminal } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

export interface ExtrasState {
  sponsorBlock: boolean;
  embedSubs: boolean;
  subtitleLangs: string;
  albumTags: boolean;
  aria2c: boolean;
  extraArgs: string;
}

export const DEFAULT_EXTRAS: ExtrasState = {
  sponsorBlock: false,
  embedSubs: false,
  subtitleLangs: 'en.*',
  albumTags: true,
  aria2c: false,
  extraArgs: '',
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
  extras: ExtrasState;
  onExtras: (patch: Partial<ExtrasState>) => void;
}

export function FormatPicker(props: FormatPickerProps) {
  const { format, quality, bitrate, onFormat, onQuality, onBitrate, cookies, onCookies, extras, onExtras } = props;
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

        {/* Smart options — best ideas from Seal, implemented natively */}
        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-semibold">Smart options</p>
          </div>

          {/* SponsorBlock */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Scissors className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-medium">Skip sponsor segments</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Auto-cuts sponsor reads, self-promos and &quot;like &amp; subscribe&quot;
                  interruptions using the community SponsorBlock database.
                </p>
              </div>
            </div>
            <Switch
              checked={extras.sponsorBlock}
              onCheckedChange={(v) => onExtras({ sponsorBlock: v })}
              aria-label="Skip sponsor segments with SponsorBlock"
            />
          </div>

          {/* Subtitles (video only) */}
          {!isAudio && (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Captions className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="text-sm font-medium">Download &amp; embed subtitles</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      Burned-in no — soft-subbed yes: embedded into MP4/MKV/MOV; WebM keeps sidecar SRT files.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={extras.embedSubs}
                  onCheckedChange={(v) => onExtras({ embedSubs: v })}
                  aria-label="Download and embed subtitles"
                />
              </div>
              {extras.embedSubs && (
                <div className="space-y-1.5 pl-7">
                  <Label htmlFor="pl-subs-langs" className="text-xs">
                    Subtitle languages
                  </Label>
                  <Input
                    id="pl-subs-langs"
                    value={extras.subtitleLangs}
                    onChange={(e) => onExtras({ subtitleLangs: e.target.value })}
                    placeholder="en.*  (or: en,de,fr)"
                    className="h-10 font-mono text-xs"
                  />
                </div>
              )}
            </div>
          )}

          {/* Album tagging (audio only) */}
          {isAudio && (
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Disc3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-sm font-medium">Tag album &amp; track numbers</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Album = playlist title, track = its position, cover art embedded — proper music
                    library metadata for MP3/M4A/FLAC/OGG/Opus.
                  </p>
                </div>
              </div>
              <Switch
                checked={extras.albumTags}
                onCheckedChange={(v) => onExtras({ albumTags: v })}
                aria-label="Tag album and track numbers"
              />
            </div>
          )}

          {/* aria2c */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-medium">Multi-connection downloads (aria2c)</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Up to 8 connections per file — noticeably faster on big videos. Falls back to the
                  standard downloader when aria2c is not installed on the server.
                </p>
              </div>
            </div>
            <Switch
              checked={extras.aria2c}
              onCheckedChange={(v) => onExtras({ aria2c: v })}
              aria-label="Use aria2c multi-connection downloads"
            />
          </div>

          {/* Custom yt-dlp args */}
          <div className="space-y-2">
            <div className="flex items-start gap-2.5">
              <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div className="flex-1">
                <Label htmlFor="pl-extra-args" className="text-sm font-medium">
                  Custom yt-dlp arguments
                </Label>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Appended to every download command — the same escape hatch Seal gives power users.
                  Unsafe characters are ignored.
                </p>
              </div>
            </div>
            <Input
              id="pl-extra-args"
              value={extras.extraArgs}
              onChange={(e) => onExtras({ extraArgs: e.target.value })}
              placeholder="e.g. --restrict-filenames --match-filter duration&lt;600"
              className="h-10 font-mono text-xs"
              spellCheck={false}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
