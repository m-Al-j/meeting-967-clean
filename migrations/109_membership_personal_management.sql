-- Membership Management V2
-- Personal freeze + support memberships + immutable pre-freeze snapshot

CREATE TABLE IF NOT EXISTS membership_support_roles (
  guild_id BIGINT NOT NULL,
  team_role_id BIGINT NOT NULL,
  support_role_id BIGINT NOT NULL,
  team_role_name TEXT NOT NULL,
  support_role_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, team_role_id),
  UNIQUE (guild_id, support_role_id)
);

CREATE TABLE IF NOT EXISTS membership_personal_states (
  guild_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','frozen','withdrawn')),
  freeze_start_at TIMESTAMPTZ,
  return_at TIMESTAMPTZ,
  freeze_reason TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  support_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_personal_returns
  ON membership_personal_states(guild_id, status, return_at);

CREATE INDEX IF NOT EXISTS idx_membership_support_roles_guild
  ON membership_support_roles(guild_id);

ALTER TABLE membership_campaign_members
  ADD COLUMN IF NOT EXISTS support_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE membership_campaign_members
  ADD COLUMN IF NOT EXISTS support_role_names JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE membership_reviews
  ADD COLUMN IF NOT EXISTS pre_freeze_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE membership_reviews
  ADD COLUMN IF NOT EXISTS post_freeze_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_membership_reviews_freeze_status
  ON membership_reviews(guild_id, choice, status, return_at);
