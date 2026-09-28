ALTER TABLE meeting_tasks ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'not_submitted';
ALTER TABLE meeting_tasks ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE meeting_tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE meeting_tasks ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;
ALTER TABLE meeting_tasks ADD COLUMN IF NOT EXISTS review_note TEXT;

DO $$ BEGIN
  ALTER TABLE meeting_tasks ADD CONSTRAINT chk_meeting_tasks_review_status
    CHECK (review_status IN ('not_submitted','submitted','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE meeting_tasks
SET review_status='approved', reviewed_at=COALESCE(completed_at,updated_at)
WHERE status='done' AND review_status='not_submitted';

CREATE TABLE IF NOT EXISTS task_submissions (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES meeting_tasks(id) ON DELETE CASCADE,
  submitter_user_id BIGINT NOT NULL,
  note TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_submissions_task ON task_submissions(task_id,submitted_at DESC);

CREATE TABLE IF NOT EXISTS member_performance_reports (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('week','month')),
  range_start TIMESTAMPTZ NOT NULL,
  range_end TIMESTAMPTZ NOT NULL,
  generated_by BIGINT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_path TEXT NOT NULL,
  score NUMERIC(6,2),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_member_performance_user ON member_performance_reports(guild_id,user_id,generated_at DESC);

INSERT INTO permissions(permission_key,description_ar) VALUES
('tasks.review','مراجعة تسليمات المهام واعتماد الإنجاز أو إعادته للتعديل ضمن النطاق المسموح'),
('performance.view','عرض وتوليد تقارير التقييم الأسبوعية والشهرية للأعضاء ضمن النطاق المسموح')
ON CONFLICT(permission_key) DO UPDATE SET description_ar=EXCLUDED.description_ar;
