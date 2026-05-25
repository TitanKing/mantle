'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Compact prev/next pager for the master-detail list panes (the /pages
 * pattern). Renders nothing when there's a single page. `onGo` receives the
 * target page number; the caller pushes it through `useListNav`.
 */
export function ListPager({
  page,
  total,
  pageSize,
  pending = false,
  onGo,
}: {
  page: number;
  total: number;
  pageSize: number;
  pending?: boolean;
  onGo: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
      <span className="text-xs text-muted-foreground tabular-nums">
        {total} total · page {page} / {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          disabled={page <= 1 || pending}
          onClick={() => onGo(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          disabled={page >= totalPages || pending}
          onClick={() => onGo(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
