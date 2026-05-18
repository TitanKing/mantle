import { requireOwner } from '@/lib/auth';
import { listEvents } from '@/lib/events';
import { EventsClient } from './events-client';

export default async function EventsPage() {
  const user = await requireOwner();
  const [upcoming, past] = await Promise.all([
    listEvents(user.id, { window: 'upcoming' }),
    listEvents(user.id, { window: 'past' }),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Events</h1>
        <p className="text-sm text-muted-foreground">
          Calendar items with reminders. The events worker pings your
          Telegram <em>remind-minutes-before</em> the start time. Set to
          0 to ping right when the event begins.
        </p>
      </header>
      <EventsClient initialUpcoming={upcoming} initialPast={past.slice(0, 25)} />
    </div>
  );
}
