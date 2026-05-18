/**
 * Re-embed every stored vector with a chosen embedding model.
 *
 * Use case: you switched MANTLE_EMBEDDING_MODEL (or an agent's per-row
 * embedding_model setting). The text content didn't change, but the
 * vectors are now in the wrong space relative to what the responder
 * will use at query time. This script re-runs `embed()` over every
 * row in `nodes` / `facts` / `entities` and writes the new vectors
 * back.
 *
 * Skips the expensive chat-model extraction — we already have the
 * stored summary + fact content + entity name. Only the embedding
 * API gets called.
 *
 * Usage:
 *   pnpm re-embed --dry-run
 *   pnpm re-embed
 *   pnpm re-embed --model=google/gemini-embedding-2-preview
 *   pnpm re-embed --tables=nodes
 *   pnpm re-embed --types=file,note --limit=200
 *   pnpm re-embed --batch-size=20
 *
 * Flags:
 *   --model=<slug>     OpenRouter embedding slug. Defaults to
 *                      MANTLE_EMBEDDING_MODEL env or text-embedding-3-small.
 *   --tables=<list>    Comma-separated subset of {nodes,facts,entities}.
 *                      Default: all three.
 *   --types=<list>     For nodes only: restrict by node type (note,file,...).
 *   --limit=<n>        Cap rows-per-table.
 *   --batch-size=<n>   Embed batch size (default 50). Cache hits are free,
 *                      so larger batches mostly only help on misses.
 *   --dry-run          Count rows + estimate cost, write nothing.
 *
 * Idempotency: re-running with the same model hits the embedding_cache
 * for every row and writes the same vectors back — free + safe.
 * Re-running with a different model burns embedding API calls.
 */

import postgres from 'postgres';
import { and, eq, isNull, isNotNull, sql, type SQL } from 'drizzle-orm';
import {
  db,
  entities,
  facts,
  nodes,
  type Entity,
  type Fact,
  type Node,
} from '@mantle/db';
import { embedBatch, DEFAULT_EMBEDDING_MODEL } from '@mantle/embeddings';

const USER_ID = process.env.ALLOWED_USER_ID;
if (!USER_ID) {
  console.error('re-embed: ALLOWED_USER_ID must be set');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('re-embed: DATABASE_URL must be set');
  process.exit(1);
}

type Args = {
  model: string;
  tables: Set<'nodes' | 'facts' | 'entities'>;
  types: string[] | null;
  limit: number | null;
  batchSize: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    model: DEFAULT_EMBEDDING_MODEL,
    tables: new Set(['nodes', 'facts', 'entities']),
    types: null,
    limit: null,
    batchSize: 50,
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--model=')) {
      out.model = arg.slice('--model='.length).trim();
    } else if (arg.startsWith('--tables=')) {
      const list = arg
        .slice('--tables='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is 'nodes' | 'facts' | 'entities' =>
          s === 'nodes' || s === 'facts' || s === 'entities',
        );
      out.tables = new Set(list);
    } else if (arg.startsWith('--types=')) {
      out.types = arg
        .slice('--types='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isNaN(n)) out.limit = n;
    } else if (arg.startsWith('--batch-size=')) {
      const n = parseInt(arg.slice('--batch-size='.length), 10);
      if (!Number.isNaN(n) && n > 0) out.batchSize = n;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    }
  }
  return out;
}

/** Rough cost estimate: ~4 chars/token, OpenAI text-embedding-3-small is
 *  $0.02/1M tokens. Bumps to $0.20/1M for Gemini-embedding-2-preview. We
 *  report worst-case in cents so the operator can sanity-check before a
 *  full re-embed across thousands of rows. */
function estimateUsd(totalChars: number, model: string): number {
  const tokens = totalChars / 4;
  const perMillion =
    model === 'openai/text-embedding-3-small'
      ? 0.02
      : model === 'google/gemini-embedding-001'
        ? 0.15
        : model === 'google/gemini-embedding-2-preview'
          ? 0.2
          : 0.05; // unknown — conservative-ish
  return (tokens / 1_000_000) * perMillion;
}

/** Compose the same text the extractor would for this node, minus the
 *  body fetch (which we don't replicate here — title + summary carry
 *  the bulk of the semantic signal and re-embed predictability beats
 *  perfect parity). */
function textForNode(row: Node): string {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const summary = typeof data.summary === 'string' ? data.summary : '';
  const content =
    typeof data.content === 'string' ? (data.content as string).slice(0, 500) : '';
  return [row.title, summary, content].filter(Boolean).join('\n\n');
}

function textForFact(row: Fact): string {
  return row.content;
}

function textForEntity(row: Entity): string {
  return `${row.kind}: ${row.name}`;
}

// ─── per-table workers ────────────────────────────────────────────────────

