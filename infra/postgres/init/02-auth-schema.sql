-- auth.users — Mantle's identity table. Owned by Mantle (not Supabase) since
-- the lean-stack migration. Tables in public.* FK into here, so this must
-- exist BEFORE Drizzle migrations 0000/0001/0009 run.
--
-- Lives in /docker-entrypoint-initdb.d/ — runs once at first cluster init.
-- Re-running compose against the same volume is a no-op.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id            uuid        PRIMARY KEY,
  email         text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
