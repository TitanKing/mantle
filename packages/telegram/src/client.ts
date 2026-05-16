import { Bot } from 'grammy';
import { open } from '@mantle/crypto';
import type { TelegramAccount } from '@mantle/db';

/**
 * Cache one `Bot` instance per account so we share HTTP keepalive across
 * outbound calls and the polling loop. Bot instances are stateless beyond
 * their token, so re-creating them is cheap, but caching avoids burning a
 * fresh TLS handshake on every reply.
 */
const cache = new Map<string, Bot>();

export function botFor(account: TelegramAccount): Bot {
  const cached = cache.get(account.id);
  if (cached) return cached;
  const token = open(account.botTokenEnc, account.id);
  const bot = new Bot(token);
  cache.set(account.id, bot);
  return bot;
}

/** Clears the cached Bot for an account (call after token rotation). */
export function evictBot(accountId: string): void {
  cache.delete(accountId);
}
