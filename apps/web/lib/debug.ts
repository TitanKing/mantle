import { and, desc, eq, sql } from 'drizzle-orm';
import { db, agents, nodes, telegramChats, telegramMessages } from '@mantle/db';

/**
 * Read-only helpers for the /debug page. All owner-scoped — pass the user's
 * id explicitly; the page never accepts a user id from the client.
 */

export type DigestRow = {
  id: string;
  title: string;
  createdAt: string;
  /** All fields below are pulled out of nodes.data (jsonb). */
  chatId: string;
  telegramChatId: string | null;
  periodStart: string;
  periodEnd: string;
  sourceTurnCount: number;
  model: string;
  agent: string;
  summary: string;
};

export async function listDigests(userId: string, limit = 25): Promise<DigestRow[]> {
  const rows = await db
    .select({
      id: nodes.id,
      title: nodes.title,
      data: nodes.data,
      createdAt: nodes.createdAt,
    })
    .from(nodes)
    .where(
      and(
        eq(nodes.ownerId, userId),
        eq(nodes.type, 'note'),
        sql`${nodes.tags} @> ARRAY['conversation-digest']::text[]`,
      ),
    )
    .orderBy(desc(nodes.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      chatId: String(d.chat_id ?? ''),
      telegramChatId: d.telegram_chat_id ? String(d.telegram_chat_id) : null,
      periodStart: String(d.period_start ?? ''),
      periodEnd: String(d.period_end ?? ''),
      sourceTurnCount: Number(d.source_turn_count ?? 0),
      model: String(d.model ?? ''),
      agent: String(d.agent ?? ''),
      summary: String(d.summary ?? ''),
    };
  });
}

export type ChatRow = {
  id: string;
  title: string | null;
  username: string | null;
  telegramChatId: string;
  allowlistStatus: string;
  totalTurns: number;
  digested: number;
  undigested: number;
  lastActivity: string | null;
};

export async function listTelegramChats(userId: string): Promise<ChatRow[]> {
  const rows = await db
    .select({
      id: telegramChats.id,
      title: telegramChats.title,
      username: telegramChats.username,
      telegramChatId: telegramChats.telegramChatId,
      allowlistStatus: telegramChats.allowlistStatus,
      lastMessageAt: telegramChats.lastMessageAt,
      totalTurns: sql<number>`count(${telegramMessages.id})::int`,
      digested: sql<number>`count(${telegramMessages.id}) filter (where ${telegramMessages.digestNodeId} is not null)::int`,
      undigested: sql<number>`count(${telegramMessages.id}) filter (where ${telegramMessages.digestNodeId} is null)::int`,
    })
    .from(telegramChats)
    .leftJoin(telegramMessages, eq(telegramMessages.chatId, telegramChats.id))
    .where(eq(telegramChats.userId, userId))
    .groupBy(telegramChats.id)
    .orderBy(desc(telegramChats.lastMessageAt));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    username: r.username,
    telegramChatId: r.telegramChatId,
    allowlistStatus: r.allowlistStatus,
    totalTurns: r.totalTurns ?? 0,
    digested: r.digested ?? 0,
    undigested: r.undigested ?? 0,
    lastActivity: r.lastMessageAt?.toISOString() ?? null,
  }));
}

export type AgentActivityRow = {
  id: string;
  slug: string;
  name: string;
  role: string;
  model: string;
  priority: number;
  enabled: boolean;
  lastUsedAt: string | null;
  usageCount: number;
};

export async function listAgentActivity(userId: string): Promise<AgentActivityRow[]> {
  const rows = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      role: agents.role,
      model: agents.model,
      priority: agents.priority,
      enabled: agents.enabled,
      lastUsedAt: agents.lastUsedAt,
      usageCount: agents.usageCount,
    })
    .from(agents)
    .where(eq(agents.ownerId, userId))
    .orderBy(desc(agents.lastUsedAt));

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    role: r.role,
    model: r.model,
    priority: r.priority,
    enabled: r.enabled,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    usageCount: r.usageCount ?? 0,
  }));
}

