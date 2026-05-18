/**
 * Entity-anchored retrieval helpers — the graph axis of the profile layer.
 *
 * Three primitives:
 *   searchEntities  — resolve a name/alias to entity row(s) by exact /
 *                     trigram / vector fallback.
 *   entityNeighbors — first-hop neighbour walk over entity_edges (both
 *                     directions), optionally filtered by relation.
 *   entityFacts     — facts attached to an entity (current by default,
 *                     opt-in to include superseded history).
 *   entityMentions  — content_store nodes that mention this entity.
 *
 * Multi-hop traversal isn't here yet — the 80% useful case for a personal
 * memory store is "what's connected to this entity?", which is one hop.
 * Add a recursive-CTE walker when an MCP query genuinely needs it.
 */

import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  db,
  entities,
  entityEdges,
  facts,
  nodes,
  type Entity,
  type Fact,
} from '@mantle/db';

export type EntitySearchOptions = {
  ownerId: string;
  q: string;
  kind?: string;
  /** Min similarity for trigram match (0-1). Default 0.3. */
  minSimilarity?: number;
  limit?: number;
};

export type EntityHit = Entity & {
  /** Trigram similarity score, 0-1. Higher = closer name match. */
  similarity: number;
};

/**
 * Resolve a name/alias to entities. Strategy:
 *   1. Exact (case-insensitive) name OR alias hit — `similarity=1`.
 *   2. Trigram fuzzy on `name`, filtered to `>= minSimilarity`.
 *
 * Embedding fallback isn't here — the extractor already uses it during
 * ingest; at query time, a fuzzy text match is plenty for "who does
 * 'jason' mean?"-style lookups. Add later if recall is missing.
 */
export async function searchEntities(opts: EntitySearchOptions): Promise<EntityHit[]> {
  const trimmed = opts.q.trim();
  if (!trimmed) return [];
  const minSim = opts.minSimilarity ?? 0.3;
  const limit = opts.limit ?? 25;

  // Exact match first — covers "Sarah" -> the Sarah entity even when
  // there are similar names in the store.
  const exactConds: SQL[] = [
    eq(entities.ownerId, opts.ownerId),
    sql`(lower(${entities.name}) = lower(${trimmed}) or ${trimmed} = any(${entities.aliases}))`,
  ];
  if (opts.kind) exactConds.push(eq(entities.kind, opts.kind));
  const exacts = await db
    .select()
    .from(entities)
    .where(and(...exactConds))
    .limit(limit);
  if (exacts.length >= limit) {
    return exacts.map((e) => ({ ...e, similarity: 1 }));
  }

  // Trigram fuzzy fill the rest.
  const seen = new Set(exacts.map((e) => e.id));
  const fuzzyConds: SQL[] = [
    eq(entities.ownerId, opts.ownerId),
    sql`similarity(${entities.name}, ${trimmed}) >= ${minSim}`,
  ];
  if (opts.kind) fuzzyConds.push(eq(entities.kind, opts.kind));
  const fuzzy = await db
    .select({ row: entities, sim: sql<number>`similarity(${entities.name}, ${trimmed})` })
    .from(entities)
    .where(and(...fuzzyConds))
    .orderBy(sql`similarity(${entities.name}, ${trimmed}) desc`)
    .limit(limit - exacts.length + seen.size);

  const hits: EntityHit[] = exacts.map((e) => ({ ...e, similarity: 1 }));
  for (const { row, sim } of fuzzy) {
    if (seen.has(row.id)) continue;
    hits.push({ ...row, similarity: sim ?? 0 });
    if (hits.length >= limit) break;
  }
  return hits;
}

export type NeighborOptions = {
  ownerId: string;
  entityId: string;
  /** Only follow edges with this relation. Default = all. */
  relation?: string;
  /** Include outbound, inbound, or both. Default = both. */
  direction?: 'in' | 'out' | 'both';
  /** Include currently-true edges only (valid_to IS NULL) when true. */
  currentOnly?: boolean;
  limit?: number;
};

export type Neighbor = {
  entity: Entity;
  relation: string;
  direction: 'in' | 'out';
  validFrom: Date | null;
  validTo: Date | null;
  edgeId: string;
};

/**
 * First-hop entity↔entity neighbours. Returns at most `limit` rows across
 * both directions (outbound + inbound), capped each at limit/2 so an entity
 * with thousands of inbound edges doesn't crowd out outbound ones.
 */
