'use client';

import { Info } from 'lucide-react';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  AUDIO_BITRATE_OPTIONS, FPS_OPTIONS, GIF_RESOLUTION_OPTIONS, QUALITY_OPTIONS,
  RESOLUTION_OPTIONS, SAMPLE_RATE_OPTIONS,
} from './types';
import type {
  ConverterMode, FpsValue, QualityValue, ResolutionValue, SampleRateValue, SettingsState,
} from './types';

interface SettingsPanelProps {
  isVideoMode: boolean;
  operation: ConverterMode;
  isGif: boolean;
  settings: SettingsState;
  onChange: (patch: Partial<SettingsState>) => void;
}

/** Collapsible advanced settings shared by every file row. */
export function SettingsPanel({ isVideoMode, operation, isGif, settings, onChange }: SettingsPanelProps) {
  const showPictureSettings = isVideoMode && operation !== 'extract-audio'; // resolution + fps
  const showQuality = showPictureSettings && !isGif; // quality preset + video bitrate
  const showAudioSettings = !isGif && !(isVideoMode && operation === 'remove-audio');

  const bitrateRaw = settings.videoBitrate.trim();
  const bitrateInvalid = bitrateRaw !== '' && !/^\d+$/.test(bitrateRaw)
    ? true
    : bitrateRaw !== '' && (Number(bitrateRaw) < 100 || Number(bitrateRaw) > 100_000);

  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={isVideoMode ? undefined : 'converter-advanced'}
      className="rounded-xl border px-4"
    >
      <AccordionItem value="converter-advanced" className="border-b-0">
        <AccordionTrigger className="text-sm font-medium">
          Advanced settings
        </AccordionTrigger>
        <AccordionContent className="space-y-5 pb-3 pt-1">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {showPictureSettings && (
              <SelectField
                id="conv-resolution"
                label={isGif ? 'Max width (resolution cap)' : 'Resolution'}
                value={settings.resolution}
                options={isGif ? GIF_RESOLUTION_OPTIONS : RESOLUTION_OPTIONS}
                onChange={(v) => onChange({ resolution: v as ResolutionValue })}
                hint={isGif ? undefined : 'Caps the output height; aspect ratio is preserved.'}
              />
            )}

            {showPictureSettings && (
              <SelectField
                id="conv-fps"
                label="Frame rate"
                value={String(settings.fps)}
                options={FPS_OPTIONS.map((o) => ({
                  value: String(o.value),
                  label: isGif && o.value === 'original' ? 'Original (12 fps for GIF)' : o.label,
                }))}
                onChange={(v) => onChange({ fps: v === 'original' ? 'original' : (Number(v) as FpsValue) })}
                hint={isGif ? 'Lower frame rates produce smaller GIFs.' : undefined}
              />
            )}

            {showAudioSettings && (
              <SelectField
                id="conv-audio-bitrate"
                label="Audio bitrate"
                value={settings.audioBitrate}
                options={AUDIO_BITRATE_OPTIONS}
                onChange={(v) => onChange({ audioBitrate: v })}
              />
            )}

            {showAudioSettings && (
              <SelectField
                id="conv-sample-rate"
                label="Audio sample rate"
                value={String(settings.sampleRate)}
                options={SAMPLE_RATE_OPTIONS}
                onChange={(v) => onChange({ sampleRate: v === 'original' ? 'original' : (Number(v) as SampleRateValue) })}
              />
            )}

            {showQuality && (
              <div className="space-y-2">
                <Label htmlFor="conv-video-bitrate">Video bitrate (kbps)</Label>
                <Input
                  id="conv-video-bitrate"
                  type="number"
                  inputMode="numeric"
                  min={100}
                  max={100000}
                  step={100}
                  placeholder="Auto (quality-based)"
                  value={settings.videoBitrate}
                  onChange={(e) => onChange({ videoBitrate: e.target.value })}
                  aria-invalid={bitrateInvalid}
                  aria-describedby="conv-video-bitrate-help"
                  className={cn(bitrateInvalid && 'border-destructive focus-visible:ring-destructive/30')}
                />
                <p
                  id="conv-video-bitrate-help"
                  className={cn('text-xs', bitrateInvalid ? 'text-destructive' : 'text-muted-foreground')}
                >
                  {bitrateInvalid
                    ? 'Enter a whole number between 100 and 100000 kbps.'
                    : 'Optional. Leave empty for quality-based (CRF) encoding.'}
                </p>
              </div>
            )}
          </div>

          {showQuality && (
            <div className="space-y-2">
              <Label>Quality preset</Label>
              <RadioGroup
                value={settings.quality}
                onValueChange={(v) => onChange({ quality: v as QualityValue })}
                aria-label="Quality preset"
                className="grid gap-3 sm:grid-cols-3"
              >
                {QUALITY_OPTIONS.map((q) => (
                  <Label
                    key={q.value}
                    htmlFor={`conv-quality-${q.value}`}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 font-normal transition-colors',
                      settings.quality === q.value
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/40'
                    )}
                  >
                    <RadioGroupItem id={`conv-quality-${q.value}`} value={q.value} className="mt-0.5" />
                    <span className="grid gap-0.5">
                      <span className="text-sm font-medium">{q.label}</span>
                      <span className="text-xs text-muted-foreground">{q.hint}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>
          )}

          {showAudioSettings && (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="conv-normalize">Normalize audio loudness</Label>
                <p className="text-xs text-muted-foreground">
                  Applies EBU R128 loudness normalization to the output track.
                </p>
              </div>
              <Switch
                id="conv-normalize"
                checked={settings.normalizeAudio}
                onCheckedChange={(checked) => onChange({ normalizeAudio: checked })}
              />
            </div>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function SelectField({ id, label, value, options, onChange, hint }: {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Honest notes for GIF output (palette optimization, fps and width-cap behavior). */
export function GifNote({ compressActive }: { compressActive?: boolean }) {
  return (
    <div
      role="note"
      aria-label="GIF output notes"
      className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1 text-xs sm:text-sm">
        <p className="font-medium">GIF output notes</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>GIF uses palette optimization: a custom color palette is generated per file and then applied.</li>
          <li>Frame rate sets the GIF fps; &quot;Original&quot; means 12 fps.</li>
          <li>Resolution acts as a width cap: 480p = 854 px, 360p = 640 px, 240p = 426 px, 144p = 256 px; other values cap at 640 px.</li>
          {compressActive && <li>Compress mode has no effect on GIF output (GIF is encoded with the palette pipeline).</li>}
        </ul>
      </div>
    </div>
  );
}

/** Honest note about the server-side compress behavior. */
export function CompressNote() {
  return (
    <div
      role="note"
      aria-label="Compress mode note"
      className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="text-xs sm:text-sm">
        Compress mode re-encodes with an extra-strong preset (CRF 32) on the server, so the quality preset
        above is overridden in this mode. Audio bitrate and normalization still apply.
      </p>
    </div>
  );
}
