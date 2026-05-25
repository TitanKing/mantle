import { requireOwner } from '@/lib/auth';
import { listTodos } from '@/lib/todos';
import { SetPageTitle } from '@/components/layout/page-title';
import { TodosClient } from './todos-client';

export default async function TodosPage() {
  const user = await requireOwner();
  const rows = await listTodos(user.id);
  return (
    <>
      <SetPageTitle title="Todos" />
      <TodosClient initialTodos={rows} />
    </>
  );
}
