CREATE TABLE IF NOT EXISTS membership_settings (
  guild_id BIGINT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  membership_role_id BIGINT,
  frozen_role_id BIGINT,
  hr_role_id BIGINT,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS membership_review_campaigns (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL,
  message_id BIGINT,
  published_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','reported')),
  general_role_id BIGINT NOT NULL,
  frozen_role_id BIGINT NOT NULL,
  hr_role_id BIGINT NOT NULL,
  created_by BIGINT NOT NULL,
  closed_at TIMESTAMPTZ,
  report_file_path TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_membership_review_campaigns_guild_status
  ON membership_review_campaigns(guild_id,status,deadline_at);
CREATE INDEX IF NOT EXISTS idx_membership_review_campaigns_deadline
  ON membership_review_campaigns(status,deadline_at);

CREATE TABLE IF NOT EXISTS membership_campaign_members (
  campaign_id UUID NOT NULL REFERENCES membership_review_campaigns(id) ON DELETE CASCADE,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  display_name TEXT,
  username TEXT,
  was_active_at_publish BOOLEAN NOT NULL DEFAULT TRUE,
  team_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  team_role_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,user_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_campaign_members_guild
  ON membership_campaign_members(guild_id,campaign_id);
ALTER TABLE membership_campaign_members ADD COLUMN IF NOT EXISTS team_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE membership_campaign_members ADD COLUMN IF NOT EXISTS team_role_names JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS membership_reviews (
  campaign_id UUID NOT NULL REFERENCES membership_review_campaigns(id) ON DELETE CASCADE,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('continue','freeze','withdraw')),
  freeze_start_at TIMESTAMPTZ,
  return_at TIMESTAMPTZ,
  reason TEXT,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','active','completed','invalid')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (campaign_id,user_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_reviews_return
  ON membership_reviews(choice,status,return_at);
CREATE INDEX IF NOT EXISTS idx_membership_reviews_guild_status
  ON membership_reviews(guild_id,status,responded_at);
