import { requireOwner } from '@/lib/auth';
import { listToolsForOwner } from '@/lib/tools';
import { ToolsClient } from './tools-client';

export default async function ToolsPage() {
  const user = await requireOwner();
  const rows = await listToolsForOwner(user.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Tools</h1>
        <p className="text-sm text-muted-foreground">
          Every callable an agent can invoke during a turn. <strong>Built-in</strong>{' '}
          tools are TS handlers seeded by the agent runner on boot; their definitions
          live in <code>packages/tools/src/builtins.ts</code> and edits require a
          restart. <strong>HTTP</strong> + <strong>shell</strong> tools are user-defined
          here.
        </p>
        <p className="rounded-md border border-amber-400/40 bg-amber-100/30 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          <strong>Confirmation flow not yet wired:</strong> tools marked{' '}
          <em>requires confirm</em> auto-run in v1. The pending-call queue + operator
          approval pause lands in phase 5b.
        </p>
      </header>
      <ToolsClient initialTools={rows} />
    </div>
  );
}
