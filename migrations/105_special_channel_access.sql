-- operations967-special-channel-access-v1.10.13.1
-- Additive/non-destructive storage for Discord channel access managed by Operations 967.
CREATE TABLE IF NOT EXISTS special_channel_access (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  channel_id BIGINT NOT NULL,
  previous_overwrite JSONB NOT NULL DEFAULT '{}'::jsonb,
  managed_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  granted_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id,user_id,channel_id)
);

CREATE INDEX IF NOT EXISTS idx_special_channel_access_user
  ON special_channel_access(guild_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_special_channel_access_channel
  ON special_channel_access(guild_id,channel_id,created_at DESC);
