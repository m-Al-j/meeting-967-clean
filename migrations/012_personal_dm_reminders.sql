-- Meeting 967 v1.7.8 — individual DM reminders with durable per-member receipts.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS excuse_cutoff_minutes INTEGER NOT NULL DEFAULT 30;

DO $$ BEGIN
  ALTER TABLE settings
    ADD CONSTRAINT chk_excuse_cutoff_minutes
    CHECK (excuse_cutoff_minutes BETWEEN 0 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS meeting_notification_receipts (
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (meeting_id,user_id,event_key)
);

CREATE INDEX IF NOT EXISTS idx_meeting_notification_receipts_event
ON meeting_notification_receipts(meeting_id,event_key,status);

CREATE OR REPLACE FUNCTION meeting967_enforce_excuse_cutoff()
RETURNS trigger AS $$
DECLARE
  v_scheduled_at TIMESTAMPTZ;
  v_status TEXT;
  v_cutoff INTEGER;
BEGIN
  SELECT m.scheduled_at,
         m.status,
         COALESCE(s.excuse_cutoff_minutes,30)
    INTO v_scheduled_at,v_status,v_cutoff
    FROM meetings m
    LEFT JOIN settings s ON s.guild_id=m.guild_id
   WHERE m.id=NEW.meeting_id;

  IF v_scheduled_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_status <> 'upcoming' OR now() >= v_scheduled_at - make_interval(mins => v_cutoff) THEN
    RAISE EXCEPTION 'EXCUSE_WINDOW_CLOSED'
      USING ERRCODE='P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_meeting967_excuse_cutoff ON excuses;
CREATE TRIGGER trg_meeting967_excuse_cutoff
BEFORE INSERT ON excuses
FOR EACH ROW EXECUTE FUNCTION meeting967_enforce_excuse_cutoff();
