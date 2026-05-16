import type { TelegramAttachment } from '@mantle/db';

/**
 * The shape `gate()` returns for a single inbound update.
 *
 * - `deliver` → message passed access checks; the worker inserts it.
 * - `pair`    → first DM from an unknown sender; we reply with a pairing code.
 * - `drop`    → silently ignored (denied, expired pairing, group not allowlisted).
 */
export type GateResult =
  | { action: 'deliver' }
  | { action: 'pair'; code: string; isResend: boolean }
  | { action: 'drop' };

/** Normalised inbound message shape — what `sync` hands to the persistor. */
export interface InboundMessage {
  /** Telegram update_id (used as the dedupe + ack key). */
  updateId: number;
  /** Telegram message_id within the chat. */
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group' | 'supergroup';
  chatTitle?: string;
  chatUsername?: string;
  fromUserId: string;
  fromUsername?: string;
  fromName?: string;
  text: string;
  sentAt: Date;
  attachments: TelegramAttachment[];
}
