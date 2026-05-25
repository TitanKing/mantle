import { requireOwner } from '@/lib/auth';
import { listTodos, countTodos, type TodoStatus, type TodoPriority } from '@/lib/todos';
import { SetPageTitle } from '@/components/layout/page-title';
import { TodosClient } from './todos-client';

const PAGE_SIZE = 50;

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; priority?: string }>;
}) {
  const user = await requireOwner();
  const sp = await searchParams;

  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || undefined;
  const status = (sp.status?.trim() || 'open') as TodoStatus | 'all';
  const priority = (sp.priority?.trim() || 'all') as TodoPriority | 'all';
  const opts = { query, status, priority };

  const [rows, total] = await Promise.all([
    listTodos(user.id, { ...opts, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countTodos(user.id, opts),
  ]);

  return (
    <>
      <SetPageTitle title="Todos" />
      <TodosClient
        initialTodos={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        query={query ?? ''}
        status={status}
        priority={priority}
      />
    </>
  );
}
