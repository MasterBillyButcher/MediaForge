import { NextResponse } from 'next/server';
import { sweepNow } from '@/lib/storage';

export const runtime = 'nodejs';

/** POST /api/system/cleanup — force-expire temporary files now. */
export async function POST() {
  const removed = await sweepNow();
  return NextResponse.json({ ok: true, removed });
}
