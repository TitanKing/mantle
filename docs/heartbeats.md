# Heartbeats — proactive Saskia

Heartbeats are how an agent acts *without being prompted*. Instead of
the user asking and Saskia replying, a heartbeat row schedules Saskia
to **initiate** — ask a question, send a nudge, run a checklist —
and remember her state across firings until the goal is met.

The metaphor in one sentence: **a heartbeat is a standing instruction
with a schedule, a memory, and a stop condition.**

```
heartbeats (when + where + state)
   └─→ skill   (what to do, with which tools)
         └─→ agent  (whose voice, model, persona)
                └─→ surface (telegram chat / web inbox)
```

This doc covers the data model, lifecycle, gates, the worked
"get_to_know_user" example, and the soft-fail caveats. Cross-refs:
[`architecture.md` §9j](./architecture.md) for the high-level fit;
[`ai-workers.md`](./ai-workers.md) for the adapter framework
heartbeats use to talk to providers.

## 1. Data model

Migration `0030_heartbeats.sql` adds two tables and one enum value.

### `heartbeats`

| column              | type                            | notes                                              |
|---------------------|---------------------------------|----------------------------------------------------|
| `id`                | uuid                            | PK                                                 |
| `owner_id`          | uuid → auth.users               | scoping                                            |
| `slug`              | text (unique per owner)         | stable handle e.g. `get_to_know_user`              |
| `name`              | text                            | human label                                        |
| `description`      | text                            | optional                                           |
| `agent_slug`        | text                            | resolved to `agents.slug` at fire time             |
| `skill_slug`        | text                            | resolved to `skills.slug` at fire time             |
| `schedule_kind`     | enum (once/interval/cron/manual)| `cron` reserved for v1.1; not implemented yet      |
| `schedule`          | jsonb                           | shape varies by kind, see §2                       |
| `next_fire_at`      | timestamptz                     | computed; null when status ≠ active                |
| `last_fired_at`     | timestamptz                     | populated after every fire (including errors)      |
| `fire_count`        | integer                         | only successful fires bump this                    |
| `max_fires`         | integer                         | null = unbounded                                   |
| `surface`           | jsonb                           | `{kind:'telegram',chat_id:...}` or `{kind:'web'}`  |
| `min_idle_minutes`  | integer NULL                    | gate: skip if user just messaged                   |
| `quiet_hours`       | jsonb NULL                      | `{from:'HH:MM',to:'HH:MM',tz:?}`; tz null = profile|
| `earliest_at`       | timestamptz NULL                | hard floor before any fire                         |
| `cooldown_minutes`  | integer NULL                    | gate: min wait between fires of THIS heartbeat     |
| `state`             | jsonb                           | the skill's running memory                         |
| `status`            | enum (active/paused/completed/cancelled) |                                            |
| `completion_reason` | text                            | free-text, e.g. `tool_call:all_topics_covered`     |

**Per-heartbeat-only gates.** There are no system-wide defaults.
A null gate column means "no check of that kind". The UI form offers
a "sensible defaults" preset (15/22-07/30) but the DB stays explicit.

### `heartbeat_fires`

One row per fire attempt — whether it actually ran or was gated. The
detail page renders this as a chronological audit log without
exploding the `traces` table (gate skips happen often, traces are
precious).

Disposition vocabulary:
- `fired` — the agent's tool loop ran and the reply (if any) was delivered
- `completed` — same as fired, but a tool flipped status to `completed`
- `skipped_idle` / `skipped_quiet` / `skipped_cooldown` / `skipped_earliest`
- `error` — the fire opened but the loop threw

### trace_kind extension

`trace_kind += 'heartbeat_fire'`. Subject = the heartbeat row.
Standard trace machinery (cost rollup, step graph, subject linking)
just works.

## 2. Schedule shapes

```ts
type Schedule =
  | { kind: 'once';     at: string /*ISO*/ }
  | { kind: 'interval'; every_minutes: number; jitter_minutes?: number }
  | { kind: 'cron';     expr: string /*5-field*/ }  // v1.1
  | { kind: 'manual'                        };       // only via heartbeat_fire tool
```

`jitter_minutes` is small but matters — keeps fires from feeling
mechanical (asking the same question at exactly 09:00:00 every day
reads as a bot, not a peer). The jitter seed is `${id}:${fireCount}`
so a flaky retry reproduces the same offset.

`cron` is intentionally not implemented in v1. The enum reserves it
for forward-compat; `computeNextFireAt` throws if you try to use it.
Add `cron-parser` as a dep and wire it in `schedule.ts` when needed.

## 3. The fire loop

`apps/agent/src/main.ts` runs `tickHeartbeats(USER_ID)` on a 60-second
`setInterval` with the same exponential-backoff pattern the reflector
uses (cap 30min). Each tick:

