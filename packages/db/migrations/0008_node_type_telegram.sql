-- Adds 'telegram_message' to the node_type enum. Lives in its own file
-- because `ALTER TYPE ... ADD VALUE` has constraints when combined with
-- DDL in the same transaction; isolating it sidesteps that.

alter type "public"."node_type" add value if not exists 'telegram_message';
