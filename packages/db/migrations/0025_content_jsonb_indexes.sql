-- Expression indexes on the JSONB timestamps that drive hot polling queries.
--
-- Without these, the events reminder worker (apps/web/workers/events-reminders.ts)
-- runs `SELECT … WHERE (data->>'remind_at')::timestamptz <= now()` over the
-- full nodes table every 30 seconds. Same shape for /todos (sorting by
-- due_at) and /events (filtering by starts_at). All three become O(n)
-- sequential scans as the row count grows.
--
-- Partial indexes scoped to the relevant `type` keep them small. The
-- `data ? 'key'` guard avoids indexing rows where the JSON key is absent
-- (no NULL casts), which would error out the expression.

CREATE INDEX IF NOT EXISTS nodes_event_remind_at_idx
  ON nodes (((data->>'remind_at')::timestamptz))
  WHERE type = 'event' AND data ? 'remind_at';

CREATE INDEX IF NOT EXISTS nodes_event_starts_at_idx
  ON nodes (((data->>'starts_at')::timestamptz))
  WHERE type = 'event' AND data ? 'starts_at';

CREATE INDEX IF NOT EXISTS nodes_task_due_at_idx
  ON nodes (((data->>'due_at')::timestamptz))
  WHERE type = 'task' AND data ? 'due_at';

-- The reminder worker also runs `SELECT DISTINCT owner_id FROM nodes
-- WHERE type='event'` on every tick. A partial index on owner_id for
-- event rows keeps that planar.
CREATE INDEX IF NOT EXISTS nodes_event_owner_idx
  ON nodes (owner_id)
  WHERE type = 'event';

-- /todos filters by status + priority. Both are short strings; a
-- partial expression index on (status, due_at) covers the common
-- "open todos by due date" case the UI defaults to.
CREATE INDEX IF NOT EXISTS nodes_task_status_due_idx
  ON nodes ((data->>'status'), ((data->>'due_at')::timestamptz))
  WHERE type = 'task';

-- /secrets filters by kind from the chip strip.
CREATE INDEX IF NOT EXISTS nodes_secret_kind_idx
  ON nodes ((data->>'kind'))
  WHERE type = 'secret';
