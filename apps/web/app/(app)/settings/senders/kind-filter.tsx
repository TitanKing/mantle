import Link from 'next/link';
import type { DeliveryKind } from '@mantle/email';

/**
 * Sub-tab filter row that restricts the current status tab to a single
 * delivery kind. Lives between the tabs (`pending / approved / denied`)
 * and the list itself; URL-driven via `?kind=`. Resetting page to 1 when
 * the filter changes is done by *not* propagating `page` in the chip hrefs
 * (the page link constructs a fresh query object), matching the existing
 * tab-link behaviour higher up.
 */
const CHIPS: Array<{ label: string; kind: DeliveryKind | null; icon: string }> = [
  { label: 'All', kind: null, icon: '✱' },
  { label: 'Direct', kind: 'direct', icon: '✉' },
  { label: 'Marketing', kind: 'marketing', icon: '📣' },
  { label: 'Lists', kind: 'list', icon: '📋' },
  { label: 'Automated', kind: 'automated', icon: '🤖' },
];

export function KindFilter({
  active,
  tab,
  search,
}: {
  active: DeliveryKind | null;
  tab: 'pending' | 'approved' | 'denied';
  search: string;
}) {
  return (
    <nav
      aria-label="Filter by delivery kind"
      className="-mt-2 flex flex-wrap items-center gap-1 text-xs"
    >
      {CHIPS.map((chip) => {
        const isActive = chip.kind === active;
        const query: Record<string, string> = { tab };
        if (search) query.q = search;
        if (chip.kind) query.kind = chip.kind;
        return (
          <Link
            key={chip.label}
            href={{ pathname: '/settings/senders', query }}
            className={
              isActive
                ? 'inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-background'
                : 'inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            }
          >
            <span aria-hidden>{chip.icon}</span>
            <span>{chip.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
