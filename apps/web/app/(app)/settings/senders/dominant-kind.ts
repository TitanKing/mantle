import { sql } from 'drizzle-orm';
import { emailSenders } from '@mantle/db';
import type { DeliveryKind } from '@mantle/email';

/**
 * Pill / filter threshold constants. Settled in the spec's §9 open-decisions
 * pass:
 *   - **≥ 3 messages** before any pill appears (catches newsletters early
 *     without lighting up on a single welcome email).
 *   - **≥ 70%** of messages must agree on a kind (confident but flexible —
 *     a sender who's 80% marketing + occasional human reply still gets the
 *     marketing pill; mixed-use senders stay unbadged).
 *
 * Knobs in one place so the senders page (`dominantKind`) and the server
 * filter clause (`dominantKindWhere`) and the bulk-deny count all agree
 * about what counts as "dominant".
 */
export const MIN_MESSAGES_FOR_PILL = 3;
export const DOMINANCE_THRESHOLD = 0.7;

/** Subset of the sender row we need to compute the pill — kept narrow so
 *  this helper is trivially callable from anywhere with the four counts. */
export interface DominantKindInput {
  messageCount: number;
  directCount: number;
  listCount: number;
  automatedCount: number;
  marketingCount: number;
}

/**
 * Compute the dominant delivery kind for a sender, or `null` when there
 * isn't enough signal or no kind has crossed the threshold.
 *
 * Note: `direct` IS returned when it dominates — the senders UI is what
 * decides not to render a pill for it (since "direct" is the default and a
 * pill would just be visual noise). Filtering on `?kind=direct` needs the
 * positive case though, which is why it's not swallowed here.
 */
export function dominantKind(row: DominantKindInput): DeliveryKind | null {
  const total = row.messageCount;
  if (total < MIN_MESSAGES_FOR_PILL) return null;
  const minimum = total * DOMINANCE_THRESHOLD;
  // First-match-wins; only one kind can cross 70% on a single row, so the
  // order here is purely a deterministic tiebreak on the threshold boundary.
  if (row.marketingCount >= minimum) return 'marketing';
  if (row.listCount >= minimum) return 'list';
  if (row.automatedCount >= minimum) return 'automated';
  if (row.directCount >= minimum) return 'direct';
  return null;
}

/**
 * SQL fragment that filters `email_senders` rows to those whose dominant
 * kind matches the requested one. Used by the server page when `?kind=` is
 * present and by the bulk-deny action's WHERE clause.
 *
 * Kept symmetric with `dominantKind` above — change the threshold here AND
 * there together. The two are tested for agreement via the page's "N total"
 * count matching the rendered list length under filter.
 */
export function dominantKindWhere(kind: DeliveryKind) {
  // Cast counts to numeric so the `>=` against a fractional threshold
  // doesn't truncate the comparison side.
  const total = sql<number>`${emailSenders.messageCount}`;
  const minimum = sql`${total} * ${DOMINANCE_THRESHOLD}`;
  const kindCount =
    kind === 'marketing'
      ? sql`${emailSenders.marketingCount}`
      : kind === 'list'
        ? sql`${emailSenders.listCount}`
        : kind === 'automated'
          ? sql`${emailSenders.automatedCount}`
          : sql`${emailSenders.directCount}`;
  return sql`(${emailSenders.messageCount} >= ${MIN_MESSAGES_FOR_PILL} AND ${kindCount} >= ${minimum})`;
}

/** Validate `?kind=` query input. Mirror of the enum — keep in sync. */
export function parseKindParam(raw: string | undefined): DeliveryKind | null {
  if (!raw) return null;
  if (raw === 'direct' || raw === 'list' || raw === 'automated' || raw === 'marketing') {
    return raw;
  }
  return null;
}
