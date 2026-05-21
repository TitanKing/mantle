'use client';

import Link from 'next/link';
import { Activity, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMicroUsd } from '@/lib/traces-format';
import { ActionIcon } from '@/components/journey/action-icon';
import {
  ageSeconds,
  relativeTime,
  STALL_THRESHOLD_S,
  useLiveActivity,
} from '@/components/journey/use-live-activity';
import type { ActivityItem } from '@/lib/journey';

/**
 * Always-on Activity column in the app shell. Shows what's processing right now
 * (active-first, with stall detection), anything that recently failed, and the
 * stream of what entered the brain — human-labelled with outcome counts, not
 * raw trace kinds. Links into the Journey story. Polls /api/activity every 5s.
 */

/** "what entered the brain" — outcome summary for content actions. */
function outcomeText(it: ActivityItem): string | null {
  if (it.category !== 'content') return null;
  const parts: string[] = [];
  if (it.factCount > 0) parts.push(`${it.factCount} fact${it.factCount === 1 ? '' : 's'}`);
  if (it.mentionCount > 0)
    parts.push(`${it.mentionCount} ${it.mentionCount === 1 ? 'entity' : 'entities'}`);
  return parts.length ? parts.join(' · ') : 'indexed';
}

export function LiveColumn() {
  const { data, loaded, tick } = useLiveActivity();
  void tick; // re-render cue for relative timestamps
  const active = data?.active ?? [];
  const failures = data?.failures ?? [];
  const recent = data?.recent ?? [];
  const live = active.length > 0;
  const hasAny = active.length + failures.length + recent.length > 0;

  return (
    <aside className="fixed inset-y-0 right-0 z-30 hidden w-80 flex-col border-l bg-sidebar pt-16 lg:flex">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity
            className={cn('size-4', live ? 'animate-pulse text-emerald-500' : 'text-muted-foreground')}
            aria-hidden
          />
          <h2 className="text-sm font-semibold">Activity</h2>
          {live && <span className="text-xs text-emerald-500">{active.length} live</span>}
        </div>
        <Link href="/debug/journey" className="text-xs text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!loaded ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
          </div>
        ) : !hasAny ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-sm text-muted-foreground">
            <Activity className="mb-3 size-10 opacity-30" aria-hidden />
            <p className="font-medium">No recent activity</p>
            <p className="mt-1 text-xs">Agent runs, ingests, and heartbeats will stream in here.</p>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <Section label="Active now">
                {active.map((it) => {
                  const stalled = ageSeconds(it.startedAt) > STALL_THRESHOLD_S;
                  return (
                    <Row key={it.traceId} it={it}>
                      <div className="flex items-center gap-2">
                        <Loader2
                          className={cn(
                            'size-3.5 shrink-0',
                            stalled ? 'text-amber-500' : 'animate-spin text-emerald-500',
                          )}
                          aria-hidden
                        />
                        <ActionIcon iconKey={it.iconKey} className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">{it.label}</span>
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                          {relativeTime(it.startedAt)}
                        </span>
                      </div>
                      {stalled && (
                        <div className="pl-5 text-xs text-amber-600 dark:text-amber-400">
                          running unusually long — may be stalled
                        </div>
                      )}
                    </Row>
                  );
                })}
              </Section>
            )}

            {failures.length > 0 && (
              <Section label="Needs attention">
                {failures.map((it) => (
                  <Row key={it.traceId} it={it}>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden />
                      <ActionIcon iconKey={it.iconKey} className="size-3.5 shrink-0 text-destructive" />
                      <span className="truncate text-sm font-medium">{it.label}</span>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                        {relativeTime(it.startedAt)}
                      </span>
                    </div>
                    <div className="pl-5 text-xs text-destructive">failed</div>
                  </Row>
                ))}
              </Section>
            )}

            {recent.length > 0 && (
              <Section label="Recent">
                {recent.map((it) => {
                  const outcome = outcomeText(it);
                  return (
                    <Row key={it.traceId} it={it}>
                      <div className="flex items-center gap-2">
                        <ActionIcon iconKey={it.iconKey} className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">{it.label}</span>
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                          {relativeTime(it.startedAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pl-5 text-xs text-muted-foreground">
                        {it.title && <span className="truncate">{it.title}</span>}
                        {outcome && (
                          <span className="ml-auto shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">
                            {outcome}
                          </span>
                        )}
                        {!outcome && it.costMicroUsd > 0 && (
                          <span className="ml-auto shrink-0 tabular-nums">
                            {formatMicroUsd(it.costMicroUsd)}
                          </span>
                        )}
                      </div>
                    </Row>
                  );
                })}
              </Section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sticky top-0 z-10 bg-sidebar/95 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
        {label}
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

function Row({ it, children }: { it: ActivityItem; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={`/debug/journey/${it.traceId}`}
        className="flex flex-col gap-0.5 px-4 py-2.5 transition-colors hover:bg-accent/50"
      >
        {children}
      </Link>
    </li>
  );
}
