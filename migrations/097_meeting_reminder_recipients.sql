-- Meeting 967 v1.7.9 — per-meeting reminder recipient selection.
CREATE TABLE IF NOT EXISTS meeting_reminder_recipient_settings (
  meeting_id UUID PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'team' CHECK (mode IN ('team','custom')),
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_reminder_recipients (
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  display_name TEXT,
  added_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_meeting_reminder_recipients_meeting ON meeting_reminder_recipients(meeting_id,created_at);
