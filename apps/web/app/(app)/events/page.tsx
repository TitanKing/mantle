import { requireOwner } from '@/lib/auth';
import { listEvents } from '@/lib/events';
import { SetPageTitle } from '@/components/layout/page-title';
import { EventsClient } from './events-client';

export default async function EventsPage() {
  const user = await requireOwner();
  const [upcoming, past] = await Promise.all([
    listEvents(user.id, { window: 'upcoming' }),
    listEvents(user.id, { window: 'past' }),
  ]);
  return (
    <>
      <SetPageTitle title="Events" />
      <EventsClient initialUpcoming={upcoming} initialPast={past.slice(0, 25)} />
    </>
  );
}
