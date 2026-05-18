-- Per-chat responder agent override.
--
-- Null = fall back to global priority resolution (highest-priority enabled
-- responder agent owns every chat). Setting this column pins a specific
-- agent to one chat, useful when you have separate personas for different
-- correspondents. ON DELETE SET NULL so deleting an agent doesn't orphan
-- the chat — it just reverts to the global default.

ALTER TABLE telegram_chats
  ADD COLUMN responder_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;

CREATE INDEX telegram_chats_responder_agent_idx
  ON telegram_chats(responder_agent_id)
  WHERE responder_agent_id IS NOT NULL;
