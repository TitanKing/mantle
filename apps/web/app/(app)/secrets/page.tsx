import { requireOwner } from '@/lib/auth';
import { listSecrets } from '@/lib/secrets';
import { SetPageTitle } from '@/components/layout/page-title';
import { SecretsClient } from './secrets-client';

export default async function SecretsPage() {
  const user = await requireOwner();
  const rows = await listSecrets(user.id);

  return (
    <>
      <SetPageTitle title="Secrets" />
      <SecretsClient initialSecrets={rows} />
    </>
  );
}
