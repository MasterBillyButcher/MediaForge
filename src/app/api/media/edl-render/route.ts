import { NextRequest, NextResponse } from 'next/server';
import { enqueueFfmpegJob } from '@/lib/media/job-manager';
import { prepareEdlInputs, buildEdlArgs, validateEdl } from '@/lib/media/edl';
import { ensureStorageDirs, startStorageSweeper } from '@/lib/storage';
import { rateLimit, clientIpFromRequest } from '@/lib/rate-limit';
import type { Edl, EdlOutputFormat } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * POST /api/media/edl-render — server-side high quality render of the
 * browser editor's timeline. The EDL JSON fully describes the edit; ffmpeg
 * applies every listed operation for real.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`edl:${clientIpFromRequest(req)}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many renders. Retry in ${rl.retryAfterSeconds}s.` }, { status: 429 });
  }

  let body: { edl?: Edl; format?: EdlOutputFormat; projectName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const edl = body.edl;
  const format: EdlOutputFormat = body.format ?? 'mp4';
  if (!edl) return NextResponse.json({ error: 'Missing EDL payload.' }, { status: 400 });
  if (!['mp4', 'webm', 'mov', 'mkv'].includes(format)) {
    return NextResponse.json({ error: 'Unsupported export format.' }, { status: 400 });
  }

  const validationError = validateEdl(edl);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  await ensureStorageDirs();
  startStorageSweeper();

  try {
    const inputs = await prepareEdlInputs(edl);
    const plan = buildEdlArgs(edl, inputs, '', format); // dry-run validation of structure
    if (plan.args.length === 0) throw new Error('Empty render plan.');

    const job = enqueueFfmpegJob({
      type: 'edl-render',
      label: body.projectName?.slice(0, 60) || 'timeline-export',
      totalDuration: plan.totalDuration,
      resultExt: format,
      operation: 'edl-render',
      buildArgs: ({ filePath }) => buildEdlArgs(edl, inputs, filePath, format).args,
    });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not start the render.' },
      { status: 400 }
    );
  }
}
