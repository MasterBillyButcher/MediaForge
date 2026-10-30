// Real SRT / WebVTT parsing and serialization.
// Handles: SRT index lines, `HH:MM:SS,mmm --> HH:MM:SS,mmm` timings,
// VTT `WEBVTT` headers, dot millisecond separators, cue identifiers and
// cue settings (ignored), multi-line cue text, CRLF, and BOM.

export interface Cue {
  id: string;
  /** seconds (float) */
  start: number;
  /** seconds (float) */
  end: number;
  text: string;
}

export type SubtitleFormat = 'srt' | 'vtt';

export interface ParseResult {
  cues: Cue[];
  format: SubtitleFormat;
  /** non-fatal problems found while parsing (unrecognized lines etc.) */
  errors: string[];
}

const TIMING_RE =
  /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;

function tsToSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  const hours = h ? parseInt(h, 10) : 0;
  const millis = parseInt(ms.padEnd(3, '0'), 10);
  return hours * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + millis / 1000;
}

function isTimingLine(line: string): boolean {
  return TIMING_RE.test(line);
}

/**
 * Lenient parser for manual time entry. Accepts:
 * `90.5` (seconds), `01:30`, `1:02:03.5`, `00:00:01,250`.
 */
export function parseTimeLenient(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (s === '') return null;
  const parts = s.split(':');
  if (parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    if (part === '' || !/^\d+(\.\d+)?$/.test(part)) return null;
    seconds = seconds * 60 + parseFloat(part);
  }
  return Number.isFinite(seconds) ? seconds : null;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/** Format seconds as a subtitle timestamp (SRT uses `,` for ms, VTT uses `.`). */
export function formatTimestamp(seconds: number, vtt: boolean): string {
  let ms = Math.round(seconds * 1000);
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3_600_000);
  ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000);
  ms -= m * 60_000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${vtt ? '.' : ','}${pad(ms, 3)}`;
}

export function parseSubtitles(raw: string): ParseResult {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const isVtt = /^WEBVTT/i.test((lines[0] ?? '').trim());
  const errors: string[] = [];
  const cues: Cue[] = [];

  let i = 0;
  if (isVtt) {
    i = 1;
    // Skip the WEBVTT header block (may contain metadata like Kind:/Language:).
    while (i < lines.length && lines[i].trim() !== '') i++;
  }

  let cueCounter = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }

    let timingLine: string | null = null;
    if (isTimingLine(line)) {
      timingLine = line.trim();
    } else {
      // Either an SRT index line or a VTT cue identifier before the timing line.
      const next = (lines[i + 1] ?? '').trim();
      if (next !== '' && isTimingLine(next)) {
        timingLine = next;
        i++;
      } else {
        errors.push(`Skipped unrecognized line ${i + 1}: "${line.trim().slice(0, 48)}"`);
        i++;
        continue;
      }
    }

    const m = TIMING_RE.exec(timingLine);
    if (!m) {
      i++;
      continue;
    }
    const start = tsToSeconds(m[1], m[2], m[3], m[4]);
    const end = tsToSeconds(m[5], m[6], m[7], m[8]);
    i++;

    // Collect text lines until a blank line or the start of the next block.
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      const l = lines[i];
      const next = (lines[i + 1] ?? '').trim();
      const startsNewBlock =
        isTimingLine(l) || (next !== '' && isTimingLine(next));
      if (startsNewBlock) break;
      textLines.push(l);
      i++;
    }

    cues.push({
      id: `cue-${cueCounter++}`,
      start,
      end,
      text: textLines.join('\n').trim(),
    });
  }

  return { cues, format: isVtt ? 'vtt' : 'srt', errors };
}

/** Serialize cues to SRT (index + comma-millisecond timings). */
export function serializeSrt(cues: Cue[]): string {
  return (
    cues
      .map(
        (cue, idx) =>
          `${idx + 1}\n${formatTimestamp(cue.start, false)} --> ${formatTimestamp(cue.end, false)}\n${
            cue.text.trim() || ' '
          }`
      )
      .join('\n\n') + '\n'
  );
}

/** Serialize cues to WebVTT (WEBVTT header + dot-millisecond timings). */
export function serializeVtt(cues: Cue[]): string {
  const body =
    cues
      .map(
        (cue, idx) =>
          `${idx + 1}\n${formatTimestamp(cue.start, true)} --> ${formatTimestamp(cue.end, true)}\n${
            cue.text.trim() || ' '
          }`
      )
      .join('\n\n') + '\n';
  return `WEBVTT\n\n${body}`;
}

export function serializeSubtitles(cues: Cue[], format: SubtitleFormat): string {
  return format === 'vtt' ? serializeVtt(cues) : serializeSrt(cues);
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
