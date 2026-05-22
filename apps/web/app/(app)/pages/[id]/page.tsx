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
  // No wrapper: the client owns its width (narrow/wide toggle) and the
  // chromeless canvas layout.
  return <PageDetailClient initial={row} />;
}
