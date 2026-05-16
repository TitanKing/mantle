-- API keys for external services (OpenRouter, OpenAI, Anthropic, …).
-- The plaintext key is AES-256-GCM sealed via @mantle/crypto using the row
-- id as AAD, so the ciphertext can't be moved between rows without failing
-- to decrypt. The plaintext only leaves the server twice: at create time
-- (so the UI can show it once) and at rotation. The list endpoint returns
-- a masked view only.

create table "api_keys" (
  "id"          uuid primary key default gen_random_uuid(),
  "user_id"     uuid not null references auth.users(id) on delete cascade,
  "service"     text not null,
  "label"       text not null default 'default',
  "key_enc"     bytea not null,
  "key_version" integer not null default 1,
  "scopes"      text[] not null default '{}'::text[],
  "last_used"   timestamptz,
  "created_at"  timestamptz not null default now(),
  "updated_at"  timestamptz not null default now()
);

create index "api_keys_user_idx"    on "api_keys"("user_id");
create index "api_keys_service_idx" on "api_keys"("service");
create unique index "api_keys_user_service_label_uq"
  on "api_keys"("user_id", "service", "label");
