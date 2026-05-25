import { requireOwner } from '@/lib/auth';
import { listSecrets, countSecrets, type SecretKind } from '@/lib/secrets';
import { SetPageTitle } from '@/components/layout/page-title';
import { SecretsClient } from './secrets-client';

const PAGE_SIZE = 50;

export default async function SecretsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; kind?: string }>;
}) {
  const user = await requireOwner();
  const sp = await searchParams;

  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || undefined;
  const kind = (sp.kind?.trim() || 'all') as SecretKind | 'all';
  const opts = { query, kind };

  const [rows, total] = await Promise.all([
    listSecrets(user.id, { ...opts, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countSecrets(user.id, opts),
  ]);

  return (
    <>
      <SetPageTitle title="Secrets" />
      <SecretsClient
        initialSecrets={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        query={query ?? ''}
        kind={kind}
      />
    </>
  );
}
