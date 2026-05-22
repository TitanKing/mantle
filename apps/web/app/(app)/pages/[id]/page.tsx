import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth';
import { getPage } from '@/lib/pages';
import { PageDetailClient } from './page-detail-client';

export default async function PageEditorRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  const row = await getPage(user.id, id);
  if (!row) notFound();
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageDetailClient initial={row} />
    </div>
  );
}
