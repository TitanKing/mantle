'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { seal } from '@mantle/crypto';
import { db, emailAccounts } from '@mantle/db';
import { probeImapConnection, probeSmtpConnection, unsealImapPassword } from '@mantle/email';
import { requireOwner } from '@/lib/auth';
import { accountBranchPath } from '@/lib/account-branch';

const FormSchema = z.object({
  // Present only when editing an existing account.
  accountId: z.string().uuid().optional(),
  // Optional because edit uses the stored address (the account identity).
  address: z.string().email().optional(),
  displayName: z.string().optional(),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(993),
  secure: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'on' || v === 'true'),
  // Optional: blank on edit means "keep the stored password".
  password: z.string().optional(),
  // How far back the first scan reaches, in days. Default ≈ the old 12 months.
  firstScanDays: z.coerce.number().int().min(1).max(3650).default(365),
  // SMTP submission (sending). Optional — leave host/port blank to keep the
  // account read-only. Same app password as IMAP. secure: TLS(465)/STARTTLS(587).
  smtpHost: z.string().min(1).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'on' || v === 'true'),
});

export type ImapFormResult =
  | { intent: 'test'; ok: true; foldersFound: number; folderSample: string[]; serverName?: string }
  | { intent: 'test'; ok: false; error: string }
  | { intent: 'save'; ok: false; error: string };
// Successful saves redirect, so there's no "save: ok=true" shape.

function parseForm(form: FormData) {
  return FormSchema.safeParse({
    accountId: form.get('accountId') || undefined,
    address: form.get('address') || undefined,
    displayName: form.get('displayName') ?? undefined,
    host: form.get('host'),
    port: form.get('port'),
    secure: form.get('secure') ?? false,
    password: form.get('password') || undefined,
    firstScanDays: form.get('firstScanDays'),
    smtpHost: form.get('smtpHost') || undefined,
    smtpPort: form.get('smtpPort') || undefined,
    smtpSecure: form.get('smtpSecure') ?? false,
  });
}

function explainError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Tighten a few common IMAP errors into plain English.
  if (/authentication/i.test(raw)) return 'Authentication failed — check the email address and app password.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) return 'Could not resolve that host. Check the IMAP host.';
  if (/ECONNREFUSED/i.test(raw)) return 'Connection refused — wrong port, or the server isn\'t listening there.';
  if (/ETIMEDOUT|timeout/i.test(raw)) return 'Timed out connecting. Check the host, port, and TLS toggle.';
  if (/self.signed certificate|unable to verify/i.test(raw)) return 'TLS certificate problem. If you trust this host, try toggling TLS off and using a STARTTLS port.';
  return raw;
}

export async function handleImapForm(
  _prev: ImapFormResult | undefined,
  form: FormData,
): Promise<ImapFormResult> {
  const user = await requireOwner();
  const intent = String(form.get('intent') ?? 'save') as 'test' | 'save';

  const parsed = parseForm(form);
  if (!parsed.success) {
    return { intent, ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { accountId, address, displayName, host, port, secure, password, firstScanDays, smtpHost, smtpPort, smtpSecure } =
    parsed.data;

  // Edit mode: load the target account (owner-scoped). Its stored address is
  // the identity — we never change it (it's the unique key + the seal AAD).
  const existing = accountId
    ? (
        await db
          .select()
          .from(emailAccounts)
          .where(and(eq(emailAccounts.id, accountId), eq(emailAccounts.userId, user.id)))
          .limit(1)
      )[0]
    : undefined;
  if (accountId && !existing) {
    return { intent, ok: false, error: 'Account not found.' };
  }

  const effectiveAddress = existing?.address ?? address;
  if (!effectiveAddress) {
    return { intent, ok: false, error: 'Email address is required.' };
  }

  // Resolve the password to probe/save with. On edit a blank field reuses the
  // stored one; on add it's required.
  let effectivePassword = password;
  if (!effectivePassword) {
    if (existing) {
      try {
        effectivePassword = unsealImapPassword(existing);
      } catch {
        return {
          intent,
          ok: false,
          error: 'Stored password could not be read — re-enter the app password.',
        };
      }
    } else {
      return { intent, ok: false, error: 'App password is required.' };
    }
  }

  // Always probe — for `test` it's the whole point, for `save` it's a guardrail.
  let probe;
  try {
    probe = await probeImapConnection({
      host,
      port,
      secure,
      user: effectiveAddress,
      pass: effectivePassword,
    });
  } catch (err) {
    return { intent, ok: false, error: explainError(err) };
  }

  // If SMTP submission is configured, verify it too (same app password) — a
  // typo guardrail so sending doesn't silently fail later at send time.
  if (smtpHost && smtpPort) {
    try {
      await probeSmtpConnection({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        user: effectiveAddress,
        pass: effectivePassword,
      });
    } catch (err) {
      return { intent, ok: false, error: `SMTP: ${explainError(err)}` };
    }
  }

  if (intent === 'test') {
    return {
      intent: 'test',
      ok: true,
      foldersFound: probe.folders.length,
      // Show a handful so the user can confirm it's their account, not someone else's.
      folderSample: probe.folders.slice(0, 6),
      serverName: probe.serverGreeting,
    };
  }

  // intent === 'save'
  if (existing) {
    // Update connection knobs + history window. Re-seal the password only when
    // a new one was typed (AAD bound to the unchanged stored address).
    await db
      .update(emailAccounts)
      .set({
        imapHost: host,
        imapPort: port,
        imapSecure: secure,
        smtpHost: smtpHost ?? null,
        smtpPort: smtpPort ?? null,
        smtpSecure,
        displayName: displayName ?? null,
        firstScanDays,
        enabled: true,
        lastSyncError: null,
        updatedAt: new Date(),
        ...(password
          ? {
              imapConfigEnc: seal(JSON.stringify({ password }), `imap:${user.id}:${existing.address}`)
                .ciphertext,
            }
          : {}),
      })
      .where(and(eq(emailAccounts.id, existing.id), eq(emailAccounts.userId, user.id)));
  } else {
    const sealed = seal(JSON.stringify({ password: effectivePassword }), `imap:${user.id}:${effectiveAddress}`);
    await db
      .insert(emailAccounts)
      .values({
        userId: user.id,
        provider: 'imap',
        address: effectiveAddress,
        displayName: displayName ?? null,
        imapHost: host,
        imapPort: port,
        imapSecure: secure,
        smtpHost: smtpHost ?? null,
        smtpPort: smtpPort ?? null,
        smtpSecure,
        imapConfigEnc: sealed.ciphertext,
        ingestPolicy: 'approve_list',
        branchPath: accountBranchPath(effectiveAddress),
        firstScanDays,
      })
      .onConflictDoUpdate({
        target: [emailAccounts.userId, emailAccounts.address],
        set: {
          imapHost: host,
          imapPort: port,
          imapSecure: secure,
          smtpHost: smtpHost ?? null,
          smtpPort: smtpPort ?? null,
          smtpSecure,
          imapConfigEnc: sealed.ciphertext,
          firstScanDays,
          enabled: true,
          lastSyncError: null,
          // branchPath is *not* reset on re-connect — preserves the existing
          // ltree location for any mail already ingested under it.
        },
      });
  }

  revalidatePath('/settings/accounts');
  redirect('/settings/accounts');
}
