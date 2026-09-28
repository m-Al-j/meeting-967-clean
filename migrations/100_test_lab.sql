-- Meeting 967 — isolated owner-only Test Lab.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_meetings_is_test ON meetings(guild_id,is_test,status,scheduled_at);

CREATE TABLE IF NOT EXISTS meeting967_test_lab_settings (
  guild_id BIGINT PRIMARY KEY,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting967_test_lab_runs (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL,
  meeting_id UUID,
  team_id UUID,
  team_name TEXT NOT NULL,
  voice_channel_id BIGINT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('starting','active','ending','completed','failed')),
  recorder_key TEXT,
  recorder_user_id BIGINT,
  recording_root TEXT,
  recording_roots JSONB NOT NULL DEFAULT '[]'::jsonb,
  recording_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  recording_bytes BIGINT NOT NULL DEFAULT 0,
  report_path TEXT,
  report_bytes BIGINT NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting967_test_lab_active_per_guild
  ON meeting967_test_lab_runs(guild_id)
  WHERE status IN ('starting','active','ending');

CREATE INDEX IF NOT EXISTS idx_meeting967_test_lab_runs_guild_time
  ON meeting967_test_lab_runs(guild_id,created_at DESC);
