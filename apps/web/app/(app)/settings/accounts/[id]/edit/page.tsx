import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db, emailAccounts } from '@mantle/db';
import { requireOwner } from '@/lib/auth';
import { ImapForm } from '../../imap/imap-form';

/** Edit an existing IMAP account: connection knobs, history window, and an
 *  optional password rotation. The address is fixed (account identity). */
export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;

  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.id, id), eq(emailAccounts.userId, user.id)))
    .limit(1);
  if (!account) notFound();

  return (
    <div className="mx-auto max-w-md space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Edit account</h1>
        <p className="text-sm text-muted-foreground">{account.address}</p>
      </header>
      <ImapForm
        account={{
          id: account.id,
          address: account.address,
          displayName: account.displayName,
          imapHost: account.imapHost,
          imapPort: account.imapPort,
          imapSecure: account.imapSecure,
          firstScanDays: account.firstScanDays,
        }}
      />
      <p className="text-xs text-muted-foreground">
        <Link href="/settings/accounts" className="underline">
          ← Back to accounts
        </Link>
      </p>
    </div>
  );
}
