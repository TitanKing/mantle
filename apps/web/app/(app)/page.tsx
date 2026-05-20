import { LayoutDashboard } from 'lucide-react';
import { requireOwner } from '@/lib/auth';

/**
 * Landing page. Intentionally an empty dashboard for now — the inbox
 * moved to /inbox. This is the slot for at-a-glance widgets (recent
 * activity, spend, pending review, today's events) once they're built.
 */
export default async function DashboardPage() {
  await requireOwner();

  return (
    <div className="mx-auto max-w-xl space-y-3 px-6 py-24 text-center">
      <LayoutDashboard className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-xl font-semibold">Dashboard</h2>
      <p className="text-sm text-muted-foreground">
        Nothing here yet. This is where your at-a-glance overview will live. Your mail moved
        to <a href="/inbox" className="underline underline-offset-4">Inbox</a>.
      </p>
    </div>
  );
}
