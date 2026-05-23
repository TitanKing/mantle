-- SMTP submission config for SENDING mail (the email_send tool).
-- Mirrors the imap_* knobs; the password is the same app-password already
-- sealed in imap_config_enc (providers accept one app-password for both IMAP
-- and SMTP submission), so there is no new secret column.
--
-- NULL smtp_host/smtp_port = sending disabled for the account (existing
-- accounts stay read-only until the operator fills these in on the account
-- form). smtp_secure: true = implicit TLS (port 465); false = STARTTLS (587).

alter table "public"."email_accounts"
  add column if not exists "smtp_host" text;

alter table "public"."email_accounts"
  add column if not exists "smtp_port" integer;

alter table "public"."email_accounts"
  add column if not exists "smtp_secure" boolean not null default true;
