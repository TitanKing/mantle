-- Heartbeats: scheduled, stateful skill→agent triggers that let Saskia
-- act proactively instead of only responding. See docs/heartbeats.md
-- for the full design.
--
-- A heartbeat row says "when this fires, hand <skill> to <agent> with
-- <state> via <surface>, then update next_fire_at and possibly self-
-- terminate". The fire loop lives in apps/agent (mirrors the reflector
-- tick); the gate-checks (idle window, quiet hours, cooldown) are
-- per-heartbeat — there is intentionally no system-wide default, so
-- every heartbeat's "what counts as appropriate" is explicit in its
-- own row.
--
-- heartbeat_fires is a small audit table: one row per attempted fire,
-- whether it actually ran or was gated. Lets the UI render a fire log
-- without burning a full trace row on every skip (skips happen often;
-- traces are precious).
--
-- Also extends trace_kind with 'heartbeat_fire' so the existing trace
-- machinery covers heartbeats with no further changes.

CREATE TYPE heartbeat_status AS ENUM (
  'active',     -- eligible to fire
  'paused',     -- temporarily off; manual toggle
  'completed',  -- self-terminated via heartbeat_complete tool
  'cancelled'   -- operator-deleted; soft-stop for audit
);

CREATE TYPE heartbeat_schedule AS ENUM (
  'once',       -- fires once at schedule.at, then auto-completes
  'interval',   -- fires every schedule.every_minutes (+ optional jitter)
  'cron',       -- fires on schedule.expr (5-field crontab)
  'manual'      -- only via heartbeat_fire tool; no auto schedule
);

CREATE TABLE heartbeats (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  name              text NOT NULL,
  description       text,

  /* Who runs it. Resolved at fire time via agents.slug. */
  agent_slug        text NOT NULL,
  /* What they do. Resolved at fire time via skills.slug. */
  skill_slug        text NOT NULL,

  /* WHEN ---------------------------------------------------------- */
  schedule_kind     heartbeat_schedule NOT NULL,
  /* Shape varies by kind. See packages/heartbeats/src/schedule.ts:
       once:     { at: ISO8601 }
       interval: { every_minutes: int, jitter_minutes?: int }
       cron:     { expr: '0 9 * * MON' }
       manual:   {} */
  schedule          jsonb NOT NULL,
  /* Computed by the schedule module. NULL when paused/completed
     (the partial index below skips them entirely). */
  next_fire_at      timestamptz,
  last_fired_at     timestamptz,
  fire_count        integer NOT NULL DEFAULT 0,
  /* Hard cap; null = unbounded. When fire_count reaches this we
     auto-complete with reason='max_fires'. */
  max_fires         integer,

  /* WHERE --------------------------------------------------------- */
  /* Delivery surface for the agent's reply. Today:
       { kind: 'telegram', chat_id: <bigint as text> }
       { kind: 'web' }
     Matches @mantle/tools ToolHandlerContext.surface shape. */
  surface           jsonb NOT NULL,

  /* GATES — all nullable. NULL means "no gate of this kind".
     Per-heartbeat-only policy: there are no system-wide defaults;
     the form decides at create time. ---------------------------- */
  /* Skip fire if last inbound from surface < N min ago. */
  min_idle_minutes  integer,
  /* { from: 'HH:MM', to: 'HH:MM', tz: 'America/New_York' | null }
     null tz = use profile.preferences.timezone. */
  quiet_hours       jsonb,
  /* Never fire before this. Dormant until reached. */
  earliest_at       timestamptz,
  /* Min minutes since last_fired_at of THIS heartbeat. */
  cooldown_minutes  integer,

  /* STATE — the skill's running memory across fires. JSON-merged
     by heartbeat_update_state. Free-form per skill. ------------- */
  state             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            heartbeat_status NOT NULL DEFAULT 'active',
  /* Why status moved off 'active'. Free text:
       'tool_call:all_topics_covered', 'max_fires', 'manual', ... */
  completion_reason text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (owner_id, slug)
);

/* Hot path: the tick loop's SELECT WHERE next_fire_at <= now()
   AND status='active'. Partial index keeps it tiny — most rows
   in a mature system will be completed. */
CREATE INDEX heartbeats_due_idx
  ON heartbeats (next_fire_at)
  WHERE status = 'active' AND next_fire_at IS NOT NULL;

CREATE INDEX heartbeats_owner_status_idx
  ON heartbeats (owner_id, status);


-- One row per fire attempt — fired OR gated. Lets the UI render a
-- fire log without exploding the traces table with skip rows.
-- (Traces are reserved for actual model work; gate skips are noise
-- at that level.)
CREATE TABLE heartbeat_fires (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heartbeat_id      uuid NOT NULL REFERENCES heartbeats(id) ON DELETE CASCADE,
  fired_at          timestamptz NOT NULL DEFAULT now(),
  /* NULL when disposition is a skip — no trace was opened. */
  trace_id          uuid,
  /* 'fired' | 'skipped_idle' | 'skipped_quiet' | 'skipped_cooldown'
     | 'skipped_earliest' | 'completed' | 'error' */
  disposition       text NOT NULL,
  /* Snapshot for biography view. Same idea as trace data jsonb. */
  state_before      jsonb,
  state_after       jsonb,
  /* What the agent said, if anything reached the user. NULL on skips. */
  reply_text        text,
  /* e.g. { kind: 'telegram', message_id: 123 } so we can deep-link
     into the actual delivered message. */
  reply_surface_ref jsonb,
  /* On disposition='error', stash the error message for the UI. */
  error_message     text
);

CREATE INDEX heartbeat_fires_hb_idx
  ON heartbeat_fires (heartbeat_id, fired_at DESC);

CREATE INDEX heartbeat_fires_disposition_idx
  ON heartbeat_fires (disposition, fired_at DESC);


-- Extend trace_kind so the existing tracing infra covers heartbeat
-- fires without further plumbing. IF NOT EXISTS keeps this re-runnable.
ALTER TYPE trace_kind ADD VALUE IF NOT EXISTS 'heartbeat_fire';
