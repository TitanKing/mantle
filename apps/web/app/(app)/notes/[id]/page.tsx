import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth';
import { getNote } from '@/lib/notes';
import { NoteDetailClient } from './note-detail-client';

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  const row = await getNote(user.id, id);
  if (!row) notFound();
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <NoteDetailClient initial={row} />
    </div>
  );
}
