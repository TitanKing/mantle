-- Precompute the masked plaintext at create/rotate time and store it.
-- Previously `listApiKeys` decrypted every key just to compute a
-- "first4…last4" display string — wasteful CPU, and every plaintext
-- spent a moment in process memory for no real benefit.
--
-- We backfill `'••••'` for existing rows; the user can rotate to refresh
-- the mask, or a one-off backfill script can update them in batches.
-- (The backfill isn't run inside this migration so we don't import
-- @mantle/crypto into SQL — that's a runtime concern.)

ALTER TABLE "public"."api_keys"
  ADD COLUMN IF NOT EXISTS "masked" text NOT NULL DEFAULT '••••';
