-- Telegram bridge: bot accounts, chats, and inbound messages.
-- Mirrors the emails layout. Every Telegram message is also a `nodes` row
-- of type 'telegram_message' (added in 0008_node_type_telegram.sql) so it
-- joins the tree, search, and embeddings.

-- ─── enums ─────────────────────────────────────────────────────────────────
do $$ begin
  create type "public"."telegram_chat_type" as enum ('private', 'group', 'supergroup');
exception when duplicate_object then null; end $$;

do $$ begin
  create type "public"."telegram_allowlist_status" as enum ('allowed', 'pending', 'denied');
exception when duplicate_object then null; end $$;

-- ─── telegram_accounts (one bot per row) ──────────────────────────────────
create table if not exists "public"."telegram_accounts" (
  "id"                  uuid primary key default gen_random_uuid(),
  "user_id"             uuid not null references auth.users(id) on delete cascade,
  "bot_username"        text not null,
  -- Bot token, AES-GCM-encrypted with MANTLE_MASTER_KEY.
  "bot_token_enc"       bytea not null,
  "branch_path"         text not null,
  "last_update_offset"  bigint not null default 0,
  "last_poll_at"        timestamptz,
  "last_poll_error"     text,
  "enabled"             boolean not null default true,
  "created_at"          timestamptz not null default now(),
  "updated_at"          timestamptz not null default now()
);
create index if not exists "telegram_accounts_user_idx" on "public"."telegram_accounts"("user_id");
create unique index if not exists "telegram_accounts_user_bot_uq"
  on "public"."telegram_accounts"("user_id", "bot_username");

-- ─── telegram_chats (per-chat metadata + allowlist) ───────────────────────
create table if not exists "public"."telegram_chats" (
  "id"                   uuid primary key default gen_random_uuid(),
  "account_id"           uuid not null references "public"."telegram_accounts"(id) on delete cascade,
  "user_id"              uuid not null references auth.users(id) on delete cascade,
  "telegram_chat_id"     text not null,
  "chat_type"            "public"."telegram_chat_type" not null,
  "title"                text,
  "username"             text,
  "allowlist_status"     "public"."telegram_allowlist_status" not null default 'pending',
  "pairing_code"         text,
  "pairing_expires_at"   timestamptz,
  "pairing_replies"      integer not null default 0,
  "last_message_at"      timestamptz,
  "created_at"           timestamptz not null default now(),
  "updated_at"           timestamptz not null default now()
);
create index if not exists "telegram_chats_account_idx" on "public"."telegram_chats"("account_id");
create unique index if not exists "telegram_chats_account_telegram_id_uq"
  on "public"."telegram_chats"("account_id", "telegram_chat_id");
create index if not exists "telegram_chats_pairing_code_idx"
  on "public"."telegram_chats"("pairing_code");

-- ─── telegram_messages (one row per inbound DM) ────────────────────────────
create table if not exists "public"."telegram_messages" (
  "id"                    uuid primary key default gen_random_uuid(),
  "node_id"               uuid not null references "public"."nodes"(id) on delete cascade,
  "account_id"            uuid not null references "public"."telegram_accounts"(id) on delete cascade,
  "chat_id"               uuid not null references "public"."telegram_chats"(id) on delete cascade,
  "telegram_message_id"   text not null,
  "telegram_update_id"    bigint not null,
  "from_user_id"          text not null,
  "from_username"         text,
  "from_name"             text,
  "text"                  text not null,
  "sent_at"               timestamptz not null,
  "attachments"           jsonb not null default '[]'::jsonb,
  "processed"             boolean not null default false,
  "processed_at"          timestamptz,
  "created_at"            timestamptz not null default now()
);
-- Dedupe key — Telegram occasionally re-emits an update if our ack was lost.
create unique index if not exists "telegram_messages_account_update_uq"
  on "public"."telegram_messages"("account_id", "telegram_update_id");
create index if not exists "telegram_messages_chat_idx"   on "public"."telegram_messages"("chat_id");
create index if not exists "telegram_messages_node_idx"   on "public"."telegram_messages"("node_id");
create index if not exists "telegram_messages_processed_idx"
  on "public"."telegram_messages"("processed");
create index if not exists "telegram_messages_sent_at_idx"
  on "public"."telegram_messages"("sent_at");

-- ─── notify channel for telegram_wait long-polling ────────────────────────
-- The MCP `telegram_wait` tool uses LISTEN/NOTIFY to block until a new
-- unprocessed message arrives, avoiding poll-thrash.
create or replace function "public"."notify_telegram_message_inserted"()
  returns trigger language plpgsql as $$
begin
  perform pg_notify('telegram_message_inserted', new.id::text);
  return new;
end
$$;

drop trigger if exists "telegram_messages_notify_trg" on "public"."telegram_messages";
create trigger "telegram_messages_notify_trg"
  after insert on "public"."telegram_messages"
  for each row execute function "public"."notify_telegram_message_inserted"();
