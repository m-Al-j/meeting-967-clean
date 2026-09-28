-- Meeting 967 v1.3.6: smart member suggestions.
-- Stores only how often a Meeting 967 operator selects a member inside the bot.
-- It does NOT read or store private Discord DM history.
CREATE TABLE IF NOT EXISTS member_picker_usage (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  actor_user_id BIGINT NOT NULL,
  target_user_id BIGINT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1 CHECK (use_count >= 1),
  last_context TEXT,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, actor_user_id, target_user_id)
);
CREATE INDEX IF NOT EXISTS idx_member_picker_usage_actor_recent
  ON member_picker_usage(guild_id, actor_user_id, last_used_at DESC);
