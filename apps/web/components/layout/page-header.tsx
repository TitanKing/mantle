import { cn } from '@/lib/utils';

/**
 * Standard page header. Title uses the theme's default sans font (kept
 * distinct from the Bukhari logo wordmark), with an optional description
 * and a right-aligned actions slot. Owns its own padding + bottom border
 * so it sits flush at the top of a content area or FleetLayout header slot.
 */
export function PageHeader({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 border-b px-6 py-4', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="mt-1.5 truncate text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
