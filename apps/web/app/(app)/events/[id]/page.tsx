import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { EventDetailClient } from './event-detail-client';

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  const row = await getEvent(user.id, id);
  if (!row) notFound();
  return (
    <div className="mx-auto max-w-3xl py-2">
      <EventDetailClient initial={row} />
    </div>
  );
}
