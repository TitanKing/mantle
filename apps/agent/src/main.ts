/**
 * Mantle agent. Listens on Postgres for `telegram_message_inserted` notifies
 * and replies via OpenRouter.
 *
 *   pg_notify (from migration 0009 trigger; only inbound rows now)
 *      ↓
 *   handleMessage(messageId)
 *      ↓
 *   resolve responder agent from `agents` (highest-priority enabled row)
 *      ↓
 *   load conversation history (last N turns, inbound + outbound, chronological)
 *      ↓
 *   buildChatMessages — system prompt with cache_control for anthropic/* models
 *      ↓
 *   OpenRouter call → send reply → persist outbound row + node → mark inbound processed
 *
 * Agent config (model, persona, API key, memory depth) lives in the DB now —
 * `AGENT_MODEL` / `AGENT_PERSONA` env vars are dead. Configure via
 * `/settings/agents` in the web app.
 */

import postgres from 'postgres';
import { OpenRouter } from '@openrouter/sdk';
import { and, asc, desc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import {
  db,
  agents,
  nodes,
  telegramMessages,
  telegramChats,
  type Agent,
  type AgentMemoryConfig,
} from '@mantle/db';
import { accountForChat, sendMessage } from '@mantle/telegram';
import { getApiKeyById } from '@mantle/api-keys';
import { buildChatMessages, type Digest, type HistoryTurn } from './messages.js';
import { summarizeChat } from './summarizer.js';
import { extractNode } from './extractor.js';

const USER_ID = process.env.ALLOWED_USER_ID;
const DATABASE_URL = process.env.DATABASE_URL;

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

/** Fetch the active responder agent (highest priority, enabled). */
async function resolveResponderAgent(ownerId: string): Promise<Agent | null> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.ownerId, ownerId), eq(agents.role, 'responder'), eq(agents.enabled, true)))
    .orderBy(desc(agents.priority))
    .limit(1);
  return row ?? null;
}

/** Load Tier-2 digests + Tier-1 raw turns for the responder's prompt. */
async function loadContext(
  chatPk: string,
  excludeInboundId: string,
  inboundSentAt: Date,
  memoryConfig: AgentMemoryConfig,
  ownerId: string,
): Promise<{ digests: Digest[]; turns: HistoryTurn[] }> {
  const historyLimit = memoryConfig.history_limit ?? 20;
  const windowHours = memoryConfig.history_window_hours ?? null;
  const digestLimit = memoryConfig.digest_limit ?? 3;

  // Recent digest nodes for this chat. Filter by tag + chat_id stored on data.
  const digestRows =
    digestLimit > 0
      ? await db
          .select({ data: nodes.data, createdAt: nodes.createdAt })
          .from(nodes)
          .where(
            and(
              eq(nodes.ownerId, ownerId),
              eq(nodes.type, 'note'),
              sql`${nodes.tags} @> ARRAY['conversation-digest']::text[]`,
              sql`${nodes.data}->>'chat_id' = ${chatPk}`,
            ),
          )
          .orderBy(desc(nodes.createdAt))
          .limit(digestLimit)
      : [];

  const digests: Digest[] = digestRows
    .reverse() // oldest digest first
    .map((d) => {
      const data = d.data as Record<string, unknown>;
      return {
        summary: String(data.summary ?? ''),
        periodStart: String(data.period_start ?? ''),
        periodEnd: String(data.period_end ?? ''),
      };
    })
    .filter((d) => d.summary.length > 0);

  const conds = [eq(telegramMessages.chatId, chatPk), ne(telegramMessages.id, excludeInboundId)];
  conds.push(lt(telegramMessages.sentAt, inboundSentAt));
  if (windowHours != null && windowHours > 0) {
    const cutoff = new Date(inboundSentAt.getTime() - windowHours * 3600_000);
    conds.push(gte(telegramMessages.sentAt, cutoff));
  }

  const rows = await db
    .select({
      direction: telegramMessages.direction,
      text: telegramMessages.text,
      sentAt: telegramMessages.sentAt,
    })
    .from(telegramMessages)
    .where(and(...conds))
    .orderBy(desc(telegramMessages.sentAt))
    .limit(historyLimit);

  const turns: HistoryTurn[] = rows
    .reverse()
    .map((r) => ({ role: r.direction === 'outbound' ? 'assistant' : 'user', text: r.text }));

  return { digests, turns };
}

