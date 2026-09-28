ALTER TABLE settings ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS autopilot_readiness_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS autopilot_reminder_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS autopilot_start_grace_minutes INTEGER NOT NULL DEFAULT 10;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS autopilot_empty_end_minutes INTEGER NOT NULL DEFAULT 2;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS autopilot_no_show_end_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS task_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;

DO $$ BEGIN
  ALTER TABLE settings ADD CONSTRAINT chk_autopilot_readiness_minutes CHECK (autopilot_readiness_minutes BETWEEN 1 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE settings ADD CONSTRAINT chk_autopilot_reminder_minutes CHECK (autopilot_reminder_minutes BETWEEN 1 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE settings ADD CONSTRAINT chk_autopilot_start_grace_minutes CHECK (autopilot_start_grace_minutes BETWEEN 1 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE settings ADD CONSTRAINT chk_autopilot_empty_end_minutes CHECK (autopilot_empty_end_minutes BETWEEN 1 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE settings ADD CONSTRAINT chk_autopilot_no_show_end_minutes CHECK (autopilot_no_show_end_minutes BETWEEN 2 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS start_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS end_reason TEXT;
DO $$ BEGIN
  ALTER TABLE meetings ADD CONSTRAINT chk_meetings_start_mode CHECK (start_mode IN ('manual','autopilot','recovery'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS meeting_automation (
  meeting_id UUID PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  readiness_checked_at TIMESTAMPTZ,
  readiness_ok BOOLEAN,
  readiness_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  reminder_sent_at TIMESTAMPTZ,
  start_attempted_at TIMESTAMPTZ,
  start_attempts INTEGER NOT NULL DEFAULT 0,
  start_error TEXT,
  had_human BOOLEAN NOT NULL DEFAULT FALSE,
  empty_since TIMESTAMPTZ,
  no_show_alert_sent_at TIMESTAMPTZ,
  ended_automatically_at TIMESTAMPTZ,
  last_recovery_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_tasks (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id),
  meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  decision_id UUID REFERENCES meeting_decisions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  assignee_user_id BIGINT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','cancelled')),
  created_by BIGINT NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_tasks_guild_status_due ON meeting_tasks(guild_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_meeting_tasks_assignee ON meeting_tasks(guild_id,assignee_user_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_meeting_tasks_meeting ON meeting_tasks(meeting_id,created_at);
CREATE INDEX IF NOT EXISTS idx_meeting_tasks_team ON meeting_tasks(team_id,status,due_at);

CREATE TABLE IF NOT EXISTS task_reminder_receipts (
  task_id UUID NOT NULL REFERENCES meeting_tasks(id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, reminder_key)
);

INSERT INTO permissions(permission_key, description_ar) VALUES
('tasks.view','عرض القرارات والتكليفات ضمن النطاق المسموح'),
('tasks.manage','إنشاء التكليفات وتعديلها وإسنادها وإدارة حالتها ضمن النطاق المسموح')
ON CONFLICT(permission_key) DO UPDATE SET description_ar=EXCLUDED.description_ar;
