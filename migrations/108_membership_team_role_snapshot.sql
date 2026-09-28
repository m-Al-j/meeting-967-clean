ALTER TABLE membership_campaign_members ADD COLUMN IF NOT EXISTS team_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE membership_campaign_members ADD COLUMN IF NOT EXISTS team_role_names JSONB NOT NULL DEFAULT '[]'::jsonb;
