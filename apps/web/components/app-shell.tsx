'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Mobile-responsive shell. Server-rendered sidebar + topbar + content
 * are passed in as props; this client wrapper owns only the drawer state.
 *
 * Behaviour:
 *  - >= md (≥768px): two-column grid, sidebar permanently visible.
 *  - <  md: single column. Sidebar is a slide-over drawer triggered by
 *    a hamburger placed in the top-left of the topbar row. Backdrop +
 *    Esc + route-change all close it. Body scroll locked while open.
 *
 * The hamburger is rendered absolutely so we don't double the topbar's
 * height on mobile — it sits on top of the topbar's left padding area.
 */
export function AppShell({
  sidebar,
  topbar,
  children,
}: {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close on navigation so tapping a link inside the drawer
  // doesn't leave it open on the next page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <ToastProvider>
    <div className="grid h-screen grid-cols-1 grid-rows-[48px_1fr] bg-background md:grid-cols-[260px_1fr]">
      <aside
        className={
          'fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-border bg-muted/95 backdrop-blur transition-transform duration-200 ease-out ' +
          'md:static md:row-span-2 md:translate-x-0 md:bg-muted/30 md:backdrop-blur-none ' +
          (open ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0')
        }
        aria-hidden={open ? undefined : true}
      >
        {sidebar}
      </aside>

      {/* The visual topbar — server-rendered. On mobile we overlay a
          hamburger in its left padding area; on desktop the topbar
          sits in the grid's right column on its own. */}
      <div className="relative col-start-1 row-start-1 md:col-start-2">
        {topbar}
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="absolute left-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Backdrop for mobile drawer. */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <main className="col-start-1 row-start-2 overflow-auto md:col-start-2">
        {children}
      </main>
    </div>
    </ToastProvider>
  );
}
