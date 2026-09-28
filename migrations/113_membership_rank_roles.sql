BEGIN;

CREATE TABLE IF NOT EXISTS membership_rank_roles (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  role_id BIGINT NOT NULL,
  role_name TEXT NOT NULL,
  role_color INTEGER NOT NULL DEFAULT 0,
  role_kind TEXT NOT NULL DEFAULT 'level',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, role_key),
  UNIQUE (guild_id, role_id),
  CHECK (role_kind IN ('level','weekly'))
);

CREATE INDEX IF NOT EXISTS idx_membership_rank_roles_guild_kind
  ON membership_rank_roles(guild_id,role_kind);

CREATE TABLE IF NOT EXISTS membership_weekly_honors (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  week_start TIMESTAMPTZ NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points BIGINT NOT NULL DEFAULT 0,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id,week_start)
);

CREATE INDEX IF NOT EXISTS idx_membership_weekly_honors_user
  ON membership_weekly_honors(guild_id,user_id);

COMMIT;
