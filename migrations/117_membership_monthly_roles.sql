-- Meeting 967 — Membership Monthly Roles v1.0.16
-- Existing members at activation -> عضو عادي.
-- Members joining after activation -> عضو جديد.
-- Monthly membership is based only on positive points earned in the
-- evaluated calendar month. Historical lifetime totals do not promote.
-- First evaluation uses the first full calendar month after activation.

BEGIN;

CREATE TABLE IF NOT EXISTS membership_role_policy (
  guild_id BIGINT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  monthly_roles_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_full_month_start TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO membership_role_policy(
  guild_id,
  monthly_roles_enabled,
  activated_at,
  first_full_month_start,
  timezone
)
SELECT
  g.id,
  TRUE,
  now(),
  (
    date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') + interval '1 month'
  ) AT TIME ZONE 'Asia/Riyadh',
  'Asia/Riyadh'
FROM guilds g
ON CONFLICT(guild_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS membership_member_baselines (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  baseline_key TEXT NOT NULL CHECK (baseline_key IN ('ordinary','new')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,user_id)
);

-- Freeze all currently active members as ordinary at activation.
-- Members joining after activation are inserted as new by the Discord handler.
INSERT INTO membership_member_baselines(
  guild_id,user_id,baseline_key,created_at,updated_at
)
SELECT
  m.guild_id,
  m.user_id,
  'ordinary',
  now(),
  now()
FROM members m
WHERE m.active=true
ON CONFLICT(guild_id,user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_membership_member_baselines_user
  ON membership_member_baselines(guild_id,user_id,baseline_key);

CREATE TABLE IF NOT EXISTS membership_membership_roles (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  role_id BIGINT NOT NULL,
  role_name TEXT NOT NULL,
  role_color INTEGER NOT NULL DEFAULT 0,
  role_kind TEXT NOT NULL CHECK(role_kind IN ('baseline','rank')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,role_key),
  UNIQUE(guild_id,role_id)
);

CREATE TABLE IF NOT EXISTS membership_monthly_rank_awards (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  month_start TIMESTAMPTZ NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points BIGINT NOT NULL DEFAULT 0,
  role_key TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,month_start,user_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_monthly_rank_awards_latest
  ON membership_monthly_rank_awards(guild_id,user_id,month_start DESC);

CREATE INDEX IF NOT EXISTS idx_membership_monthly_rank_awards_month
  ON membership_monthly_rank_awards(guild_id,month_start,role_key);

COMMIT;
