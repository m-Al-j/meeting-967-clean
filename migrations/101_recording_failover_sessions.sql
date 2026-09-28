-- Meeting 967 v1.9.5.0 — recorder heartbeat / lease / failover sessions
-- Additive only. Existing recordings remain valid and are treated as historical sessions.

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS recorder_key TEXT;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS recorder_type TEXT;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS recorder_user_id BIGINT;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS worker_number INTEGER;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS team_scope TEXT;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS session_index INTEGER;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS session_reason TEXT;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS lease_heartbeat_at TIMESTAMPTZ;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS failover_from_recording_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='recordings_failover_from_recording_id_fkey'
  ) THEN
    ALTER TABLE recordings
      ADD CONSTRAINT recordings_failover_from_recording_id_fkey
      FOREIGN KEY(failover_from_recording_id) REFERENCES recordings(id) ON DELETE SET NULL;
  END IF;
END $$;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY meeting_id ORDER BY started_at,id) AS n
  FROM recordings
  WHERE session_index IS NULL
)
UPDATE recordings r SET session_index=ranked.n
FROM ranked WHERE ranked.id=r.id;

ALTER TABLE recordings ALTER COLUMN session_index SET DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_recordings_meeting_session
  ON recordings(meeting_id,session_index,started_at);
CREATE INDEX IF NOT EXISTS idx_recordings_lease_heartbeat
  ON recordings(status,lease_heartbeat_at) WHERE status='recording';
