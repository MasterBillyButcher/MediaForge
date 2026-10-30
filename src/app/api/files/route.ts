import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toMediaFileRecord } from '@/lib/storage';

export const runtime = 'nodejs';

/** GET /api/files — list stored media files (uploads + results, latest 100). */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind');
  const rows = await db.mediaFile.findMany({
    where: kind && ['upload', 'result', 'download'].includes(kind) ? { kind } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ files: rows.map(toMediaFileRecord) });
}