export async function entityNeighbors(opts: NeighborOptions): Promise<Neighbor[]> {
  const dir = opts.direction ?? 'both';
  const limit = opts.limit ?? 50;
  const half = dir === 'both' ? Math.max(1, Math.ceil(limit / 2)) : limit;

  const baseConds = [eq(entityEdges.ownerId, opts.ownerId)];
  if (opts.relation) baseConds.push(eq(entityEdges.relation, opts.relation));
  if (opts.currentOnly) baseConds.push(isNull(entityEdges.validTo));

  const out: Neighbor[] = [];

  if (dir === 'out' || dir === 'both') {
    const rows = await db
      .select({
        edgeId: entityEdges.id,
        relation: entityEdges.relation,
        validFrom: entityEdges.validFrom,
        validTo: entityEdges.validTo,
        entity: entities,
      })
      .from(entityEdges)
      .innerJoin(
        entities,
        and(eq(entityEdges.targetId, entities.id), eq(entityEdges.targetKind, sql`'entity'`)),
      )
      .where(
        and(
          ...baseConds,
          eq(entityEdges.sourceId, opts.entityId),
          eq(entityEdges.sourceKind, 'entity'),
        ),
      )
      .limit(half);
    for (const r of rows) {
      out.push({
        entity: r.entity,
        relation: r.relation,
        direction: 'out',
        validFrom: r.validFrom,
        validTo: r.validTo,
        edgeId: r.edgeId,
      });
    }
  }

  if (dir === 'in' || dir === 'both') {
    const rows = await db
      .select({
        edgeId: entityEdges.id,
        relation: entityEdges.relation,
        validFrom: entityEdges.validFrom,
        validTo: entityEdges.validTo,
        entity: entities,
      })
      .from(entityEdges)
      .innerJoin(
        entities,
        and(eq(entityEdges.sourceId, entities.id), eq(entityEdges.sourceKind, sql`'entity'`)),
      )
      .where(
        and(
          ...baseConds,
          eq(entityEdges.targetId, opts.entityId),
          eq(entityEdges.targetKind, 'entity'),
        ),
      )
      .limit(half);
    for (const r of rows) {
      out.push({
        entity: r.entity,
        relation: r.relation,
        direction: 'in',
        validFrom: r.validFrom,
        validTo: r.validTo,
        edgeId: r.edgeId,
      });
    }
  }

  return out;
}

export type FactsOptions = {
  ownerId: string;
  entityId: string;
  /** Include facts whose validTo is set (history). Default false = current only. */
  includeRetired?: boolean;
  limit?: number;
};

export async function entityFacts(opts: FactsOptions): Promise<Fact[]> {
  const conds: SQL[] = [eq(facts.ownerId, opts.ownerId), eq(facts.entityId, opts.entityId)];
  if (!opts.includeRetired) conds.push(isNull(facts.validTo));
  const rows = await db
    .select()
    .from(facts)
    .where(and(...conds))
    .orderBy(sql`coalesce(${facts.validFrom}, ${facts.createdAt}) desc`)
    .limit(opts.limit ?? 50);
  return rows;
}

export type MentionsOptions = {
  ownerId: string;
  entityId: string;
  limit?: number;
};

export type EntityMention = {
  nodeId: string;
  title: string;
  type: string;
  edgeAt: Date;
  summary: string | null;
};

/**
 * Content_store nodes the entity has been mentioned in. Joins via
 * `entity_edges WHERE source_kind='entity' AND target_kind='node' AND
 * relation='mentioned_in'` (the shape the extractor writes).
 */
export async function entityMentions(opts: MentionsOptions): Promise<EntityMention[]> {
  const rows = await db
    .select({
      nodeId: nodes.id,
      title: nodes.title,
      type: nodes.type,
      data: nodes.data,
      edgeAt: entityEdges.validFrom,
      edgeCreated: entityEdges.createdAt,
    })
    .from(entityEdges)
    .innerJoin(nodes, eq(entityEdges.targetId, nodes.id))
    .where(
      and(
        eq(entityEdges.ownerId, opts.ownerId),
        eq(entityEdges.sourceId, opts.entityId),
        eq(entityEdges.sourceKind, 'entity'),
        eq(entityEdges.targetKind, 'node'),
        or(eq(entityEdges.relation, 'mentioned_in'), eq(entityEdges.relation, 'mentions'))!,
      ),
    )
    .orderBy(sql`coalesce(${entityEdges.validFrom}, ${entityEdges.createdAt}) desc`)
    .limit(opts.limit ?? 50);

  return rows.map((r) => ({
    nodeId: r.nodeId,
    title: r.title,
    type: r.type,
    edgeAt: r.edgeAt ?? r.edgeCreated,
    summary:
      typeof (r.data as Record<string, unknown> | null)?.summary === 'string'
        ? ((r.data as Record<string, unknown>).summary as string)
        : null,
  }));
}
