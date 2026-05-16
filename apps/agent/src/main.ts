/**
 * Mantle agent. Listens on Postgres for `telegram_message_inserted` notifies
 * and replies via OpenRouter. One process; same DB pool as everyone else.
 *
 *   pg_notify (from migration 0009 trigger)
 *      ↓
 *   handleMessage(messageId)
 *      ↓
 *   fetch row → load OpenRouter key from api_keys → call model → send reply
 *      → mark processed
 *
 * v1 is intentionally simple: single-turn (no history of our own replies in
 * context), one default model, per-chat serialization so we never have two
 * outbound replies racing for the same chat.
 */

import postgres from 'postgres';
import { OpenRouter } from '@openrouter/sdk';
import { eq } from 'drizzle-orm';
import { db, telegramMessages, telegramChats } from '@mantle/db';
import { accountForChat, sendMessage } from '@mantle/telegram';
import { getApiKey } from '@mantle/api-keys';

const USER_ID = process.env.ALLOWED_USER_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const MODEL = process.env.AGENT_MODEL ?? 'deepseek/deepseek-chat';
const PERSONA =
  process.env.AGENT_PERSONA ??
  "You are an assistant helping Jason via Telegram. Be concise and conversational — short paragraphs, no headers, no bullet lists unless explicitly useful. Match the tone of the incoming message. Skip pleasantries unless they fit naturally. If you don't know something or can't help, say so plainly.";

if (!USER_ID) {
  console.error('[agent] ALLOWED_USER_ID must be set');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('[agent] DATABASE_URL must be set');
  process.exit(1);
}

/** Per-chat in-flight tracker. Prevents two replies racing for the same chat. */
const inflight = new Map<string, Promise<void>>();

async function handleMessage(messageId: string): Promise<void> {
  const [row] = await db
    .select({
      id: telegramMessages.id,
      processed: telegramMessages.processed,
      chatPk: telegramMessages.chatId,
      text: telegramMessages.text,
      telegramChatId: telegramChats.telegramChatId,
      telegramMessageId: telegramMessages.telegramMessageId,
      fromName: telegramMessages.fromName,
    })
    .from(telegramMessages)
    .innerJoin(telegramChats, eq(telegramMessages.chatId, telegramChats.id))
    .where(eq(telegramMessages.id, messageId))
    .limit(1);

  if (!row) return;
  if (row.processed) return;

  if (!row.text || !row.text.trim()) {
    // Sticker, photo-only, etc. — nothing to reply to. Mark done so it stops
    // showing in telegram_pending.
    await db
      .update(telegramMessages)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(telegramMessages.id, row.id));
    return;
  }

  // Serialize per chat. The DB id (uuid) is fine as the lock key.
  const lockKey = row.telegramChatId;
  const prev = inflight.get(lockKey);
  let release: () => void = () => {};
  const lockPromise = new Promise<void>((res) => {
    release = res;
  });
  if (prev) await prev;
  inflight.set(lockKey, lockPromise);

  try {
    const apiKey = await getApiKey(USER_ID!, 'openrouter');
    if (!apiKey) {
      console.error(
        `[agent] no 'openrouter' api key set — skipping ${messageId}. Add one at /settings/keys.`,
      );
      return;
    }

    const client = new OpenRouter({
      apiKey,
      httpReferer: 'https://mantle.crossworks.network',
      appTitle: 'Mantle',
    });

    console.log(`[agent] → ${row.fromName ?? 'unknown'} via ${MODEL} (${row.text.length}c)`);

    const result = await client.chat.send({
      chatRequest: {
        model: MODEL,
        messages: [
          { role: 'system', content: PERSONA },
          { role: 'user', content: row.text },
        ],
      },
    });

    // SDK returns ChatResult | EventStream; we don't stream so the former.
    if (!('choices' in result)) {
      console.error('[agent] unexpected streaming response — skipping');
      return;
    }
    const rawContent = result.choices[0]?.message?.content;
    const reply = typeof rawContent === 'string' ? rawContent.trim() : '';
    if (!reply) {
      console.error('[agent] empty reply from model — not sending');
      return;
    }

    const account = await accountForChat(row.telegramChatId);
    if (!account) {
      console.error('[agent] no enabled telegram account for chat', row.telegramChatId);
      return;
    }

    await sendMessage(account, row.telegramChatId, reply, {
      replyTo: row.telegramMessageId,
    });

    await db
      .update(telegramMessages)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(telegramMessages.id, row.id));

    console.log(`[agent] ✓ replied (${reply.length}c)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[agent] handle failed:', msg);
  } finally {
    release();
    if (inflight.get(lockKey) === lockPromise) {
      inflight.delete(lockKey);
    }
  }
}

async function drainPending(): Promise<void> {
  const rows = await db
    .select({ id: telegramMessages.id })
    .from(telegramMessages)
    .where(eq(telegramMessages.processed, false));
  if (rows.length === 0) {
    console.log('[agent] drain: queue empty');
    return;
  }
  console.log(`[agent] drain: ${rows.length} pending message(s)`);
  for (const r of rows) {
    await handleMessage(r.id);
  }
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 2 });
  console.log(`[agent] starting — model=${MODEL}`);

  await sql.listen('telegram_message_inserted', (payload: string) => {
    if (!payload) return;
    handleMessage(payload).catch((err) =>
      console.error('[agent] handle error:', err instanceof Error ? err.message : err),
    );
  });
  console.log('[agent] LISTENing on telegram_message_inserted');

  // Catch up on anything that arrived while we were down.
  await drainPending();

  // Keep alive — sql.listen() is async-set-up, the actual listener runs on its
  // own connection. We just need the process not to exit.
  await new Promise<never>(() => {});
}

main().catch((err) => {
  console.error('[agent] fatal:', err);
  process.exit(1);
});
