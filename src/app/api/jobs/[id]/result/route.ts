import { NextRequest, NextResponse } from 'next/server';
import { getJob, getJobResultPath } from '@/lib/media/job-manager';
import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';

export const runtime = 'nodejs';

/** GET /api/jobs/[id]/result — download the processed result file. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job || job.state !== 'completed' || !job.result) {
    return NextResponse.json({ error: 'Result is not ready or the job failed.' }, { status: 404 });
  }
  const path = await getJobResultPath(id);
  if (!path) {
    return NextResponse.json({ error: 'Result file is no longer available.' }, { status: 410 });
  }
  const stat = await fs.stat(path).catch(() => null);
  if (!stat) return NextResponse.json({ error: 'Result file missing on disk.' }, { status: 410 });

  const stream = createReadStream(path);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': job.result.mime,
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${job.result.name.replace(/"/g, '')}"`,
    },
  });
}