```
SELECT * FROM heartbeats
 WHERE owner_id = $1
   AND status = 'active'
   AND next_fire_at IS NOT NULL
   AND next_fire_at <= now()
 ORDER BY next_fire_at
 LIMIT 10
```

For each row:

1. **Gate check** (`checkGates`). On fail: write a `heartbeat_fires`
   row, soft-skipped trace, bump `next_fire_at` forward conservatively,
   return.
2. **Resolve agent + skill + API key**. Missing/disabled? Auto-pause
   the heartbeat with `status='paused'` and reason
   `auto_pause:<detail>`. Operator must re-enable.
3. **Open trace** (`startTrace({kind:'heartbeat_fire', subject_id:hb.id})`).
4. **Compose system prompt**: agent's persona + persistent skills +
   the time-context line. The HEARTBEAT skill is NOT in here.
5. **Build synthetic user prompt** (`buildHeartbeatPrompt`):
   identity + state JSON + skill instructions + control-tool reminder.
6. **Run tool loop** wrapped in `withHeartbeatContext` so the control
   tools know which row they're mutating. Tool allowlist =
   agent.toolSlugs ∪ persistentSkills.toolSlugs ∪ heartbeatSkill.toolSlugs
   ∪ heartbeat-control tools.
7. **Deliver reply** to surface (Telegram `sendMessage`).
8. **Reload heartbeat** to capture any state mutations from tools.
9. **Compute next_fire_at** via `computeNextFireAt`. Check `max_fires`
   for auto-completion. Persist.
10. **Record fire** in `heartbeat_fires` with state-before/after.

Step 8 is critical: a `heartbeat_complete` call mid-loop must stop
the next fire from being scheduled. Reloading the row before the
update read-modify-writes the mutation correctly.

## 4. The 5 control tools

Live in `packages/heartbeats/src/tools.ts` (not `@mantle/tools` —
would create a dependency cycle). `registerHeartbeatTools()` runs at
agent boot, before `seedBuiltinTools()`.

| Tool                       | What                                                          | Outside-context behaviour |
|----------------------------|---------------------------------------------------------------|---------------------------|
| `heartbeat_complete`       | Stop firing permanently. Optional `reason`.                  | Refuses                   |
| `heartbeat_snooze`         | Push `next_fire_at` forward by `for_hours` or to `until` iso.| Refuses                   |
| `heartbeat_update_state`   | JSON-merge a `patch` into `state`. null keys are deleted.    | Refuses                   |
| `heartbeat_list`           | List all of the owner's heartbeats with status + state.      | Allowed                   |
| `heartbeat_fire`           | Force-fire by slug, bypassing gates. Used by the UI button.  | Allowed                   |

The first three call `currentHeartbeat()` (AsyncLocalStorage) and
return a clear error if there's no current heartbeat. This prevents
an agent in a normal turn from accidentally completing a heartbeat —
which would be a confusing data-loss bug.

## 5. The continuity trick

If a heartbeat asks the user a question and the user replies an hour
later, that reply hits the *normal* responder turn — not the heartbeat
fire loop. So how does Saskia stay in character?

The responder, on every turn, calls `openHeartbeatsForSurface(ownerId, surface)`
which returns active heartbeats for this surface where
`state.expecting_reply` is truthy. If non-empty, a small block gets
appended to the system prompt:

```
## Open heartbeats

You have one or more proactive tasks in-flight on this surface. The
user's latest message may be replying to a question you asked. After
responding naturally, call heartbeat_update_state to capture what
they told you and (if appropriate) flip expecting_reply to false or
call heartbeat_complete if the skill's goal is met.

- get_to_know_user (Get to know the user): expecting a reply. Current state: {"answered":["family_size"],"last_question_topic":"work_role","expecting_reply":true}
```

The agent now has both pieces — the skill's high-level "what topics to
cover" lives in the heartbeat's skill row, and the turn-by-turn "what
specifically did I ask last" lives in the heartbeat's `state` jsonb,
which the context block exposes verbatim.

**Why this matters**: it keeps the heartbeat skill's full instructions
out of every regular turn (~1KB savings per turn for an 8-topic
interview skill) while still preserving continuity. The full skill
returns on the next heartbeat fire.

## 6. The worked example: `get_to_know_user`

Seeded by `apps/web/scripts/seed-get-to-know-user.ts`. Fires once a
day ±60min via Telegram with conservative gates and a 6-hour grace
period after install. Asks one question per fire across 8 topics
(family / work / hobbies / health / goals). Self-terminates when all
are answered.

Lifecycle:

