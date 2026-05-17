/**
 * Tier-2 conversation memory.
 *
 * `summarizeChat(chatPk, ownerId)` looks at the oldest undigested
 * telegram_messages rows in a chat and rolls them into a single `note` node
 * tagged `conversation-digest`. The responder agent reads these back as part
 * of its prompt-building so older context survives past the raw-history
 * window.
 *
 * Driven from a debounced LISTEN on `summarize_due` in main.ts. This module
 * is intentionally pure-logic — no listeners, no LISTEN handling.
 */

import { OpenRouter } from '@openrouter/sdk';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  db,
  agents,
  nodes,
  telegramMessages,
  telegramAccounts,
  telegramChats,
  type Agent,
  type AgentMemoryConfig,
  type AgentParams,
} from '@mantle/db';
import { getApiKeyById } from '@mantle/api-keys';
import { buildChatMessages } from './messages.js';

/** Default seeded into the UI when role flips to `summarizer`. The user can
 *  edit it on the agent row at any time. */
export const DEFAULT_SUMMARIZER_PROMPT = `You are a memory compressor for an ongoing Telegram conversation. You will be given a chronological transcript of a chat between the user and an AI assistant.

Produce a SHORT, factual summary (3-6 sentences, no headers, no bullet lists) capturing:
  - Topics discussed
  - Decisions made or commitments mentioned
  - Specific facts about people, places, dates, or numbers
  - Notable shifts in tone or context

Do NOT include conversational filler ("the user said hi"). Be specific — write "Jason is preaching on Romans 8 this Sunday" not "they discussed church plans." Use the user's name when known.

This summary will be loaded into the assistant's context on future replies, so write it as a reference, not a narrative.`;

async function resolveSummarizerAgent(ownerId: string): Promise<Agent | null> {
  const [row] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.ownerId, ownerId),
        eq(agents.role, 'summarizer'),
        eq(agents.enabled, true),
      ),
    )
    .orderBy(desc(agents.priority))
    .limit(1);
  return row ?? null;
}

