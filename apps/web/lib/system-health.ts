import os from 'node:os';
import { statfs } from 'node:fs/promises';
import si from 'systeminformation';
import { db, sql } from '@mantle/db';
import { filesRoot } from '@mantle/files';
import { bucketReachable } from '@mantle/storage';
import { attachmentBytes } from './dashboard';

/**
 * Live system/infra vitals for the dashboard. Server-only — imported ONLY by
 * the /api/health route handler (never by the server page or a client bundle,
 * because `systeminformation` shells out and must stay off the hot render path).
 *
 * Every probe is wrapped in a timeout + allSettled so a slow host call can't
 * hang the endpoint; a failed/timed-out probe yields null and its dotted path
 * is appended to `degraded`. In a prod container CPU/RAM/disk reflect the
 * container's cgroup, not the VPS host — surfaced via `scope`.
 */

export type DiskInfo = { usedBytes: number; totalBytes: number; usedPct: number; mount: string };

export type SystemHealth = {
  ts: string;
  scope: 'container' | 'host';
  host: {
    cpuLoadPct: number | null;
    mem: { usedBytes: number; totalBytes: number; usedPct: number } | null;
    disk: DiskInfo | null;
    uptimeSec: number;
    heapUsedBytes: number;
    rssBytes: number;
    loadAvg: number[];
    cpuCores: number;
  };
  postgres: {
    up: boolean;
    dbSizeBytes: number | null;
    connections: number | null;
    cacheHitPct: number | null;
    topTables: { name: string; bytes: number }[];
  };
  storage: {
    minioUp: boolean | null;
    attachmentBytes: number | null;
    filesDisk: DiskInfo | null;
  };
  degraded: string[];
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

type PgStatsRow = { db_size: string; connections: number; cache_hit: number | null };
type PgTableRow = { name: string; bytes: string };

async function pgHealth() {
  const statsResult = await db.execute<PgStatsRow>(sql`
    SELECT
      pg_database_size(current_database()) AS db_size,
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections,
      (SELECT CASE WHEN sum(blks_hit) + sum(blks_read) = 0 THEN NULL
                   ELSE sum(blks_hit)::float8 / (sum(blks_hit) + sum(blks_read)) END
       FROM pg_stat_database WHERE datname = current_database()) AS cache_hit
  `);
  const tablesResult = await db.execute<PgTableRow>(sql`
    SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 6
  `);
  const stats = (Array.isArray(statsResult) ? statsResult : (statsResult as { rows?: PgStatsRow[] }).rows ?? [])[0];
  const tables = (Array.isArray(tablesResult) ? tablesResult : (tablesResult as { rows?: PgTableRow[] }).rows ?? []) as PgTableRow[];
  return {
    dbSizeBytes: stats ? Number(stats.db_size) : null,
    connections: stats ? Number(stats.connections) : null,
    cacheHitPct: stats?.cache_hit != null ? Number(stats.cache_hit) * 100 : null,
    topTables: tables.map((t) => ({ name: t.name, bytes: Number(t.bytes) })),
  };
}

/** Disk usage of the volume holding MANTLE_FILES_ROOT, via systeminformation's
 *  per-mount list (best mount-prefix match), falling back to fs.statfs. */
async function filesDisk(): Promise<DiskInfo> {
  const root = filesRoot();
  try {
    const list = await si.fsSize();
    const matches = list
      .filter((d) => d.mount && root.startsWith(d.mount))
      .sort((a, b) => b.mount.length - a.mount.length);
    const d = matches[0] ?? list.find((x) => x.mount === '/') ?? list[0];
    if (d && d.size > 0) {
      return {
        usedBytes: d.used,
        totalBytes: d.size,
        usedPct: typeof d.use === 'number' ? d.use : (d.used / d.size) * 100,
        mount: d.mount,
      };
    }
  } catch {
    /* fall through to statfs */
  }
  const st = await statfs(root);
  const totalBytes = Number(st.blocks) * st.bsize;
  const availBytes = Number(st.bavail) * st.bsize;
  const usedBytes = totalBytes - availBytes;
  return {
    usedBytes,
    totalBytes,
    usedPct: totalBytes ? (usedBytes / totalBytes) * 100 : 0,
    mount: root,
  };
}

export async function getSystemHealth(userId: string): Promise<SystemHealth> {
  const degraded: string[] = [];
  async function probe<T>(name: string, fn: () => Promise<T>, ms = 1800): Promise<T | null> {
    try {
      return await withTimeout(fn(), ms);
    } catch {
      degraded.push(name);
      return null;
    }
  }

  const [load, mem, disk, pg, attBytes, minioUp] = await Promise.all([
    probe('host.cpu', () => si.currentLoad()),
    probe('host.mem', () => si.mem()),
    probe('host.disk', () => filesDisk()),
    probe('postgres', () => pgHealth()),
    probe('storage.attachments', () => attachmentBytes(userId)),
    probe('storage.minio', () => bucketReachable()),
  ]);

  const memInfo = mem
    ? {
        usedBytes: mem.total - mem.available,
        totalBytes: mem.total,
        usedPct: mem.total ? ((mem.total - mem.available) / mem.total) * 100 : 0,
      }
    : null;

  return {
    ts: new Date().toISOString(),
    scope: process.env.NODE_ENV === 'production' ? 'container' : 'host',
    host: {
      cpuLoadPct: load ? load.currentLoad : null,
      mem: memInfo,
      disk,
      uptimeSec: process.uptime(),
      heapUsedBytes: process.memoryUsage().heapUsed,
      rssBytes: process.memoryUsage().rss,
      loadAvg: os.loadavg(),
      cpuCores: os.cpus().length,
    },
    postgres: {
      up: pg != null,
      dbSizeBytes: pg?.dbSizeBytes ?? null,
      connections: pg?.connections ?? null,
      cacheHitPct: pg?.cacheHitPct ?? null,
      topTables: pg?.topTables ?? [],
    },
    storage: {
      minioUp: minioUp,
      attachmentBytes: attBytes,
      filesDisk: disk,
    },
    degraded,
  };
}
