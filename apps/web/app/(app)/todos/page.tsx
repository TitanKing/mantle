import { requireOwner } from '@/lib/auth';
import { listTodos } from '@/lib/todos';
import { TodosClient } from './todos-client';

export default async function TodosPage() {
  const user = await requireOwner();
  const rows = await listTodos(user.id);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Todos</h1>
        <p className="text-sm text-muted-foreground">
          Tasks with status, priority, due dates, and notes. The
          extractor surfaces status / priority / due into the summary so
          the assistant knows what&apos;s open and what&apos;s urgent.
        </p>
      </header>
      <TodosClient initialTodos={rows} />
    </div>
  );
}
