'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, MapPin, Plus } from 'lucide-react';
import { useRealtime } from '@/components/realtime/use-realtime';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { useNow } from '@/components/use-now';
import { dayGroup, eventState, formatRelativeShort, type DayGroup } from '@/lib/event-time';
import { EventForm, emptyEventForm, type EventPayload } from './event-form';
import { EventDetail, type EventRow } from './event-detail';

type Selection = { mode: 'create' } | { mode: 'view'; id: string } | null;

const GROUP_ORDER: DayGroup[] = ['today', 'tomorrow', 'this_week', 'later', 'past'];
const GROUP_LABEL: Record<DayGroup, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  later: 'Later',
  past: 'Past',
};

/** Date label for a card — pinned to en-GB so SSR matches the client. */
function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
}

export function EventsClient({
  initialUpcoming,
  initialPast,
}: {
  initialUpcoming: EventRow[];
  initialPast: EventRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const now = useNow(60_000); // minute tick drives live badges + grouping
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const [upcoming, setUpcoming] = useState(initialUpcoming);
  const [past, setPast] = useState(initialPast);
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<Selection>(() => {
    const first = initialUpcoming[0] ?? initialPast[0];
    return first ? { mode: 'view', id: first.id } : { mode: 'create' };
  });

  useEffect(() => setUpcoming(initialUpcoming), [initialUpcoming]);
  useEffect(() => setPast(initialPast), [initialPast]);

  // Live db-watch: Saskia adds an event / a reminder edit / another tab → refetch.
  useRealtime(['event'], () => router.refresh());

  const all = useMemo(() => [...upcoming, ...past], [upcoming, past]);
  const selected = sel?.mode === 'view' ? (all.find((e) => e.id === sel.id) ?? null) : null;

  // Group by day once mounted; before that, a flat upcoming→past list (SSR-safe).
  const groups = useMemo(() => {
    if (!now) return null;
    const buckets: Record<DayGroup, EventRow[]> = {
      today: [],
      tomorrow: [],
      this_week: [],
      later: [],
      past: [],
    };
    for (const e of all) buckets[dayGroup(e.startsAt, now, tz)].push(e);
    for (const k of GROUP_ORDER) buckets[k].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
    buckets.past.reverse(); // most-recent first
    return buckets;
  }, [now, all, tz]);

  const createEvent = async (payload: EventPayload) => {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `Could not save event (${res.status})`);
      return;
    }
    const { event } = (await res.json()) as { event: EventRow };
    if (new Date(event.startsAt).getTime() >= Date.now()) setUpcoming((p) => [event, ...p]);
    else setPast((p) => [event, ...p]);
    setSel({ mode: 'view', id: event.id });
    toast.success(`Saved “${event.title}”`);
    startTransition(() => router.refresh());
  };

  const onUpdated = (e: EventRow) => {
    setUpcoming((p) => p.map((x) => (x.id === e.id ? e : x)));
    setPast((p) => p.map((x) => (x.id === e.id ? e : x)));
    startTransition(() => router.refresh());
  };

  const onDeleted = (id: string) => {
    const next = all.filter((e) => e.id !== id);
    setUpcoming((p) => p.filter((e) => e.id !== id));
    setPast((p) => p.filter((e) => e.id !== id));
    setSel(next[0] ? { mode: 'view', id: next[0].id } : { mode: 'create' });
    startTransition(() => router.refresh());
  };

  const renderCard = (e: EventRow) => {
    const isSel = sel?.mode === 'view' && sel.id === e.id;
    const state = now ? eventState(e.startsAt, e.endsAt, now) : 'upcoming';
    const live = state === 'in_progress';
    const isPast = state === 'past';
    return (
      <button
        key={e.id}
        type="button"
        onClick={() => setSel({ mode: 'view', id: e.id })}
        className={cn(
          'block w-full rounded-lg border border-l-[3px] border-border border-l-border bg-card p-2.5 text-left transition-colors hover:bg-accent/40',
          isSel && 'border-l-primary bg-accent/50',
          live && !isSel && 'border-l-primary',
          isPast && !isSel && 'opacity-60',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{e.title}</span>
          <span className={cn('ml-auto shrink-0 text-xs tabular-nums', live ? 'font-medium text-primary' : 'text-muted-foreground')}>
            {now ? (live ? 'now' : formatRelativeShort(e.startsAt, now)) : ''}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{fmt(e.startsAt)}</div>
        {(e.location || e.tags.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            {e.location && (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="size-3" /> {e.location}
              </span>
            )}
            {e.tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                {t}
              </span>
            ))}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="md:grid md:h-full md:grid-cols-[340px_1fr] md:overflow-hidden">
      {/* ── Left: event list ─────────────────────────────────────── */}
      <div className="flex flex-col border-b border-border md:h-full md:min-h-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Events
          </h2>
          <Button type="button" size="sm" onClick={() => setSel({ mode: 'create' })}>
            <Plus /> New
          </Button>
        </div>
        <div className="space-y-3 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
          {all.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              No events yet. Click <strong>New</strong>, or ask Saskia (“remind me of my meeting at
              10am”).
            </p>
          ) : groups ? (
            GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => (
              <section key={g} className="space-y-2">
                <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {GROUP_LABEL[g]}
                </h3>
                <div className="space-y-2">{groups[g].map(renderCard)}</div>
              </section>
            ))
          ) : (
            // Pre-mount fallback: flat upcoming → past (matches SSR).
            <div className="space-y-2">{all.map(renderCard)}</div>
          )}
        </div>
      </div>

      {/* ── Right: create | detail | empty ───────────────────────── */}
      <div className="md:h-full md:min-h-0 md:overflow-y-auto md:scrollbar-thin">
        {sel?.mode === 'create' ? (
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-5 text-primary" aria-hidden />
              <h2 className="text-lg font-semibold">New event</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              The reminder fires the chosen lead time before the start and pings your most-recent
              Telegram chat.
            </p>
            <EventForm
              initial={emptyEventForm()}
              submitLabel="Save event"
              submitting={pending}
              onSubmit={createEvent}
              onCancel={() => {
                const first = all[0];
                setSel(first ? { mode: 'view', id: first.id } : { mode: 'create' });
              }}
            />
          </div>
        ) : selected ? (
          <EventDetail
            key={selected.id}
            event={selected}
            onUpdated={onUpdated}
            onDeleted={() => onDeleted(selected.id)}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
            Select an event, or add a new one.
          </div>
        )}
      </div>
    </div>
  );
}
