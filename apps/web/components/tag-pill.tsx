import { cn } from '@/lib/utils';

/**
 * Theme categorical palette (chart-1..5). Full literal class strings so the
 * Tailwind scanner emits them. Tinted background + same-hue text + soft
 * border reads cleanly in both light and dark themes, and recolors with
 * whatever theme is active.
 */
const TAG_COLORS = [
  'border-chart-1/30 bg-chart-1/15 text-chart-1',
  'border-chart-2/30 bg-chart-2/15 text-chart-2',
  'border-chart-3/30 bg-chart-3/15 text-chart-3',
  'border-chart-4/30 bg-chart-4/15 text-chart-4',
  'border-chart-5/30 bg-chart-5/15 text-chart-5',
];

/** Deterministic color class for a tag — the same tag always maps to the
 *  same palette slot, so a tag looks consistent everywhere it appears. */
export function tagColorClass(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length]!;
}

/** Read-only colored tag pill. */
export function TagPill({ tag, className }: { tag: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        tagColorClass(tag),
        className,
      )}
    >
      {tag}
    </span>
  );
}