async function handleMessage(messageId: string): Promise<void> {
  const [row] = await db
    .select({
      id: telegramMessages.id,
      processed: telegramMessages.processed,
      direction: telegramMessages.direction,
      chatPk: telegramMessages.chatId,
      text: telegramMessages.text,
      sentAt: telegramMessages.sentAt,
      telegramChatId: telegramChats.telegramChatId,
      telegramMessageId: telegramMessages.telegramMessageId,
      fromName: telegramMessages.fromName,
      accountId: telegramMessages.accountId,
    })
    .from(telegramMessages)
    .innerJoin(telegramChats, eq(telegramMessages.chatId, telegramChats.id))
    .where(eq(telegramMessages.id, messageId))
    .limit(1);

  if (!row) return;
  if (row.processed) return;
  // Defensive — the trigger only fires for inbound but a manual INSERT could
  // get past it. We never reply to our own outbound row.
  if (row.direction !== 'inbound') return;

  if (!row.text || !row.text.trim()) {
    // Sticker, photo-only, etc. — nothing to reply to.
    await db
      .update(telegramMessages)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(telegramMessages.id, row.id));
    return;
  }

  // Atomic claim. Flip processed=true BEFORE doing any work; if the row was
  // already claimed (by a prior invocation that crashed mid-reply, or by a
  // racing notify in another process), the UPDATE returns 0 rows and we
  // exit silently. Tradeoff: a crash between this UPDATE and the actual
  // Telegram send means the user gets no reply — but they don't get a
  // duplicate either, which is the more user-friendly failure mode on a
  // chat surface. Hot-reload-driven duplicates were the original symptom.
  const claim = await db
    .update(telegramMessages)
    .set({ processed: true, processedAt: new Date() })
    .where(and(eq(telegramMessages.id, row.id), eq(telegramMessages.processed, false)))
    .returning({ id: telegramMessages.id });
  if (claim.length === 0) return;

  const lockKey = row.telegramChatId;
  const prev = inflight.get(lockKey);
  let release: () => void = () => {};
  const lockPromise = new Promise<void>((res) => {
    release = res;
  });
  if (prev) await prev;
  inflight.set(lockKey, lockPromise);

  try {
    const agent = await resolveResponderAgent(USER_ID!);
    if (!agent) {
      console.error(
        `[agent] no enabled responder agent — skipping ${messageId}. Create one at /settings/agents.`,
      );
      return;
    }
    if (!agent.apiKeyId) {
      console.error(
        `[agent] responder agent '${agent.slug}' has no api_key_id set — skipping. Edit it at /settings/agents.`,
      );
      return;
    }
    const apiKey = await getApiKeyById(agent.apiKeyId);
    if (!apiKey) {
      console.error(
        `[agent] api_key_id ${agent.apiKeyId} for agent '${agent.slug}' has no entry — was it deleted?`,
      );
      return;
    }

    const memoryConfig = (agent.memoryConfig ?? {}) as AgentMemoryConfig;

    const { digests, turns: history } = await loadContext(
      row.chatPk,
      row.id,
      row.sentAt,
      memoryConfig,
      USER_ID!,
    );
    const messages = buildChatMessages(agent.model, agent.systemPrompt, digests, history, row.text);

    const client = new OpenRouter({
      apiKey,
      httpReferer: 'https://mantle.crossworks.network',
      appTitle: 'Mantle',
    });

    console.log(
      `[agent] → ${row.fromName ?? 'unknown'} via ${agent.model} (${row.text.length}c, ${history.length} prior turns, ${digests.length} digests)`,
    );

    const result = await client.chat.send({
      chatRequest: {
        model: agent.model,
        messages,
        ...(typeof agent.params?.temperature === 'number' ? { temperature: agent.params.temperature } : {}),
        ...(typeof agent.params?.max_tokens === 'number' ? { maxTokens: agent.params.max_tokens } : {}),
        ...(typeof agent.params?.top_p === 'number' ? { topP: agent.params.top_p } : {}),
      },
    });

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

    const usage = (result as { usage?: { cacheReadInputTokens?: number; promptTokens?: number; completionTokens?: number } }).usage;
    if (usage) {
      console.log(
        `[agent]   usage: prompt=${usage.promptTokens ?? '?'} completion=${usage.completionTokens ?? '?'} cache_read=${usage.cacheReadInputTokens ?? 0}`,
      );
    }

    const account = await accountForChat(row.telegramChatId);
    if (!account) {
      console.error('[agent] no enabled telegram account for chat', row.telegramChatId);
      return;
    }

    const telegramMessageIds = await sendMessage(account, row.telegramChatId, reply, {
      replyTo: row.telegramMessageId,
    });

    // Persist outbound: one node + one telegram_messages row per Telegram chunk.
    const now = new Date();
    const titleStem = reply.slice(0, 120);
    for (const tgMsgId of telegramMessageIds) {
      const [node] = await db
        .insert(nodes)
        .values({
          ownerId: USER_ID!,
          type: 'telegram_message',
          title: titleStem,
          path: account.branchPath,
          data: {
            direction: 'outbound',
            model: agent.model,
            agent: agent.slug,
            replyToTelegramMessageId: row.telegramMessageId,
          },
          tags: ['telegram', 'outbound'],
        })
        .returning({ id: nodes.id });
      if (!node) throw new Error('failed to create outbound node');

      await db.insert(telegramMessages).values({
        nodeId: node.id,
        accountId: row.accountId,
        chatId: row.chatPk,
        telegramMessageId: String(tgMsgId),
        text: reply,
        sentAt: now,
        direction: 'outbound',
        agentId: agent.id,
        modelUsed: agent.model,
        replyToId: row.id,
        processed: true,
        processedAt: now,
      });
    }

    // (Inbound was already marked processed at the top of this function via
    // the atomic claim. Nothing to do here.)

    // Bump agent usage. Best-effort — don't fail the reply on a usage write error.
    void db
      .update(agents)
      .set({ lastUsedAt: now, usageCount: (agent.usageCount ?? 0) + 1, updatedAt: now })
      .where(eq(agents.id, agent.id))
      .catch(() => {});

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
  // Self-heal: inbound rows that already have an outbound reply but were
  // never marked processed (typically because a previous run crashed or
  // was hot-reloaded between sending Telegram and the final DB UPDATE).
  // Flip them to processed instead of generating a duplicate reply.
  const healed = await db.execute(sql`
    update telegram_messages m
       set processed = true,
           processed_at = coalesce(processed_at, now())
     where m.processed = false
       and m.direction = 'inbound'
       and exists (
         select 1 from telegram_messages r
          where r.reply_to_id = m.id
            and r.direction = 'outbound'
       )
     returning m.id
  `);
  const healedCount = Array.isArray(healed) ? healed.length : (healed as { count?: number }).count ?? 0;
  if (healedCount > 0) {
    console.log(`[agent] drain: healed ${healedCount} previously-replied message(s)`);
  }

  // Now the genuinely-pending set: unprocessed, inbound, no reply yet.
  const rows = await db
    .select({ id: telegramMessages.id })
    .from(telegramMessages)
    .where(and(eq(telegramMessages.processed, false), eq(telegramMessages.direction, 'inbound')))
    .orderBy(asc(telegramMessages.sentAt));
  if (rows.length === 0) {
    console.log('[agent] drain: queue empty');
    return;
  }
  console.log(`[agent] drain: ${rows.length} pending message(s)`);
  for (const r of rows) {
    await handleMessage(r.id);
  }
}

