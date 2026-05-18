import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth';
import { deleteTool, getToolById, updateTool } from '@/lib/tools';

const IdParams = z.object({ id: z.string().uuid() });

const HandlerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), ref: z.string().min(1).max(120) }),
  z.object({
    kind: z.literal('http'),
    url: z.string().url().max(2000),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    headersRef: z.string().nullable().optional(),
    authRef: z.string().nullable().optional(),
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
  }),
  z.object({
    kind: z.literal('shell'),
    cmd: z.string().min(1).max(8000),
  }),
]);

const PatchBody = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
    inputSchema: z.record(z.string(), z.unknown()),
    handler: HandlerSchema,
    requiresConfirm: z.boolean(),
    enabled: z.boolean(),
  })
  .partial();

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const idParsed = IdParams.safeParse(await ctx.params);
  if (!idParsed.success) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const tool = await getToolById(user.id, idParsed.data.id);
  if (!tool) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ tool });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const idParsed = IdParams.safeParse(await ctx.params);
  if (!idParsed.success) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const raw = await req.json().catch(() => ({}));
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid input' },
      { status: 400 },
    );
  }
  try {
    const row = await updateTool(user.id, idParsed.data.id, parsed.data);
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ tool: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const idParsed = IdParams.safeParse(await ctx.params);
  if (!idParsed.success) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const ok = await deleteTool(user.id, idParsed.data.id);
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
