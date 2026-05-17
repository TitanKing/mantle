import { requireOwner } from '@/lib/auth';
import { listAgentActivity, listDigests, listTelegramChats } from '@/lib/debug';

/**
 * Operator's eye on the system: what has the summarizer produced, which
 * Telegram chats are about to roll up, which agents are warm.
 *
 * Pure server-rendered, no client JS — refresh the page for fresh data.
 */
export default async function DebugPage() {
  const user = await requireOwner();
  const [digests, chats, agents] = await Promise.all([
    listDigests(user.id, 25),
    listTelegramChats(user.id),
    listAgentActivity(user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Debug</h1>
        <p className="text-sm text-muted-foreground">
          Internal view of agent activity, conversation digests, and chat state. Refresh
          the page to see the latest. Owner-scoped.
        </p>
      </header>

      {/* ─── Recent digests ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Recent conversation digests
          </h2>
          <span className="text-xs text-muted-foreground">{digests.length} shown</span>
        </div>

        {digests.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            No digests yet. Once a chat crosses the summarizer threshold (default 30
            undigested turns), the summarizer agent will produce one and it&apos;ll show
            up here.
          </p>
        ) : (
          <ul className="space-y-3">
            {digests.map((d) => (
              <li key={d.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="font-mono">{d.telegramChatId ?? d.chatId.slice(0, 8)}</span>
                  <span>·</span>
                  <span>
                    {fmtShort(d.periodStart)} → {fmtShort(d.periodEnd)}
                  </span>
                  <span>·</span>
                  <span>{d.sourceTurnCount} turns</span>
                  <span>·</span>
                  <span>
                    via <code className="font-mono">{d.model}</code>{' '}
                    {d.agent && <span>({d.agent})</span>}
                  </span>
                  <span className="ml-auto">{fmtRelative(d.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{d.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Telegram chats ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Telegram chats
        </h2>

        {chats.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            No Telegram chats yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Chat</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 text-right font-semibold">Digested</th>
                  <th className="px-3 py-2 text-right font-semibold">Pending</th>
                  <th className="px-3 py-2 text-left font-semibold">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {chats.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <span className="font-medium">{c.title ?? c.username ?? '(unnamed)'}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {c.telegramChatId}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={
                          c.allowlistStatus === 'allowed'
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : c.allowlistStatus === 'denied'
                              ? 'text-destructive'
                              : 'text-amber-700 dark:text-amber-300'
                        }
                      >
                        {c.allowlistStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.totalTurns}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {c.digested}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={c.undigested >= 30 ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>
                        {c.undigested}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {c.lastActivity ? fmtRelative(c.lastActivity) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          <strong>Pending</strong> is the count of turns not yet folded into a digest. A
          chat with pending ≥ 30 (the default summarizer threshold) is about to roll up
          on the next inbound or outbound message.
        </p>
      </section>

      {/* ─── Agent activity ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Agent activity
        </h2>

        {agents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            No agents configured. Set one up at{' '}
            <a href="/settings/agents" className="underline">
              /settings/agents
            </a>
            .
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Agent</th>
                  <th className="px-3 py-2 text-left font-semibold">Role</th>
                  <th className="px-3 py-2 text-left font-semibold">Model</th>
                  <th className="px-3 py-2 text-right font-semibold">Priority</th>
                  <th className="px-3 py-2 text-right font-semibold">Runs</th>
                  <th className="px-3 py-2 text-left font-semibold">Last used</th>
                  <th className="px-3 py-2 text-left font-semibold">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {agents.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <span className="font-medium">{a.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{a.slug}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 uppercase tracking-wider">
                        {a.role}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs">{a.model}</code>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.priority}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.usageCount}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {a.lastUsedAt ? fmtRelative(a.lastUsedAt) : 'never'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {a.enabled ? (
                        <span className="text-emerald-700 dark:text-emerald-300">enabled</span>
                      ) : (
                        <span className="text-muted-foreground">disabled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** YYYY-MM-DD HH:MM from an ISO timestamp. */
function fmtShort(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 16).replace('T', ' ');
}

/** "3m ago" / "2h ago" / "yesterday" / "5 days ago". */
function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const secs = Math.max(1, Math.round((now - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}
