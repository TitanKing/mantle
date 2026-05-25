'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SetPageTitle } from '@/components/layout/page-title';
import { BackLink } from '@/components/layout/back-link';
import { EventDetail, type EventRow } from '../event-detail';

/**
 * Deep-link wrapper for /events/[id]. The master-detail list (/events) is the
 * primary surface; this route stays working as a shareable deep link, reusing
 * the same EventDetail (live countdown + edit/delete) with added page chrome.
 */
export function EventDetailClient({ initial }: { initial: EventRow }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  return (
    <>
      <SetPageTitle title={title} />
      <div className="px-6 pt-2">
        <BackLink href="/events">All events</BackLink>
      </div>
      <EventDetail
        event={initial}
        onUpdated={(e) => setTitle(e.title)}
        onDeleted={() => router.push('/events')}
      />
    </>
  );
}
