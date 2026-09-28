-- Meeting 967 v1.3.2: reliable automatic recording/report/delivery pipeline.
-- Recording + report generation are mandatory automation for every managed meeting.
UPDATE settings
SET recording_enabled=TRUE,
    recording_auto_start=TRUE,
    updated_at=now();

ALTER TABLE settings ALTER COLUMN recording_enabled SET DEFAULT TRUE;
ALTER TABLE settings ALTER COLUMN recording_auto_start SET DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS meeting_output_state (
  meeting_id UUID PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  report_status TEXT NOT NULL DEFAULT 'pending' CHECK (report_status IN ('pending','ready','failed')),
  recording_status TEXT NOT NULL DEFAULT 'pending' CHECK (recording_status IN ('pending','recording','ready','missing','failed')),
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','partial','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  owner_alerted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_output_retry ON meeting_output_state(completed_at,next_retry_at,updated_at);

CREATE TABLE IF NOT EXISTS meeting_delivery_receipts (
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  report_sent_at TIMESTAMPTZ,
  recording_sent_at TIMESTAMPTZ,
  decisions_sent_at TIMESTAMPTZ,
  recording_files_sent INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_receipts_meeting ON meeting_delivery_receipts(meeting_id,updated_at);
