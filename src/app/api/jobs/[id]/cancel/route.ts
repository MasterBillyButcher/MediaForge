import { NextRequest, NextResponse } from 'next/server';
import { cancelJob } from '@/lib/media/job-manager';

export const runtime = 'nodejs';

/** POST /api/jobs/[id]/cancel — cancel a queued or running job. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = cancelJob(id);
  if (!ok) {
    return NextResponse.json({ error: 'Job cannot be cancelled (it may already be finished).' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
