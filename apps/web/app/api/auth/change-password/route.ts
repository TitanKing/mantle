import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser, updatePassword, verifyPassword } from '@/lib/auth';

const ChangePasswordBody = z
  .object({
    oldPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(8).max(1024),
  })
  .refine((d) => d.oldPassword !== d.newPassword, {
    message: 'New password must be different from the current one.',
    path: ['newPassword'],
  });

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = ChangePasswordBody.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid input.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const ok = await verifyPassword(user.id, parsed.data.oldPassword);
  if (!ok) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
  }

  await updatePassword(user.id, parsed.data.newPassword);
  return NextResponse.json({ ok: true });
}
