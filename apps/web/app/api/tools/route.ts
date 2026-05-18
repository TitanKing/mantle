import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth';
import { createTool, listToolsForOwner } from '@/lib/tools';

export async function GET() {
  const user = await requireOwner();
  const rows = await listToolsForOwner(user.id);
  return NextResponse.json({ tools: rows });
}

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

const CreateBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9_-]+$/, 'slug must be lowercase letters/digits/dash/underscore'),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  handler: HandlerSchema,
  requiresConfirm: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export async function POST(req: Request) {
  const user = await requireOwner();
  const raw = await req.json().catch(() => ({}));
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid input' },
      { status: 400 },
    );
  }
  try {
    const row = await createTool(user.id, parsed.data);
    return NextResponse.json({ tool: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('tools_owner_slug_uq') || msg.includes('duplicate key')) {
      return NextResponse.json(
        { error: `A tool with slug "${parsed.data.slug}" already exists.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
