import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth';
import { getTrace } from '@/lib/traces';
import { SetPageTitle } from '@/components/layout/page-title';
import { BackLink } from '@/components/layout/back-link';
import { TraceDetailView } from '../trace-detail-view';

export default async function TraceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  const trace = await getTrace(user.id, id);
  if (!trace) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <SetPageTitle title={trace.kind} />
      <BackLink href="/traces">Traces</BackLink>
      <TraceDetailView trace={trace} />
    </div>
  );
}
