import { NextResponse, type NextRequest } from 'next/server';
import { PUBLIC_PATHS, SESSION_COOKIE_NAME } from '@/lib/auth-constants';

/**
 * Lightweight session-cookie check in the Edge runtime. Uses Web Crypto
 * (available in both edge and node runtimes) so we avoid pulling node:crypto.
 *
 * Per-page `requireOwner()` does the DB lookup; this just gates non-public
 * paths on a syntactically-valid, signed, unexpired cookie.
 */

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function eqConstantTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function verify(token: string, secret: string): Promise<boolean> {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
  );
  const got = b64urlDecode(sigPart);
  if (!eqConstantTime(got, expected)) return false;

  try {
    const json = new TextDecoder().decode(b64urlDecode(payload));
    const data = JSON.parse(json);
    if (typeof data.exp !== 'number') return false;
    if (Date.now() / 1000 > data.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
  if (isPublic) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    // Misconfig: log server-side, return a generic 500. Never put config
    // details in the URL — they end up in browser history, referer
    // headers, and access logs. Operator sees the real reason in stderr;
    // the user sees a neutral page.
    console.error('[middleware] SESSION_SECRET missing or <32 chars; refusing all requests');
    return new NextResponse('Service unavailable', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token || !(await verify(token, secret))) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
