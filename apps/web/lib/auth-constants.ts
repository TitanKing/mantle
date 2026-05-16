/**
 * Constants shared between middleware (Edge runtime) and lib/auth.ts
 * (Node runtime). Both files validate the session cookie but can't share
 * full code — middleware uses Web Crypto, lib/auth uses node:crypto.
 * Pull anything that's just data (cookie name, public paths) in here.
 */

export const SESSION_COOKIE_NAME = 'mantle_session';

export const PUBLIC_PATHS = ['/login', '/api/auth'];
