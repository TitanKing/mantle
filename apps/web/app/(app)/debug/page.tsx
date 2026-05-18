import { requireOwner } from '@/lib/auth';
import {
  contentIndexCoverage,
  listAgentActivity,
  listDigests,
  listFacts,
  listPersonaNotes,
  listTelegramChats,
} from '@/lib/debug';

/**
 * Operator's eye on the system: what has the summarizer produced, which
 * Telegram chats are about to roll up, which agents are warm, what facts
 * the extractor has captured, content_index coverage, persona notes.
 *
 * Pure server-rendered, no client JS — refresh the page for fresh data.
 */
export default async function DebugPage() {
  const user = await requireOwner();
  const [digests, chats, agents, factRows, coverage, personaNotes] = await Promise.all([
    listDigests(user.id, 25),
    listTelegramChats(user.id),
    listAgentActivity(user.id),
    listFacts(user.id, 25),
    contentIndexCoverage(user.id),
    listPersonaNotes(user.id),
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

      {/* ─── Recent facts ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Recent facts (profile)
          </h2>
          <span className="text-xs text-muted-foreground">{factRows.length} shown</span>
        </div>

        {factRows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            No facts yet. Set up an <code>extractor</code> agent at{' '}
            <a href="/settings/agents" className="underline">/settings/agents</a> and
            ingest some content (or run <code>pnpm extract:backfill</code>).
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {factRows.map((f) => (
              <li key={f.id} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 uppercase tracking-wider">
                    {f.kind}
                  </span>
                  {f.entityName && (
                    <span>
                      <strong>{f.entityName}</strong>{' '}
                      <span className="text-muted-foreground/70">({f.entityKind})</span>
                    </span>
                  )}
                  {f.confidence < 1 && (
                    <span className="text-amber-700 dark:text-amber-300">
                      confidence {f.confidence.toFixed(2)}
                    </span>
                  )}
                  {f.sourceTitle && (
                    <span className="text-muted-foreground/70">
                      ← {f.sourceTitle.slice(0, 40)}
                    </span>
                  )}
                  <span className="ml-auto">{fmtRelative(f.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm">{f.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Content index coverage ────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Content index coverage
        </h2>
        <div className="rounded-md border border-border p-3 text-sm">
          {coverage.total === 0 ? (
            <p className="text-muted-foreground">No content nodes yet.</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span>
                  <strong>{coverage.indexed}</strong> / {coverage.total} indexed{' '}
                  <span className="text-muted-foreground">
                    ({((coverage.indexed / Math.max(1, coverage.total)) * 100).toFixed(0)}%)
                  </span>
                </span>
                {coverage.indexed < coverage.total && (
                  <span className="text-xs text-amber-700 dark:text-amber-300">
                    Run <code>pnpm extract:backfill</code> to catch up.
                  </span>
                )}
              </div>
              <ul className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                {coverage.byType.map((row) => {
                  const pct = (row.indexed / Math.max(1, row.total)) * 100;
                  return (
                    <li key={row.type} className="flex items-baseline justify-between gap-3">
                      <span>
                        <code className="font-mono">{row.type}</code> ·{' '}
                        <strong>{row.indexed}</strong>/{row.total}
                      </span>
                      <span className={pct === 100 ? 'text-emerald-700 dark:text-emerald-300' : ''}>
                        {pct.toFixed(0)}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>

      {/* ─── Persona notes ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Persona notes
        </h2>
        {personaNotes.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            No persona notes yet. Set up a <code>reflector</code> agent at{' '}
            <a href="/settings/agents" className="underline">/settings/agents</a> and
            it will start observing dialog signals every 10 minutes.
          </p>
        ) : (
          <div className="space-y-3">
            {personaNotes.map((p) => (
              <div key={p.agentId} className="rounded-md border border-border p-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  <strong>{p.agentName}</strong> / {p.agentSlug} — {p.notes.length} note{p.notes.length === 1 ? '' : 's'}
                </div>
                <ul className="mt-2 space-y-1">
                  {p.notes.map((n, i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {n.kind}
                      </span>
                      <span className="text-sm">{n.content}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {fmtRelative(n.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
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
