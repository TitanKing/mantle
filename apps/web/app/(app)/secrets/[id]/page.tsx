import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth';
import { getSecretMetadata } from '@/lib/secrets';
import { SecretDetailClient } from './secret-detail-client';

export default async function SecretDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  const row = await getSecretMetadata(user.id, id);
  if (!row) notFound();
  return (
    <div className="mx-auto max-w-3xl py-2">
      <SecretDetailClient initial={row} />
    </div>
  );
}
