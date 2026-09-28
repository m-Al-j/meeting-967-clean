CREATE TABLE IF NOT EXISTS task_status_history (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES meeting_tasks(id) ON DELETE CASCADE,
  actor_user_id BIGINT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_status_history_task
  ON task_status_history(task_id,created_at DESC);
