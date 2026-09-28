ALTER TABLE teams ADD COLUMN IF NOT EXISTS discord_role_id BIGINT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_voice_channel_id BIGINT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS notification_channel_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_guild_discord_role
  ON teams(guild_id, discord_role_id)
  WHERE discord_role_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teams_guild_voice_channel
  ON teams(guild_id, default_voice_channel_id)
  WHERE default_voice_channel_id IS NOT NULL;
