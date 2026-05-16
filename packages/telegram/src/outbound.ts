import { eq } from 'drizzle-orm';
import { db, telegramAccounts, type TelegramAccount } from '@mantle/db';
import type { ReactionTypeEmoji } from 'grammy/types';
import { botFor } from './client';

const MAX_CHUNK = 4096;

/**
 * Sends a chat message to `chatId` from the given account, splitting on
 * 4096-char chunks. Returns Telegram message_ids for the sent parts.
 */
export async function sendMessage(
  account: TelegramAccount,
  chatId: string,
  text: string,
  options?: { replyTo?: string; markdown?: boolean },
): Promise<number[]> {
  const bot = botFor(account);
  const chunks = chunkText(text, MAX_CHUNK);
  const replyTo = options?.replyTo != null ? Number(options.replyTo) : undefined;
  const parseMode = options?.markdown ? ('MarkdownV2' as const) : undefined;
  const ids: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const sent = await bot.api.sendMessage(chatId, chunks[i]!, {
      ...(replyTo != null && i === 0 ? { reply_parameters: { message_id: replyTo } } : {}),
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
    ids.push(sent.message_id);
  }
  return ids;
}

export async function reactToMessage(
  account: TelegramAccount,
  chatId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const bot = botFor(account);
  await bot.api.setMessageReaction(chatId, Number(messageId), [
    { type: 'emoji', emoji: emoji as ReactionTypeEmoji['emoji'] },
  ]);
}

export async function editMessage(
  account: TelegramAccount,
  chatId: string,
  messageId: string,
  text: string,
  options?: { markdown?: boolean },
): Promise<void> {
  const bot = botFor(account);
  const parseMode = options?.markdown ? ('MarkdownV2' as const) : undefined;
  await bot.api.editMessageText(
    chatId,
    Number(messageId),
    text,
    ...(parseMode ? [{ parse_mode: parseMode }] : []),
  );
}

/**
 * Lookup helper for tools that get `chat_id` (Telegram's id) but need the
 * underlying account. Picks the first enabled account that has seen this
 * chat — good enough for v1 since users typically run one bot.
 */
export async function accountForChat(_chatId: string): Promise<TelegramAccount | null> {
  // For now, just return the first enabled account; multi-bot routing comes
  // later. Lookup is by chat would require a join through telegram_chats,
  // and we'd need to handle the "chat hasn't been seen yet" case anyway.
  const [account] = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.enabled, true))
    .limit(1);
  return account ?? null;
}

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const para = rest.lastIndexOf('\n\n', limit);
    const line = rest.lastIndexOf('\n', limit);
    const space = rest.lastIndexOf(' ', limit);
    const cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}
