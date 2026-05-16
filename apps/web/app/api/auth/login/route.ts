import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildSessionCookie, loginWithPassword, SESSION_COOKIE_NAME } from '@/lib/auth';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1024),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}));
  const parsed = LoginBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email and password required.' }, { status: 400 });
  }

  const userId = await loginWithPassword(parsed.data.email, parsed.data.password);
  if (!userId) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  const { value, maxAgeSec } = buildSessionCookie(userId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSec,
  });
  return res;
}
