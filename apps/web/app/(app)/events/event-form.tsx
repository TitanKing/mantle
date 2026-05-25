'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TagInput } from '@/components/tag-input';

export const REMIND_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: 'At start' },
  { value: 5, label: '5 min before' },
  { value: 15, label: '15 min before' },
  { value: 60, label: '1 hour before' },
  { value: 60 * 24, label: '1 day before' },
];

/** Form state — datetimes as `datetime-local` strings, tags as string[]. */
export type EventFormValues = {
  title: string;
  body: string;
  startsAt: string;
  endsAt: string;
  location: string;
  remindMinutesBefore: number;
  tags: string[];
};

/** Normalized payload for the API (ISO instants, nulls for cleared fields). */
export type EventPayload = {
  title: string;
  body: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  remindMinutesBefore: number;
  tags: string[];
  timezone?: string;
};

/** ISO → the value a `<input type="datetime-local">` accepts (local wall time). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export const emptyEventForm = (): EventFormValues => ({
  title: '',
  body: '',
  startsAt: '',
  endsAt: '',
  location: '',
  remindMinutesBefore: 0,
  tags: [],
});

export function eventToForm(e: {
  title: string;
  body: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  remindMinutesBefore: number;
  tags: string[];
}): EventFormValues {
  return {
    title: e.title,
    body: e.body,
    startsAt: isoToLocalInput(e.startsAt),
    endsAt: isoToLocalInput(e.endsAt),
    location: e.location ?? '',
    remindMinutesBefore: e.remindMinutesBefore,
    tags: e.tags,
  };
}

/**
 * Shared event editor body — used by the master-detail "create" pane and the
 * EventDetail "edit" mode. Owns its field state; the parent POSTs/PATCHes the
 * normalized payload in `onSubmit` and switches view on success.
 */
export function EventForm({
  initial,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: EventFormValues;
  submitLabel: string;
  submitting?: boolean;
  onSubmit: (payload: EventPayload) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EventFormValues>(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) return setError('Title is required');
    if (!form.startsAt) return setError('Start time is required');
    await onSubmit({
      title: form.title.trim(),
      body: form.body,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      location: form.location.trim() || null,
      remindMinutesBefore: form.remindMinutesBefore,
      tags: form.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="event-title">Title</Label>
        <Input
          id="event-title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. Dentist appointment"
          autoFocus
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="event-starts">Starts</Label>
          <Input
            id="event-starts"
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="event-ends">Ends (optional)</Label>
          <Input
            id="event-ends"
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="event-remind">Remind</Label>
          <select
            id="event-remind"
            value={form.remindMinutesBefore}
            onChange={(e) => setForm({ ...form, remindMinutesBefore: Number(e.target.value) })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {REMIND_PRESETS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="event-location">Location (optional)</Label>
          <Input
            id="event-location"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="Where?"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Tags</Label>
        <TagInput value={form.tags} onChange={(tags) => setForm({ ...form, tags })} placeholder="Add tags…" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="event-body">Notes</Label>
        <textarea
          id="event-body"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={5}
          placeholder="Anything to remember about this event."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