/** Debounce window for summarize_due — collapses a burst of inserts in the
 *  same chat (e.g. user message + agent reply within the same second) into
 *  one summarization check. The check itself is cheap (one indexed COUNT). */
const SUMMARIZE_DEBOUNCE_MS = 2000;
const summarizePending = new Set<string>();
let summarizeTimer: NodeJS.Timeout | null = null;

function scheduleSummarize(chatPk: string): void {
  summarizePending.add(chatPk);
  if (summarizeTimer) return;
  summarizeTimer = setTimeout(() => {
    summarizeTimer = null;
    const batch = [...summarizePending];
    summarizePending.clear();
    for (const id of batch) {
      summarizeChat(id, USER_ID!).catch((err) =>
        console.error('[agent] summarize error:', err instanceof Error ? err.message : err),
      );
    }
  }, SUMMARIZE_DEBOUNCE_MS);
}

/** Debounce window for node_ingested. Same per-node coalescing logic as
 *  summarize_due — multiple inserts of the same node id within 2s collapse
 *  to one extractor call. Cross-node parallelism preserved (Set iteration). */
const EXTRACT_DEBOUNCE_MS = 2000;
const extractPending = new Set<string>();
let extractTimer: NodeJS.Timeout | null = null;

function scheduleExtract(nodeId: string): void {
  extractPending.add(nodeId);
  if (extractTimer) return;
  extractTimer = setTimeout(() => {
    extractTimer = null;
    const batch = [...extractPending];
    extractPending.clear();
    for (const id of batch) {
      extractNode(id, USER_ID!).catch((err) =>
        console.error('[agent] extract error:', err instanceof Error ? err.message : err),
      );
    }
  }, EXTRACT_DEBOUNCE_MS);
}

async function main() {
  const pg = postgres(DATABASE_URL!, { max: 2 });
  console.log('[agent] starting — config from agents table');

  await pg.listen('telegram_message_inserted', (payload: string) => {
    if (!payload) return;
    handleMessage(payload).catch((err) =>
      console.error('[agent] handle error:', err instanceof Error ? err.message : err),
    );
  });
  console.log('[agent] LISTENing on telegram_message_inserted');

  await pg.listen('summarize_due', (payload: string) => {
    if (!payload) return;
    scheduleSummarize(payload);
  });
  console.log('[agent] LISTENing on summarize_due');

  await pg.listen('node_ingested', (payload: string) => {
    if (!payload) return;
    scheduleExtract(payload);
  });
  console.log('[agent] LISTENing on node_ingested');

  await drainPending();

  await new Promise<never>(() => {});
}

main().catch((err) => {
  console.error('[agent] fatal:', err);
  process.exit(1);
});
