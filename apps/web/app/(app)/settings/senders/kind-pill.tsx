import Link from 'next/link';
import type { DeliveryKind } from '@mantle/email';

/**
 * Soft hint pill stamped next to a sender's address when one delivery kind
 * dominates their traffic. Clickable — tapping a pill narrows the list to
 * that kind on the current tab (matches the filter-chip behaviour above).
 *
 * `direct` deliberately renders nothing — it's the default, and a pill on
 * every human sender would just be noise. `null` from `dominantKind()`
 * (not enough signal, or mixed-use) also renders nothing.
 *
 * Colour tokens stay inside the theme: muted for "informational" kinds
 * (`list`, `automated`), accent for `marketing` — the one that drives
 * operator action. No hardcoded hex per apps/web/CLAUDE.md.
 */
export function KindPill({
  kind,
  hrefBase,
}: {
  kind: DeliveryKind | null;
  /** Pathname-with-existing-query (e.g. `/settings/senders?tab=pending&q=foo`)
   *  the pill should link to with `&kind=…` appended. */
  hrefBase: string;
}) {
  if (!kind || kind === 'direct') return null;
  const meta = KIND_META[kind];
  const sep = hrefBase.includes('?') ? '&' : '?';
  const href = `${hrefBase}${sep}kind=${kind}`;
  return (
    <Link
      href={href}
      title={`Filter to ${kind} senders`}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-none ${meta.cls}`}
    >
      <span aria-hidden>{meta.icon}</span>
      <span>{kind}</span>
    </Link>
  );
}

/** Per-kind icon + theme-tokened class. Marketing gets the accent treatment
 *  (it's the actionable one); the others stay muted. */
const KIND_META: Record<Exclude<DeliveryKind, 'direct'>, { icon: string; cls: string }> = {
  marketing: {
    icon: '📣',
    cls: 'bg-accent text-accent-foreground hover:bg-accent/80',
  },
  list: {
    icon: '📋',
    cls: 'bg-muted text-muted-foreground hover:bg-muted/70',
  },
  automated: {
    icon: '🤖',
    cls: 'bg-muted text-muted-foreground hover:bg-muted/70',
  },
};