async function reEmbedTable<T extends { id: string }>(opts: {
  label: 'nodes' | 'facts' | 'entities';
  fetcher: () => Promise<T[]>;
  textFor: (row: T) => string;
  writer: (id: string, vec: number[]) => Promise<void>;
  args: Args;
}): Promise<{ rows: number; chars: number; written: number }> {
  const rows = await opts.fetcher();
  const chars = rows.reduce((s, r) => s + opts.textFor(r).length, 0);
  console.log(`[re-embed] ${opts.label}: ${rows.length} rows, ${chars} chars`);

  if (opts.args.dryRun) {
    return { rows: rows.length, chars, written: 0 };
  }
  if (rows.length === 0) {
    return { rows: 0, chars: 0, written: 0 };
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += opts.args.batchSize) {
    const slice = rows.slice(i, i + opts.args.batchSize);
    const texts = slice.map(opts.textFor);
    const vectors = await embedBatch(USER_ID!, texts, { model: opts.args.model });
    for (let j = 0; j < slice.length; j++) {
      const id = slice[j]!.id;
      const vec = vectors[j];
      if (!vec) continue;
      await opts.writer(id, vec);
      written++;
    }
    process.stdout.write(
      `\r[re-embed] ${opts.label}: ${Math.min(i + slice.length, rows.length)}/${rows.length}`,
    );
  }
  process.stdout.write('\n');
  return { rows: rows.length, chars, written };
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('[re-embed] settings:', {
    model: args.model,
    tables: Array.from(args.tables),
    types: args.types ?? '(all)',
    limit: args.limit ?? '(no cap)',
    batchSize: args.batchSize,
    dryRun: args.dryRun,
  });
  if (args.model !== DEFAULT_EMBEDDING_MODEL) {
    console.log(
      `[re-embed] model differs from current default ('${DEFAULT_EMBEDDING_MODEL}'). ` +
        `Make sure responder/extractor agents are switched to '${args.model}' ` +
        `or set MANTLE_EMBEDDING_MODEL accordingly — otherwise retrieval will mix spaces.`,
    );
  }

  let totalChars = 0;
  let totalRows = 0;
  let totalWritten = 0;

  if (args.tables.has('nodes')) {
    const conds: SQL[] = [
      eq(nodes.ownerId, USER_ID!),
      isNotNull(nodes.embedding),
    ];
    if (args.types && args.types.length > 0) {
      conds.push(sql`${nodes.type}::text = any(${args.types}::text[])`);
    }
    const r = await reEmbedTable<Node>({
      label: 'nodes',
      args,
      fetcher: async () => {
        const q = db.select().from(nodes).where(and(...conds));
        const rows = args.limit ? await q.limit(args.limit) : await q;
        return rows as Node[];
      },
      textFor: textForNode,
      writer: async (id, vec) => {
        await db
          .update(nodes)
          .set({ embedding: vec, updatedAt: new Date() })
          .where(eq(nodes.id, id));
      },
    });
    totalRows += r.rows;
    totalChars += r.chars;
    totalWritten += r.written;
  }

  if (args.tables.has('facts')) {
    const r = await reEmbedTable<Fact>({
      label: 'facts',
      args,
      fetcher: async () => {
        const q = db
          .select()
          .from(facts)
          .where(
            and(
              eq(facts.ownerId, USER_ID!),
              isNull(facts.validTo),
              isNotNull(facts.embedding),
            ),
          );
        const rows = args.limit ? await q.limit(args.limit) : await q;
        return rows as Fact[];
      },
      textFor: textForFact,
      writer: async (id, vec) => {
        await db
          .update(facts)
          .set({ embedding: vec, updatedAt: new Date() })
          .where(eq(facts.id, id));
      },
    });
    totalRows += r.rows;
    totalChars += r.chars;
    totalWritten += r.written;
  }

  if (args.tables.has('entities')) {
    const r = await reEmbedTable<Entity>({
      label: 'entities',
      args,
      fetcher: async () => {
        const q = db
          .select()
          .from(entities)
          .where(
            and(eq(entities.ownerId, USER_ID!), isNotNull(entities.embedding)),
          );
        const rows = args.limit ? await q.limit(args.limit) : await q;
        return rows as Entity[];
      },
      textFor: textForEntity,
      writer: async (id, vec) => {
        await db
          .update(entities)
          .set({ embedding: vec, updatedAt: new Date() })
          .where(eq(entities.id, id));
      },
    });
    totalRows += r.rows;
    totalChars += r.chars;
    totalWritten += r.written;
  }

  const usd = estimateUsd(totalChars, args.model);
  console.log(
    `[re-embed] ${args.dryRun ? 'would touch' : 'touched'} ${totalRows} rows ` +
      `(${totalChars} chars · ~$${usd.toFixed(4)} if cache cold; free if cache warm). ` +
      `Written: ${totalWritten}.`,
  );

  // Close the postgres pool drizzle keeps open.
  const pool = postgres(DATABASE_URL!, { max: 1 });
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[re-embed] fatal:', err);
  process.exit(1);
});
