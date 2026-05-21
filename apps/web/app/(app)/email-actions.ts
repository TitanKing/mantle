'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { db, emailAccounts, emails } from '@mantle/db';
import { requireOwner } from '@/lib/auth';

/**
 * Flip the read state on one email. The WHERE clause is owner-scoped via
 * an account-id subquery so a stolen email UUID can't change another
 * user's mail. `revalidatePath('/inbox')` makes the inbox list re-render
 * with the new bold/unbold weight.
 */
export async function setEmailReadStatus(formData: FormData) {
  const user = await requireOwner();
  const emailId = String(formData.get('emailId') ?? '');
  const next = formData.get('read') === '1';
  if (!emailId) return;

  const ownedAccounts = db
    .select({ id: emailAccounts.id })
    .from(emailAccounts)
    .where(eq(emailAccounts.userId, user.id));

  await db
    .update(emails)
    .set({ isRead: next })
    .where(and(eq(emails.id, emailId), inArray(emails.accountId, ownedAccounts)));

  revalidatePath('/inbox');
}

/**
 * Flip the starred flag on one email. Local-only (Mantle does not write back
 * to the IMAP server). Owner-scoped exactly like `setEmailReadStatus`.
 */
export async function setEmailStarred(formData: FormData) {
  const user = await requireOwner();
  const emailId = String(formData.get('emailId') ?? '');
  const next = formData.get('starred') === '1';
  if (!emailId) return;

  const ownedAccounts = db
    .select({ id: emailAccounts.id })
    .from(emailAccounts)
    .where(eq(emailAccounts.userId, user.id));

  await db
    .update(emails)
    .set({ isStarred: next })
    .where(and(eq(emails.id, emailId), inArray(emails.accountId, ownedAccounts)));

  revalidatePath('/inbox');
}
