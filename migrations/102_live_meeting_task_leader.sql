-- Meeting 967 v1.9.6.0 — live meeting task leader / grouped assignments

INSERT INTO permissions(permission_key,description_ar) VALUES
('meetings.lead','قائد الاجتماع: إدارة لوحة المهام الحية وإنشاء التكليفات لعضو أو عدة أعضاء أو فريق كامل أثناء الاجتماع')
ON CONFLICT(permission_key) DO UPDATE SET description_ar=EXCLUDED.description_ar;

CREATE TABLE IF NOT EXISTS task_assignment_groups (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  origin_team_id UUID NOT NULL REFERENCES teams(id),
  target_team_id UUID NOT NULL REFERENCES teams(id),
  assignment_mode TEXT NOT NULL CHECK (assignment_mode IN ('member','members','team')),
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL,
  voice_channel_id BIGINT,
  voice_message_id BIGINT,
  team_channel_id BIGINT,
  team_message_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_assignment_groups_meeting ON task_assignment_groups(meeting_id,created_at);
CREATE INDEX IF NOT EXISTS idx_task_assignment_groups_target_team ON task_assignment_groups(target_team_id,created_at DESC);

ALTER TABLE meeting_tasks ADD COLUMN IF NOT EXISTS assignment_group_id UUID;
DO $$ BEGIN
  ALTER TABLE meeting_tasks
    ADD CONSTRAINT fk_meeting_tasks_assignment_group
    FOREIGN KEY (assignment_group_id) REFERENCES task_assignment_groups(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_meeting_tasks_assignment_group ON meeting_tasks(assignment_group_id);

CREATE TABLE IF NOT EXISTS meeting_task_boards (
  meeting_id UUID PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  voice_channel_id BIGINT NOT NULL,
  message_id BIGINT,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_task_boards_guild ON meeting_task_boards(guild_id,updated_at DESC);
