import { sql } from 'drizzle-orm';
import { db } from './client';

/**
 * Announce that a content node was created, or had its content change, so the
 * extractor (re-)indexes it (summary + embedding + facts; vision for images;
 * parse for documents).
 *
 * This is the explicit companion to migration 0018's `node_ingested` trigger,
 * which is **AFTER INSERT only**. So:
 *   - a fresh INSERT of a non-branch node notifies automatically (trigger);
 *   - any code that UPDATES a node's content, or wants to force a re-index,
 *     MUST call this — the trigger does not fire on UPDATE.
 *
 * Best-effort: a failed notify only delays re-indexing, so it never throws —
 * the caller's primary write (the row) is what matters.
 */
export async function notifyNodeIngested(nodeId: string): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_notify('node_ingested', ${nodeId}::text)`);
  } catch (err) {
    console.error('[db] notifyNodeIngested failed:', err instanceof Error ? err.message : err);
  }
}
