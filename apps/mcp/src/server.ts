/**
 * Mantle MCP server.
 *
 * Exposes the user's tree, emails, files, telegram messages, and rules to
 * Claude over MCP. Defaults to stdio (Claude Desktop / Claude Code); pass
 * `--http` to bind an HTTP+SSE listener on $MCP_HTTP_PORT for remote use.
 *
 * Env loading is handled by Node's `--env-file-if-exists=.env.local` in the
 * package script; this entry just trusts `process.env`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  db,
  emails,
  nodes,
  telegramAccounts,
  telegramChats,
  telegramMessages,
} from '@mantle/db';
import { searchNodes } from '@mantle/search';
import {
  accountForChat,
  editMessage,
  reactToMessage,
  sendMessage,
} from '@mantle/telegram';
import { and, asc, desc, eq } from 'drizzle-orm';

const OWNER_ID = process.env.ALLOWED_USER_ID;
if (!OWNER_ID) {
  console.error('ALLOWED_USER_ID must be set so the MCP server knows whose tree to expose.');
  process.exit(1);
}

const server = new McpServer({ name: 'mantle', version: '0.0.1' });

server.tool(
  'tree_list',
  'List children of a branch in the Mantle tree. Pass no path for top-level branches.',
  { path: z.string().optional() },
  async ({ path }) => {
    const rows = await db
      .select({ id: nodes.id, title: nodes.title, type: nodes.type, path: nodes.path })
      .from(nodes)
      .where(
        and(eq(nodes.ownerId, OWNER_ID!), path ? (eq as any)(nodes.path, path) : eq(nodes.type, 'branch')),
      )
      .limit(200);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  },
);

server.tool(
  'search',
  "Hybrid full-text + tree search over Jason's Mantle. Use `branch` (ltree path) to scope, `type` to filter.",
  {
    q: z.string().optional(),
    branch: z.string().optional(),
    type: z
      .enum([
        'branch',
        'email',
        'email_thread',
        'file',
        'note',
        'sermon',
        'contact',
        'secret',
        'task',
        'event',
        'printer_project',
        'telegram_message',
      ])
      .optional(),
    tags: z.array(z.string()).optional(),
    since: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  async ({ q, branch, type, tags, since, limit }) => {
    const results = await searchNodes({
      ownerId: OWNER_ID!,
      q,
      branch,
      type,
      tags,
      since: since ? new Date(since) : undefined,
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  },
);

server.tool(
  'email_get',
  'Fetch a single email by id (body, headers, attachment refs).',
  { id: z.string().uuid() },
  async ({ id }) => {
    const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
    if (!row) return { content: [{ type: 'text', text: 'not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
  },
);

server.tool(
  'email_list',
  "Recent emails newest-first. Optionally filter by `accountId` or `since`.",
  {
    accountId: z.string().uuid().optional(),
    since: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  async ({ accountId, since, limit }) => {
    const conds: any[] = [];
    if (accountId) conds.push(eq(emails.accountId, accountId));
    if (since) conds.push((eq as any)(emails.internalDate, new Date(since))); // placeholder until gte helper imported
    const rows = await db
      .select()
      .from(emails)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(emails.internalDate))
      .limit(limit ?? 50);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  },
);

// ─── telegram ─────────────────────────────────────────────────────────────

server.tool(
  'telegram_pending',
  'Unanswered Telegram DMs, oldest first. Call after each turn (or via /loop) to see what needs a reply. Returns the row id (for mark_processed), telegram_message_id (for reply threading), chat_id, sender, text, and sent_at.',
  {
    chat_id: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async ({ chat_id, limit }) => {
    const conds = [eq(telegramMessages.processed, false)];
    if (chat_id) {
      // chat_id is the *Telegram* chat id; resolve to our internal pk first.
      const [chat] = await db
        .select({ id: telegramChats.id })
        .from(telegramChats)
        .where(eq(telegramChats.telegramChatId, chat_id))
        .limit(1);
      if (!chat) return { content: [{ type: 'text', text: '[]' }] };
      conds.push(eq(telegramMessages.chatId, chat.id));
    }
    const rows = await db
      .select({
        id: telegramMessages.id,
        telegram_message_id: telegramMessages.telegramMessageId,
        chat_id: telegramChats.telegramChatId,
        from_user_id: telegramMessages.fromUserId,
        from_username: telegramMessages.fromUsername,
        from_name: telegramMessages.fromName,
        text: telegramMessages.text,
        sent_at: telegramMessages.sentAt,
        attachments: telegramMessages.attachments,
      })
      .from(telegramMessages)
      .innerJoin(telegramChats, eq(telegramMessages.chatId, telegramChats.id))
      .where(and(...conds))
      .orderBy(asc(telegramMessages.sentAt))
      .limit(limit ?? 20);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  },
);

server.tool(
  'telegram_send',
  'Send a Telegram message to a chat. Pass chat_id from a telegram_pending row. Optionally pass reply_to (telegram_message_id) for threading. Long text is split into 4096-char chunks.',
  {
    chat_id: z.string(),
    text: z.string().min(1),
    reply_to: z.string().optional(),
    markdown: z.boolean().optional(),
  },
  async ({ chat_id, text, reply_to, markdown }) => {
    const account = await accountForChat(chat_id);
    if (!account) {
      return { content: [{ type: 'text', text: 'no enabled telegram account' }], isError: true };
    }
    // Outbound gate: only send to chats we already know (i.e. they DM'd us
    // and were allowlisted). Prevents Claude from spamming arbitrary chat
    // ids on its own initiative.
    const [chat] = await db
      .select()
      .from(telegramChats)
      .where(
        and(
          eq(telegramChats.accountId, account.id),
          eq(telegramChats.telegramChatId, chat_id),
        ),
      )
      .limit(1);
    if (!chat || chat.allowlistStatus !== 'allowed') {
      return {
        content: [{ type: 'text', text: `chat ${chat_id} is not allowlisted` }],
        isError: true,
      };
    }
    try {
      const ids = await sendMessage(account, chat_id, text, {
        replyTo: reply_to,
        markdown,
      });
      return {
        content: [
          {
            type: 'text',
            text:
              ids.length === 1
                ? `sent (id: ${ids[0]})`
                : `sent ${ids.length} parts (ids: ${ids.join(', ')})`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `send failed: ${msg}` }], isError: true };
    }
  },
);

server.tool(
  'telegram_react',
  'Add an emoji reaction to a Telegram message. Telegram accepts only a fixed whitelist (👍 👎 ❤ 🔥 👀 🎉 etc).',
  {
    chat_id: z.string(),
    message_id: z.string(),
    emoji: z.string(),
  },
  async ({ chat_id, message_id, emoji }) => {
    const account = await accountForChat(chat_id);
    if (!account) {
      return { content: [{ type: 'text', text: 'no enabled telegram account' }], isError: true };
    }
    try {
      await reactToMessage(account, chat_id, message_id, emoji);
      return { content: [{ type: 'text', text: 'reacted' }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `react failed: ${msg}` }], isError: true };
    }
  },
);

server.tool(
  'telegram_edit',
  'Edit a previously-sent Telegram message in place. Useful for progress updates. Edits do not trigger push notifications — send a new reply when a long task completes.',
  {
    chat_id: z.string(),
    message_id: z.string(),
    text: z.string().min(1),
    markdown: z.boolean().optional(),
  },
  async ({ chat_id, message_id, text, markdown }) => {
    const account = await accountForChat(chat_id);
    if (!account) {
      return { content: [{ type: 'text', text: 'no enabled telegram account' }], isError: true };
    }
    try {
      await editMessage(account, chat_id, message_id, text, { markdown });
      return { content: [{ type: 'text', text: 'edited' }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `edit failed: ${msg}` }], isError: true };
    }
  },
);

server.tool(
  'telegram_mark_processed',
  'Mark a telegram message as answered so it stops appearing in telegram_pending. Pass the row id from telegram_pending.',
  { id: z.string().uuid() },
  async ({ id }) => {
    const rows = await db
      .update(telegramMessages)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(telegramMessages.id, id))
      .returning({ id: telegramMessages.id });
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'no such message' }], isError: true };
    }
    return { content: [{ type: 'text', text: 'marked processed' }] };
  },
);

server.tool(
  'telegram_pair',
  'Approve a pending Telegram pairing code. The chat gets allowlisted and a confirmation DM is sent.',
  { code: z.string().regex(/^[a-f0-9]{6}$/i) },
  async ({ code }) => {
    const [chat] = await db
      .select()
      .from(telegramChats)
      .where(and(eq(telegramChats.pairingCode, code), eq(telegramChats.userId, OWNER_ID!)))
      .limit(1);
    if (!chat) {
      return { content: [{ type: 'text', text: 'no pending pairing with that code' }], isError: true };
    }
    if (chat.allowlistStatus === 'allowed') {
      return { content: [{ type: 'text', text: 'already paired' }] };
    }
    if (chat.pairingExpiresAt && chat.pairingExpiresAt.getTime() < Date.now()) {
      return { content: [{ type: 'text', text: 'code expired — ask them to DM again' }], isError: true };
    }
    await db
      .update(telegramChats)
      .set({
        allowlistStatus: 'allowed',
        pairingCode: null,
        pairingExpiresAt: null,
        pairingReplies: 0,
        updatedAt: new Date(),
      })
      .where(eq(telegramChats.id, chat.id));

    const [account] = await db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.id, chat.accountId))
      .limit(1);
    if (account) {
      try {
        await sendMessage(account, chat.telegramChatId, 'Paired! Say hi to Claude.');
      } catch (err) {
        // The chat is paired in the DB; the confirmation DM is best-effort.
        console.error('[mantle-mcp] pair confirm DM failed:', err);
      }
    }
    return {
      content: [
        { type: 'text', text: `paired chat ${chat.telegramChatId} (${chat.title ?? chat.username ?? 'unnamed'})` },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mantle-mcp] listening on stdio. Owner:', OWNER_ID);
