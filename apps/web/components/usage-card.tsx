import Link from 'next/link';
import { cookies } from 'next/headers';
import { recentAgentContext, spendInRange, type AgentContext, type SpendRange } from '@/lib/metrics';
import { formatMicroUsd } from '@/lib/traces-format';
import { UsageCardPills } from '@/components/usage-card-pills';

const SPEND_RANGE_COOKIE = 'mantle_spend_range';
const VALID_RANGES: SpendRange[] = ['day', 'week', 'month'];

function readRange(value: string | undefined): SpendRange {
  return (VALID_RANGES as string[]).includes(value ?? '') ? (value as SpendRange) : 'day';
}

function formatSpend(microUsd: number): string {
  if (microUsd === 0) return '—';
  return formatMicroUsd(microUsd);
}

const RANGE_LABEL: Record<SpendRange, string> = {
  day: 'last 24h',
  week: 'last 7d',
  month: 'last 30d',
};

export async function UsageCard({ ownerId }: { ownerId: string }) {
  const cookieStore = await cookies();
  const range = readRange(cookieStore.get(SPEND_RANGE_COOKIE)?.value);
  const [spend, contexts] = await Promise.all([
    spendInRange(ownerId, range),
    recentAgentContext(ownerId),
  ]);

  return (
    <div className="border-b border-border px-4 py-2">
      <Link
        href="/debug"
        className="flex items-baseline justify-between text-sm hover:text-foreground"
        title={`${spend.runs} runs in ${RANGE_LABEL[range]}`}
      >
        <span className="font-semibold tabular-nums">{formatSpend(spend.costMicroUsd)}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {RANGE_LABEL[range]}
        </span>
      </Link>
      <UsageCardPills current={range} />
      {contexts.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {contexts.map((c) => (
            <AgentContextRow key={c.agentId} ctx={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentContextRow({ ctx }: { ctx: AgentContext }) {
  const label = ctx.agentName ?? ctx.agentSlug ?? 'agent';
  const tokensLabel = formatTokens(ctx.lastTokensIn);
  const pctLabel = ctx.pct != null ? `${Math.round(ctx.pct * 100)}%` : '—';
  const limitLabel = ctx.contextLimit ? formatTokens(ctx.contextLimit) : 'unknown';
  const title =
    ctx.pct != null
      ? `${label} (${ctx.modelSlug}) — last turn ${tokensLabel} / ${limitLabel} tokens`
      : `${label} (${ctx.modelSlug}) — last turn ${tokensLabel} tokens · context limit unknown for this model`;
  return (
    <li className="flex items-center gap-2 text-[11px]" title={title}>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      <div className="relative h-1.5 w-12 overflow-hidden rounded-full bg-accent/60">
        {ctx.pct != null && (
          <div
            className="absolute inset-y-0 left-0 bg-emerald-500"
            style={{ width: `${Math.max(2, ctx.pct * 100)}%` }}
          />
        )}
      </div>
      <span className="w-8 text-right tabular-nums text-muted-foreground">{pctLabel}</span>
    </li>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}
