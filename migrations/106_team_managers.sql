CREATE TABLE IF NOT EXISTS team_managers (
  team_id UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by BIGINT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_managers_user
  ON team_managers(guild_id, user_id);

CREATE INDEX IF NOT EXISTS idx_team_managers_guild
  ON team_managers(guild_id);
