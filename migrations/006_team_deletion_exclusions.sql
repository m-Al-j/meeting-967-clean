ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_by BIGINT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_teams_guild_deleted
  ON teams(guild_id, deleted_at);

CREATE TABLE IF NOT EXISTS team_sync_exclusions (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  discord_role_id BIGINT NOT NULL,
  excluded_by BIGINT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, discord_role_id)
);

CREATE INDEX IF NOT EXISTS idx_team_sync_exclusions_guild
  ON team_sync_exclusions(guild_id);