```
T+0      Operator runs the seed script.
         Skill 'profile_interview' upserted.
         Heartbeat 'get_to_know_user' created with
           schedule: { interval, every_minutes: 1440, jitter_minutes: 60 }
           earliest_at: now() + 6h
           gates: 15min idle / 22-07 quiet / 30min cooldown
           state: { answered: [], expecting_reply: false }

T+6h12m  First tick after earliest_at. Idle ok (no recent inbound).
         FIRE → trace opened. Saskia generates first question.
                  Tool loop: heartbeat_update_state({
                    last_question_topic: 'family',
                    expecting_reply: true
                  })
                  Reply text sent via Telegram sendMessage.
         heartbeat_fires row: disposition='fired'.
         next_fire_at: now() + 1440min ± jitter.

T+6h25m  Jason replies "Wife + 3 kids, ages 4, 7, 11."
         NORMAL responder turn (not a heartbeat fire).
         openHeartbeatsForSurface returns the get_to_know_user row.
         System prompt includes the "open heartbeats" block.
         Saskia processes the reply, then calls
           heartbeat_update_state({
             answered: ['family_size','kids_ages'],
             expecting_reply: false
           })
         Replies "Got it — noted." in her own voice.

T+30h    Next scheduled fire. expecting_reply=false (good — won't
         double-ask). Idle ok. FIRE → next topic.

         ... continues over ~10 days, one topic per day ...

T+10d    All 8 topics answered. Saskia calls
           heartbeat_complete({ reason: 'all_topics_covered' })
         Status → 'completed', next_fire_at → null. Never fires again.
         The heartbeat row stays for audit.
```

## 7. Soft-fail bugs we've already booby-trapped against

(Lessons we paid for elsewhere; pre-empted here.)

- **FK on `traces.agent_id`** points at `agents.id`. The fire
  orchestrator stores agent_id correctly, but if you add a future
  trace path that uses an ai_workers id instead, it'll throw a
  silent FK violation (the tracing layer is fire-and-forget). Same
  trap that bit extractor/summarizer/reflector — see
  `observability.md` §12.

- **Auto-pause on missing config** beats silent retries. If the
  agent row is deleted or the API key disappears, the next tick
  marks the heartbeat `paused` rather than throwing every minute.
  The operator sees a paused status and a completion_reason
  starting with `auto_pause:` and knows where to look.

- **Heartbeat reload before update.** Step 8 of the fire loop
  re-SELECTs the heartbeat before persisting next_fire_at, because
  a tool call inside the loop may have already mutated the row
  (e.g. `heartbeat_complete` set status=completed). A blind update
  would clobber that.

- **Gate skips don't bump `fire_count`.** Otherwise quiet-hours
  would burn through `max_fires` for an unbounded heartbeat without
  the user ever hearing from Saskia.

## 8. Operator surfaces

- `/settings/heartbeats` — list, create/edit, pause/resume,
  fire-now, delete.
- `/heartbeats/[id]` — detail with state JSON, gates summary, last
  50 fires linked to their traces.
- `/traces?kind=heartbeat_fire` — every fire (and gate-skip) under
  the normal trace browser.

## 9. Out of scope for v1

Named so we don't accidentally do them:

- **Cron schedules.** Enum value reserved; add `cron-parser` when needed.
- **Multi-agent collaboration mid-fire.** A heartbeat picks one agent
  via `agent_slug`. Need delegation? Use the existing `invoke_agent`
  builtin from inside the fire — that's already wired.
- **Cross-surface heartbeats** (start on web, finish on telegram).
- **User-driven snooze via Telegram keyword** (e.g. `/later`).
- **Heartbeat template library.** v1 expects hand-crafted entries
  through the UI / seed script.

## 10. Files

| Path                                            | Purpose                                  |
|-------------------------------------------------|------------------------------------------|
| `packages/db/migrations/0030_heartbeats.sql`    | Schema + enum extension                  |
| `packages/db/src/schema/heartbeats.ts`          | Drizzle types                            |
| `packages/heartbeats/src/schedule.ts`           | `computeNextFireAt` + `validateSchedule` |
| `packages/heartbeats/src/gates.ts`              | `checkGates` (idle / quiet / cooldown / earliest) |
| `packages/heartbeats/src/prompt.ts`             | Synthetic prompt + open-heartbeat block  |
| `packages/heartbeats/src/context.ts`            | AsyncLocalStorage for current heartbeat  |
| `packages/heartbeats/src/fire.ts`               | Single-fire orchestration                 |
| `packages/heartbeats/src/tick.ts`               | Tick loop + `openHeartbeatsForSurface`   |
| `packages/heartbeats/src/tools.ts`              | 5 builtin control tools                  |
| `apps/agent/src/main.ts`                        | Tick wiring + responder context inject   |
| `apps/web/lib/heartbeats.ts`                    | CRUD lib                                  |
| `apps/web/app/(app)/settings/heartbeats/*`      | CRUD UI                                  |
| `apps/web/app/(app)/heartbeats/[id]/page.tsx`   | Detail / fire log                        |
| `apps/web/scripts/seed-get-to-know-user.ts`     | Demo skill + heartbeat                   |
