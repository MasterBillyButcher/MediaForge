import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/media/job-manager';

export const runtime = 'nodejs';

/** GET /api/jobs/[id] — poll job status with real progress. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found (the server may have restarted).' }, { status: 404 });
  }
  return NextResponse.json({ job });
}
