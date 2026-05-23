/**
 * Email builtin — lets an agent SEND mail from the user's own mailbox via SMTP
 * submission (the provider relays it; we never run our own MTA). The send-enable
 * config lives on `email_accounts` (smtp_host/port/secure); the password is the
 * same app-password already sealed for IMAP. See docs/email-send.md.
 *
 * Gate: requiresConfirm is FALSE (operator choice) — flip it per-row at
 * /settings/tools if injected-send ever becomes a concern.
 */

import { and, eq } from 'drizzle-orm';
import { db, emailAccounts, type EmailAccount } from '@mantle/db';
import { accountCanSend, sendEmail } from '@mantle/email';
import type { BuiltinToolDef } from './types';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function strOpt(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
/** Split a comma-separated recipient string into one-or-many. */
function recipients(raw: string): string | string[] {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length <= 1 ? (parts[0] ?? raw) : parts;
}

/** Pick the account to send from: an explicit `from` address if it matches one
 *  of the user's accounts, else the first enabled account with SMTP configured. */
async function resolveSendAccount(
  ownerId: string,
  fromAddr?: string,
): Promise<EmailAccount | null> {
  const rows = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.userId, ownerId), eq(emailAccounts.enabled, true)));
  if (fromAddr) {
    const match = rows.find((r) => r.address.toLowerCase() === fromAddr.toLowerCase());
    if (match) return accountCanSend(match) ? match : null;
  }
  return rows.find(accountCanSend) ?? null;
}

const email_send: BuiltinToolDef = {
  slug: 'email_send',
  name: 'Send an email',
  description:
    "Send an email FROM the user's own mailbox via their provider's SMTP. Provide `to`, `subject`, and a plain-text `body`. Optional `cc`/`bcc`, and `from` to choose which of the user's accounts sends it (defaults to the first send-enabled account). Use only when the user explicitly asks to send or email something. The message goes out under the user's real address, so write it accurately and professionally; when relaying research, include the source links in the body. If no account has SMTP configured the call fails with a clear message.",
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'recipient email (comma-separate for multiple)' },
      subject: { type: 'string' },
      body: { type: 'string', description: 'plain-text body' },
      cc: { type: 'string', description: 'optional cc (comma-separate for multiple)' },
      bcc: { type: 'string', description: 'optional bcc (comma-separate for multiple)' },
      from: {
        type: 'string',
        description: "optional: which of the user's account addresses to send from",
      },
    },
    required: ['to', 'subject', 'body'],
  },
  handler: async (input, ctx) => {
    const to = str(input.to).trim();
    const subject = str(input.subject).trim();
    const body = str(input.body);
    if (!to) return { ok: false, error: 'to is required' };
    if (!subject) return { ok: false, error: 'subject is required' };
    if (!body) return { ok: false, error: 'body is required' };

    const account = await resolveSendAccount(ctx.ownerId, strOpt(input.from));
    if (!account) {
      return {
        ok: false,
        error:
          'no send-enabled email account found — configure SMTP host/port on an account at /settings/accounts',
      };
    }

    const cc = strOpt(input.cc);
    const bcc = strOpt(input.bcc);
    try {
      const res = await sendEmail(account, {
        to: recipients(to),
        subject,
        text: body,
        ...(cc ? { cc: recipients(cc) } : {}),
        ...(bcc ? { bcc: recipients(bcc) } : {}),
      });
      ctx.step?.setMeta({ from: account.address, to, subject, message_id: res.messageId });
      ctx.step?.setOutput({
        messageId: res.messageId,
        accepted: res.accepted,
        rejected: res.rejected,
      });
      return {
        ok: true,
        output: {
          from: account.address,
          to,
          subject,
          messageId: res.messageId,
          accepted: res.accepted,
          rejected: res.rejected,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const EMAIL_TOOLS: BuiltinToolDef[] = [email_send];
