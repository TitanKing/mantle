import { requireOwner } from '@/lib/auth';
import { listEvents, countEvents } from '@/lib/events';
import { SetPageTitle } from '@/components/layout/page-title';
import { EventsClient } from './events-client';

const PAGE_SIZE = 50;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; window?: string }>;
}) {
  const user = await requireOwner();
  const sp = await searchParams;

  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || undefined;
  const window = sp.window === 'past' || sp.window === 'all' ? sp.window : 'upcoming';
  const opts = { query, window } as const;

  const [rows, total] = await Promise.all([
    listEvents(user.id, { ...opts, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countEvents(user.id, opts),
  ]);

  return (
    <>
      <SetPageTitle title="Events" />
      <EventsClient
        initialEvents={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        query={query ?? ''}
        window={window}
      />
    </>
  );
}
