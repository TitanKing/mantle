'use client';

import { useEffect, useRef } from 'react';

/**
 * Subscribe to live node changes over SSE (/api/realtime). Calls `onChange`
 * whenever a node of one of the given `types` is created/ingested for the
 * current owner — e.g. `useRealtime(['event'], () => router.refresh())` makes a
 * server-rendered screen repaint the moment the data changes, no manual refresh.
 *
 * EventSource auto-reconnects with backoff, so transient drops self-heal. The
 * connection closes on unmount.
 */
export type RealtimeChange = { type: string; id: string };

export function useRealtime(types: string[], onChange: (c: RealtimeChange) => void): void {
  // Keep the latest callback without re-opening the stream each render.
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const key = types.join(',');
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const qs = key ? `?types=${encodeURIComponent(key)}` : '';
    const es = new EventSource(`/api/realtime${qs}`);
    es.onmessage = (e) => {
      try {
        cbRef.current(JSON.parse(e.data) as RealtimeChange);
      } catch {
        /* ignore malformed frame */
      }
    };
    // onerror: EventSource reconnects on its own; nothing to do.
    return () => es.close();
  }, [key]);
}
