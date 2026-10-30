import { NextRequest, NextResponse } from 'next/server';
import { deleteStoredFile } from '@/lib/storage';

export const runtime = 'nodejs';

/** DELETE /api/files/[id] — remove a stored file + DB row immediately. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = await deleteStoredFile(id);
  if (!ok) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
