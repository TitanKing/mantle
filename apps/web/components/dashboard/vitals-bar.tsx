import { cn } from '@/lib/utils';

/**
 * A simple labelled progress bar (no shadcn `progress` primitive exists).
 * Colour escalates with fill: primary → amber ≥75% → destructive ≥90%.
 * Shared by the System Vitals island (client) and Brain Stats (server) — no
 * 'use client' so it works in both.
 */
export function VitalsBar({
  pct,
  label,
  value,
  className,
}: {
  pct: number | null | undefined;
  label?: string;
  value?: string;
  className?: string;
}) {
  const known = pct != null && Number.isFinite(pct);
  const clamped = known ? Math.max(0, Math.min(100, pct)) : 0;
  const color = !known
    ? 'bg-muted-foreground/30'
    : clamped >= 90
      ? 'bg-destructive'
      : clamped >= 75
        ? 'bg-amber-500'
        : 'bg-primary';
  return (
    <div className={cn('space-y-1', className)}>
      {(label || value) && (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          {label && <span className="text-muted-foreground">{label}</span>}
          <span className="font-medium tabular-nums">
            {value ?? (known ? `${clamped.toFixed(0)}%` : '—')}
          </span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
