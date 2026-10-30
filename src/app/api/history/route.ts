import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/** GET /api/history — download history (latest 100). */
export async function GET() {
  const records = await db.downloadRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ records });
}

/** DELETE /api/history?id=... | DELETE /api/history (clear all) */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    await db.downloadRecord.delete({ where: { id } }).catch(() => undefined);
  } else {
    await db.downloadRecord.deleteMany({});
  }
  return NextResponse.json({ ok: true });
}
