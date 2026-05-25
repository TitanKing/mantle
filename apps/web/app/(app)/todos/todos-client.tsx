'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ListTodo, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { TodoForm, emptyTodoForm, PRIORITIES, type Priority, type TodoPayload } from './todo-form';
import { TodoDetail, type Status, type TodoRow } from './todo-detail';

const STATUSES = ['open', 'done'] as const;
type Selection = { mode: 'create' } | { mode: 'view'; id: string } | null;

function dueLabel(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(diff / 86_400_000);
  if (Math.abs(days) < 1) return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days < 7) return `in ${days}d`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function TodosClient({ initialTodos }: { initialTodos: TodoRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [todos, setTodos] = useState(initialTodos);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('open');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<Selection>(() =>
    initialTodos[0] ? { mode: 'view', id: initialTodos[0].id } : { mode: 'create' },
  );

  useEffect(() => setTodos(initialTodos), [initialTodos]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return todos.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (q && !`${t.title} ${t.body} ${t.summary ?? ''} ${t.tags.join(' ')}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [todos, query, statusFilter, priorityFilter]);

  const selected = sel?.mode === 'view' ? (todos.find((t) => t.id === sel.id) ?? null) : null;

  const createTodo = async (payload: TodoPayload) => {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `Could not save todo (${res.status})`);
      return;
    }
    const { todo } = (await res.json()) as { todo: TodoRow };
    setTodos((prev) => [todo, ...prev]);
    setSel({ mode: 'view', id: todo.id });
    toast.success(`Added “${todo.title}”`);
    startTransition(() => router.refresh());
  };

  const saveTodo = async (id: string, payload: TodoPayload): Promise<boolean> => {
    const res = await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `Could not update todo (${res.status})`);
      return false;
    }
    const { todo } = (await res.json()) as { todo: TodoRow };
    setTodos((prev) => prev.map((t) => (t.id === id ? todo : t)));
    startTransition(() => router.refresh());
    return true;
  };

  const toggleStatus = async (t: TodoRow) => {
    const next: Status = t.status === 'open' ? 'done' : 'open';
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: next } : x))); // optimistic
    const res = await fetch(`/api/todos/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: t.status } : x))); // revert
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `Could not update todo (${res.status})`);
      return;
    }
    const { todo } = (await res.json()) as { todo: TodoRow };
    setTodos((prev) => prev.map((x) => (x.id === t.id ? todo : x)));
    startTransition(() => router.refresh());
  };

  const removeTodo = async (id: string) => {
    const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `Could not delete todo (${res.status})`);
      return;
    }
    toast.success('Todo deleted');
    setTodos((prev) => {
      const nextList = prev.filter((t) => t.id !== id);
      setSel(nextList[0] ? { mode: 'view', id: nextList[0].id } : { mode: 'create' });
      return nextList;
    });
    startTransition(() => router.refresh());
  };

  return (
    <div className="md:grid md:h-full md:grid-cols-[340px_1fr] md:overflow-hidden">
      {/* ── Left: todo list ──────────────────────────────────────── */}
      <div className="flex flex-col border-b border-border md:h-full md:min-h-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Todos</h2>
          <Button type="button" size="sm" onClick={() => setSel({ mode: 'create' })}>
            <Plus /> New
          </Button>
        </div>
        <div className="space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search todos…"
              className="h-9 pl-8"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Status | 'all')}
              className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Filter by status"
            >
              <option value="all">All status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')}
              className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Filter by priority"
            >
              <option value="all">All priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              {todos.length === 0 ? (
                <>
                  No todos yet. Click <strong>New</strong> to add one.
                </>
              ) : (
                'No todos match your filters.'
              )}
            </p>
          ) : (
            filtered.map((t) => {
              const isSel = sel?.mode === 'view' && sel.id === t.id;
              const done = t.status === 'done';
              const overdue = !!t.dueAt && new Date(t.dueAt) < new Date() && !done;
              return (
                <div
                  key={t.id}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg border border-l-[3px] border-border border-l-border bg-card p-2.5 transition-colors',
                    isSel ? 'border-l-primary bg-accent/50' : 'hover:bg-accent/40',
                    t.priority === 'high' && !isSel && 'border-l-destructive',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleStatus(t)}
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                      done ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-muted',
                    )}
                    aria-label={done ? 'Mark open' : 'Mark done'}
                    aria-pressed={done}
                  >
                    {done && <Check className="size-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSel({ mode: 'view', id: t.id })}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className={cn('truncate text-sm font-medium', done && 'text-muted-foreground line-through')}>
                        {t.title}
                      </span>
                      {t.dueAt && (
                        <span
                          className={cn(
                            'ml-auto shrink-0 text-xs tabular-nums',
                            overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                          )}
                        >
                          {dueLabel(t.dueAt)}
                        </span>
                      )}
                    </div>
                    {(t.body || t.summary) && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{t.body || t.summary}</p>
                    )}
                    {t.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: create | detail | empty ───────────────────────── */}
      <div className="md:h-full md:min-h-0 md:overflow-y-auto md:scrollbar-thin">
        {sel?.mode === 'create' ? (
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-2">
              <ListTodo className="size-5 text-primary" aria-hidden />
              <h2 className="text-lg font-semibold">New todo</h2>
            </div>
            <TodoForm
              initial={emptyTodoForm()}
              submitLabel="Save todo"
              submitting={pending}
              onSubmit={createTodo}
              onCancel={() =>
                setSel(todos[0] ? { mode: 'view', id: todos[0].id } : { mode: 'create' })
              }
            />
          </div>
        ) : selected ? (
          <TodoDetail
            key={selected.id}
            todo={selected}
            onToggleStatus={() => toggleStatus(selected)}
            onSave={(payload) => saveTodo(selected.id, payload)}
            onDelete={() => removeTodo(selected.id)}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
            Select a todo, or add a new one.
          </div>
        )}
      </div>
    </div>
  );
}
