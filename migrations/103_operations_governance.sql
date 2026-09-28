-- Meeting 967 v1.10.0 — Operations Center + institutional decisions + workflow engine
-- Additive / non-destructive migration.

ALTER TABLE meeting_decisions ADD COLUMN IF NOT EXISTS owner_user_id BIGINT;
ALTER TABLE meeting_decisions ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
ALTER TABLE meeting_decisions ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE meeting_decisions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE meeting_decisions ADD COLUMN IF NOT EXISTS evidence TEXT;
ALTER TABLE meeting_decisions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE meeting_decisions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE meeting_decisions ADD CONSTRAINT chk_meeting_decisions_priority
    CHECK (priority IN ('low','normal','high','critical'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE meeting_decisions ADD CONSTRAINT chk_meeting_decisions_status
    CHECK (status IN ('open','in_progress','implemented','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_meeting_decisions_status_due ON meeting_decisions(status,due_at);
CREATE INDEX IF NOT EXISTS idx_meeting_decisions_owner ON meeting_decisions(owner_user_id,status,due_at);

CREATE TABLE IF NOT EXISTS workflow_templates (
  template_key TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  description_ar TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  system_template BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(steps)='array')
);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL REFERENCES workflow_templates(template_key),
  title TEXT NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  owner_user_id BIGINT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','completed','cancelled')),
  current_step INTEGER NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  due_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_guild_status ON workflow_instances(guild_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_due ON workflow_instances(guild_id,status,due_at) WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_instances_owner ON workflow_instances(guild_id,owner_user_id,status);

CREATE TABLE IF NOT EXISTS workflow_step_history (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('started','completed','skipped','reopened','note','owner_changed','due_changed','status_changed')),
  actor_user_id BIGINT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_step_history_instance ON workflow_step_history(instance_id,created_at DESC);

INSERT INTO workflow_templates(template_key,name_ar,description_ar,steps,active,system_template)
VALUES
('membership_onboarding','مسار انضمام عضو','ينظم رحلة العضو من الطلب حتى التهيئة والمتابعة الأولية.',
 '["استلام الطلب","مراجعة الطلب","المقابلة / التحقق","قرار القبول أو الرفض","إضافة العضو للفريق والصلاحيات","التهيئة والتعريف","متابعة ما بعد الانضمام"]'::jsonb,TRUE,TRUE),
('project_lifecycle','دورة حياة مشروع','ينظم المشروع من الفكرة إلى الاعتماد والتنفيذ والإغلاق والتوثيق.',
 '["تسجيل الفكرة أو المقترح","الدراسة والتقييم","الاعتماد","تعيين المسؤول والفريق","خطة التنفيذ","التنفيذ والمتابعة","الإغلاق والتقرير النهائي","الأرشفة"]'::jsonb,TRUE,TRUE),
('leadership_handover','تسليم واستلام مسؤولية','يضمن نقل المهام والملفات والصلاحيات بدون فقد المعرفة المؤسسية.',
 '["حصر المسؤوليات المفتوحة","حصر الملفات والوثائق","حصر القرارات والالتزامات المعلقة","نقل الصلاحيات","جلسة التسليم والاستلام","مراجعة المستلم","اعتماد الإغلاق"]'::jsonb,TRUE,TRUE)
ON CONFLICT(template_key) DO UPDATE SET
  name_ar=EXCLUDED.name_ar,
  description_ar=EXCLUDED.description_ar,
  steps=EXCLUDED.steps,
  active=EXCLUDED.active,
  updated_at=now();

INSERT INTO permissions(permission_key,description_ar) VALUES
('operations.view','عرض مركز القيادة والمؤشرات والتنبيهات التشغيلية'),
('decisions.view','عرض سجل القرارات المؤسسية والالتزامات المرتبطة بها'),
('decisions.manage','إدارة مسؤول القرار وموعده وأولويته وحالته ودليل التنفيذ'),
('workflows.view','عرض مسارات العمل المؤسسية وحالتها وخطواتها'),
('workflows.manage','بدء مسارات العمل وتعيين المسؤول والموعد والتقدم بين الخطوات وإدارة الحالة')
ON CONFLICT(permission_key) DO UPDATE SET description_ar=EXCLUDED.description_ar;