export async function summarizeChat(chatPk: string, ownerId: string): Promise<void> {
  const agent = await resolveSummarizerAgent(ownerId);
  if (!agent) return; // No summarizer configured — silently skip on every notify.
  if (!agent.apiKeyId) {
    console.error(`[agent] summarizer '${agent.slug}' has no api_key_id — skipping`);
    return;
  }

  const memoryConfig = (agent.memoryConfig ?? {}) as AgentMemoryConfig;
  const threshold = memoryConfig.summarize_threshold ?? 30;
  const batchSize = memoryConfig.summarize_batch ?? 20;

  // Cheap short-circuit: count undigested turns. Uses the partial index
  // telegram_messages_chat_undigested_idx so this stays O(log n).
  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(telegramMessages)
    .where(and(eq(telegramMessages.chatId, chatPk), isNull(telegramMessages.digestNodeId)));
  const undigested = countRows[0]?.n ?? 0;
  if (undigested < threshold) return;

  // Pick the oldest `batchSize` undigested turns.
  const batch = await db
    .select({
      id: telegramMessages.id,
      direction: telegramMessages.direction,
      text: telegramMessages.text,
      sentAt: telegramMessages.sentAt,
      fromName: telegramMessages.fromName,
    })
    .from(telegramMessages)
    .where(and(eq(telegramMessages.chatId, chatPk), isNull(telegramMessages.digestNodeId)))
    .orderBy(asc(telegramMessages.sentAt))
    .limit(batchSize);

  if (batch.length === 0) return;

  // Find the chat + account so we can use the account's branch_path for the
  // digest node (keeps digests under the same ltree subtree as their turns).
  const [chatRow] = await db
    .select({ accountId: telegramChats.accountId, telegramChatId: telegramChats.telegramChatId })
    .from(telegramChats)
    .where(eq(telegramChats.id, chatPk))
    .limit(1);
  if (!chatRow) {
    console.error(`[agent] summarizer: chat ${chatPk} not found`);
    return;
  }
  const [account] = await db
    .select({ branchPath: telegramAccounts.branchPath })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.id, chatRow.accountId))
    .limit(1);
  if (!account) {
    console.error(`[agent] summarizer: account for chat ${chatPk} not found`);
    return;
  }

  const apiKey = await getApiKeyById(agent.apiKeyId);
  if (!apiKey) {
    console.error(`[agent] summarizer: api_key_id ${agent.apiKeyId} not found — skipping`);
    return;
  }

  const transcript = batch
    .map((t) => {
      const who = t.direction === 'outbound' ? 'assistant' : (t.fromName ?? 'user');
      return `[${t.sentAt.toISOString()}] ${who}: ${t.text}`;
    })
    .join('\n');

  const params = (agent.params ?? {}) as AgentParams;

  // Reuse the same messages helper. Empty digests (we never recursively
  // summarize), no prior history (the transcript IS the input).
  const messages = buildChatMessages(agent.model, agent.systemPrompt, [], [], transcript);

  const client = new OpenRouter({
    apiKey,
    httpReferer: 'https://mantle.crossworks.network',
    appTitle: 'Mantle',
  });

  console.log(
    `[agent] summarizing chat ${chatPk} (${batch.length} turns, ${agent.model})`,
  );

  const result = await client.chat.send({
    chatRequest: {
      model: agent.model,
      messages,
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
      ...(typeof params.max_tokens === 'number' ? { maxTokens: params.max_tokens } : {}),
      ...(typeof params.top_p === 'number' ? { topP: params.top_p } : {}),
    },
  });

  if (!('choices' in result)) {
    console.error('[agent] summarizer: unexpected streaming response — skipping');
    return;
  }
  const rawContent = result.choices[0]?.message?.content;
  const summary = typeof rawContent === 'string' ? rawContent.trim() : '';
  if (!summary) {
    console.error('[agent] summarizer: empty summary — not persisting');
    return;
  }

  const usage = (result as {
    usage?: { cacheReadInputTokens?: number; promptTokens?: number; completionTokens?: number };
  }).usage;
  if (usage) {
    console.log(
      `[agent]   usage: prompt=${usage.promptTokens ?? '?'} completion=${usage.completionTokens ?? '?'} cache_read=${usage.cacheReadInputTokens ?? 0}`,
    );
  }

  const periodStart = batch[0]!.sentAt.toISOString();
  const periodEnd = batch[batch.length - 1]!.sentAt.toISOString();
  const periodStartShort = periodStart.slice(0, 10);
  const periodEndShort = periodEnd.slice(0, 10);
  const title = `Telegram digest ${periodStartShort} → ${periodEndShort} (${batch.length} turns)`;

  // Persist: one node + flip all batch rows to point at it.
  const [node] = await db
    .insert(nodes)
    .values({
      ownerId,
      type: 'note',
      title,
      path: account.branchPath,
      data: {
        kind: 'conversation_digest',
        source: 'telegram',
        chat_id: chatPk,
        telegram_chat_id: chatRow.telegramChatId,
        period_start: periodStart,
        period_end: periodEnd,
        source_turn_count: batch.length,
        model: agent.model,
        agent: agent.slug,
        summary,
      },
      tags: ['conversation-digest', 'telegram'],
    })
    .returning({ id: nodes.id });
  if (!node) {
    console.error('[agent] summarizer: failed to insert digest node');
    return;
  }

  const batchIds = batch.map((t) => t.id);
  await db
    .update(telegramMessages)
    .set({ digestNodeId: node.id })
    .where(inArray(telegramMessages.id, batchIds));

  void db
    .update(agents)
    .set({
      lastUsedAt: new Date(),
      usageCount: (agent.usageCount ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agent.id))
    .catch(() => {});

  console.log(`[agent] ✓ digest created (${summary.length}c, covers ${batch.length} turns)`);
}
