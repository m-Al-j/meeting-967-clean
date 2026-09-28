ALTER TABLE membership_campaign_members
  ADD COLUMN IF NOT EXISTS dm_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS dm_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS dm_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname='membership_campaign_members_dm_status_check'
  ) THEN
    ALTER TABLE membership_campaign_members
      ADD CONSTRAINT membership_campaign_members_dm_status_check
      CHECK (dm_status IN ('pending','sent','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_membership_campaign_members_dm_status
  ON membership_campaign_members(campaign_id,dm_status);
