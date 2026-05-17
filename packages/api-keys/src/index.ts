import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, apiKeys, type ApiKey } from '@mantle/db';
import { open, seal } from '@mantle/crypto';

/**
 * Encrypted-at-rest API key storage. Every call is owner-scoped — pass the
 * user's id explicitly; never trust client-supplied user ids.
 *
 * Used by:
 *   - apps/web (`/settings/keys` UI, /api/keys routes)
 *   - apps/agent (reads `openrouter` key at startup)
 *   - future MCP tools that need to call external LLMs
 */

export type ApiKeySummary = {
  id: string;
  service: string;
  label: string;
  /** First-4 + last-4 of the plaintext, e.g. `sk-1…abcd`. Never the full key. */
  masked: string;
  lastUsed: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mask(plaintext: string): string {
  if (plaintext.length < 8) return '••••';
  return `${plaintext.slice(0, 4)}…${plaintext.slice(-4)}`;
}

/** List rows for a user with the plaintext masked. Decrypts each row in
 * memory just to compute the mask — fine at personal scale. */
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.updatedAt));
  return rows.map((r) => {
    let masked = '••••';
    try {
      masked = mask(open(r.keyEnc, r.id));
    } catch {
      // Wrong master key or tampered row — surface a placeholder rather than failing the list.
    }
    return {
      id: r.id,
      service: r.service,
      label: r.label,
      masked,
      lastUsed: r.lastUsed,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

/** Read the plaintext for one key by its row id. Used by agents that reference
 * a specific vault entry via `api_key_id`. No owner check here — callers
 * that hold a referenced id have already passed the owner gate. */
export async function getApiKeyById(id: string): Promise<string | null> {
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
  if (!row) return null;
  const plaintext = open(row.keyEnc, row.id);
  void db
    .update(apiKeys)
    .set({ lastUsed: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});
  return plaintext;
}

/** Read the plaintext for one key. Bumps `last_used` opportunistically. */
export async function getApiKey(
  userId: string,
  service: string,
  label = 'default',
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.service, service),
        eq(apiKeys.label, label),
      ),
    )
    .limit(1);
  if (!row) return null;
  const plaintext = open(row.keyEnc, row.id);
  // Best-effort last_used bump.
  void db
    .update(apiKeys)
    .set({ lastUsed: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});
  return plaintext;
}

/** Insert a new key. Allocates the id up-front so AAD is known before seal(). */
export async function setApiKey(
  userId: string,
  service: string,
  label: string,
  plaintext: string,
): Promise<ApiKey> {
  const id = randomUUID();
  const { ciphertext, keyVersion } = seal(plaintext, id);
  const [inserted] = await db
    .insert(apiKeys)
    .values({ id, userId, service, label, keyEnc: ciphertext, keyVersion })
    .returning();
  if (!inserted) throw new Error('failed to insert api_key');
  return inserted;
}

/** Replace the ciphertext on an existing key. Verifies ownership first. */
export async function rotateApiKey(
  userId: string,
  id: string,
  plaintext: string,
): Promise<ApiKey | null> {
  const [row] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .limit(1);
  if (!row) return null;
  const { ciphertext, keyVersion } = seal(plaintext, row.id);
  const [updated] = await db
    .update(apiKeys)
    .set({ keyEnc: ciphertext, keyVersion, updatedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .returning();
  return updated ?? null;
}

export async function deleteApiKey(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}
