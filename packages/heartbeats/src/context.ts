/**
 * AsyncLocalStorage for the heartbeat the current tool loop is
 * executing under. Read by heartbeat_complete / heartbeat_snooze /
 * heartbeat_update_state tools in @mantle/tools — they refuse to run
 * unless they can find an id here, which prevents accidental
 * invocation from normal (non-heartbeat) turns.
 *
 * Same pattern as @mantle/tracing's currentTrace().
 */

import { AsyncLocalStorage } from 'node:async_hooks';

type HeartbeatCtx = { heartbeatId: string; ownerId: string };

const store = new AsyncLocalStorage<HeartbeatCtx>();

export function currentHeartbeat(): HeartbeatCtx | null {
  return store.getStore() ?? null;
}

export function withHeartbeatContext<T>(ctx: HeartbeatCtx, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}
