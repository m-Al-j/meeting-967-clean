CREATE TABLE IF NOT EXISTS bot_dm_first_contact (
  user_id BIGINT PRIMARY KEY,
  first_reason TEXT,
  welcomed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_dm_first_contact_welcomed_at
  ON bot_dm_first_contact(welcomed_at);
