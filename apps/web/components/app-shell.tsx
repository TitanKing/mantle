'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import { LiveColumn } from '@/components/layout/live-column';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ToastProvider } from '@/components/ui/toast';
import { PageTitleProvider } from '@/components/layout/page-title';

/**
 * App shell — three fixed regions (header, left sidebar, right live
 * column) framing a scrollable content area. The sidebar collapses into
 * a Sheet drawer below md. The server-rendered context+cost card is
 * passed in as a prop.
 */
export function AppShell({
  email,
  userAvatar,
  pendingSenders,
  pendingApprovals,
  contextCard,
  children,
}: {
  email: string | null;
  userAvatar?: { style: string; seed: string } | null;
  pendingSenders: number;
  pendingApprovals: number;
  contextCard: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const body = (onNavigate?: () => void) => (
    <>
      {contextCard}
      <SidebarNav
        pendingSenders={pendingSenders}
        pendingApprovals={pendingApprovals}
        onNavigate={onNavigate}
      />
    </>
  );

  return (
    <ToastProvider>
      <PageTitleProvider>
      <div className="h-screen bg-background">
        <Header email={email} userAvatar={userAvatar} onMenuClick={() => setMobileOpen(true)} />

        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-80 flex-col border-r bg-sidebar pt-16 md:flex">
          <div className="flex-1 overflow-y-auto scrollbar-thin">{body()}</div>
        </aside>

        {/* Mobile sidebar drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-80 overflow-y-auto p-0 pt-4 scrollbar-thin">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {body(() => setMobileOpen(false))}
          </SheetContent>
        </Sheet>

        {/* Right live-activity column */}
        <LiveColumn />

        {/* Content area */}
        <main className="fixed inset-0 top-16 overflow-y-auto scrollbar-thin md:left-80 lg:right-80">
          {children}
        </main>
      </div>
      </PageTitleProvider>
    </ToastProvider>
  );
}
