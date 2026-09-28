-- Meeting 967 — Membership Points Engine v1.0.0
-- Numeric points are stored as an immutable ledger, never as Discord roles.

CREATE TABLE IF NOT EXISTS membership_point_rules (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rule_key TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  description_ar TEXT NOT NULL,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, rule_key)
);

CREATE TABLE IF NOT EXISTS membership_points_ledger (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  point_type TEXT NOT NULL CHECK (
    point_type IN (
      'attendance',
      'task_completion',
      'early_task',
      'team_contribution',
      'support_contribution',
      'special',
      'admin_adjustment'
    )
  ),
  source_type TEXT NOT NULL,
  source_id TEXT,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  assignment_type TEXT CHECK (assignment_type IS NULL OR assignment_type IN ('primary','support')),
  event_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_mpl_user_time
  ON membership_points_ledger(guild_id,user_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mpl_team_time
  ON membership_points_ledger(guild_id,team_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mpl_type_time
  ON membership_points_ledger(guild_id,point_type,created_at DESC);

CREATE TABLE IF NOT EXISTS membership_point_balances (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id,user_id)
);

CREATE TABLE IF NOT EXISTS membership_achievements (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (guild_id,user_id,achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_membership_achievements_user
  ON membership_achievements(guild_id,user_id,earned_at DESC);

INSERT INTO membership_point_rules(guild_id,rule_key,points,description_ar)
SELECT g.id,v.rule_key,v.points,v.description_ar
FROM guilds g
CROSS JOIN (
  VALUES
    ('attendance',10,'حضور اجتماع'),
    ('task_completion',25,'إتمام مهمة واعتمادها'),
    ('early_task',10,'إنجاز المهمة قبل موعدها'),
    ('team_contribution',40,'مساهمة موثقة داخل الفريق'),
    ('support_contribution',40,'مساهمة موثقة في فريق مساند'),
    ('special',50,'إنجاز أو مساهمة مميزة'),
    ('admin_adjustment',0,'تعديل إداري على الرصيد')
) v(rule_key,points,description_ar)
ON CONFLICT(guild_id,rule_key) DO NOTHING;

INSERT INTO permissions(permission_key,description_ar) VALUES
  ('rewards.view','عرض نقاط العضوية وإنجازاتها ضمن النطاق المسموح'),
  ('rewards.manage','إدارة المكافآت والتعديلات اليدوية على نقاط العضوية ضمن النطاق المسموح')
ON CONFLICT(permission_key) DO UPDATE
SET description_ar=EXCLUDED.description_ar;

CREATE OR REPLACE FUNCTION meeting967_point_rule(p_guild_id BIGINT,p_rule_key TEXT,p_default INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v_points INTEGER;
BEGIN
  SELECT points INTO v_points
  FROM membership_point_rules
  WHERE guild_id=p_guild_id AND rule_key=p_rule_key AND enabled=true;
  RETURN COALESCE(v_points,p_default);
END;
$$;

CREATE OR REPLACE FUNCTION meeting967_member_assignment_type(
  p_guild_id BIGINT,
  p_user_id BIGINT,
  p_team_id UUID,
  p_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v_type TEXT;
BEGIN
  SELECT assignment_type INTO v_type
  FROM membership_team_assignments
  WHERE guild_id=p_guild_id
    AND user_id=p_user_id
    AND team_id=p_team_id
    AND effective_from <= p_at
    AND (effective_until IS NULL OR effective_until > p_at)
  ORDER BY effective_from DESC
  LIMIT 1;

  RETURN COALESCE(v_type,'primary');
END;
$$;

CREATE OR REPLACE FUNCTION meeting967_add_points(
  p_guild_id BIGINT,
  p_user_id BIGINT,
  p_amount INTEGER,
  p_point_type TEXT,
  p_source_type TEXT,
  p_source_id TEXT,
  p_team_id UUID,
  p_assignment_type TEXT,
  p_event_key TEXT,
  p_reason TEXT,
  p_actor_id BIGINT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
  IF p_amount=0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO membership_points_ledger(
    id,guild_id,user_id,amount,point_type,source_type,source_id,team_id,
    assignment_type,event_key,reason,actor_id,metadata
  )
  VALUES(
    gen_random_uuid(),p_guild_id,p_user_id,p_amount,p_point_type,p_source_type,p_source_id,
    p_team_id,p_assignment_type,p_event_key,p_reason,p_actor_id,COALESCE(p_metadata,'{}'::jsonb)
  )
  ON CONFLICT(guild_id,event_key) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION meeting967_update_points_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO membership_point_balances(guild_id,user_id,balance,updated_at)
  VALUES(NEW.guild_id,NEW.user_id,NEW.amount,now())
  ON CONFLICT(guild_id,user_id)
  DO UPDATE SET balance=membership_point_balances.balance+EXCLUDED.balance,
                updated_at=now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_points_balance ON membership_points_ledger;
CREATE TRIGGER trg_membership_points_balance
AFTER INSERT ON membership_points_ledger
FOR EACH ROW EXECUTE FUNCTION meeting967_update_points_balance();

CREATE OR REPLACE FUNCTION meeting967_award_attendance_points()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_meeting RECORD;
  v_attendance RECORD;
  v_at TIMESTAMPTZ;
  v_type TEXT;
  v_points INTEGER;
BEGIN
  SELECT id,guild_id,team_id,status,COALESCE(is_test,false) AS is_test,COALESCE(ended_at,now()) AS ended_at
  INTO v_meeting
  FROM meetings
  WHERE id=NEW.id;

  IF v_meeting.id IS NULL OR v_meeting.is_test OR v_meeting.status <> 'ended' THEN
    RETURN NEW;
  END IF;

  v_at:=v_meeting.ended_at;

  FOR v_attendance IN
    SELECT a.*
    FROM attendance a
    WHERE a.meeting_id=v_meeting.id
      AND a.status IN ('present','late')
  LOOP
    v_type:=meeting967_member_assignment_type(
      v_meeting.guild_id,v_attendance.user_id,v_meeting.team_id,v_at
    );
    v_points:=meeting967_point_rule(v_meeting.guild_id,'attendance',10);

    PERFORM meeting967_add_points(
      v_meeting.guild_id,
      v_attendance.user_id,
      v_points,
      'attendance',
      'meeting',
      v_meeting.id::text,
      v_meeting.team_id,
      v_type,
      'attendance:'||v_meeting.id::text||':'||NEW.user_id::text,
      CASE WHEN v_attendance.status='late' THEN 'حضور متأخر في اجتماع' ELSE 'حضور اجتماع' END,
      NULL,
      jsonb_build_object('attendanceStatus',v_attendance.status,'meetingId',v_meeting.id::text)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting967_award_attendance_on_meeting_end ON meetings;
CREATE TRIGGER trg_meeting967_award_attendance_on_meeting_end
AFTER UPDATE OF status ON meetings
FOR EACH ROW
WHEN (NEW.status='ended' AND OLD.status IS DISTINCT FROM 'ended')
EXECUTE FUNCTION meeting967_award_attendance_points();

CREATE OR REPLACE FUNCTION meeting967_award_late_attendance_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_meeting RECORD;
  v_type TEXT;
  v_points INTEGER;
BEGIN
  IF NEW.status NOT IN ('present','late') THEN
    RETURN NEW;
  END IF;

  SELECT id,guild_id,team_id,status,COALESCE(is_test,false) AS is_test,COALESCE(ended_at,now()) AS ended_at
  INTO v_meeting
  FROM meetings WHERE id=NEW.meeting_id;

  IF v_meeting.id IS NULL OR v_meeting.is_test OR v_meeting.status <> 'ended' THEN
    RETURN NEW;
  END IF;

  v_type:=meeting967_member_assignment_type(v_meeting.guild_id,NEW.user_id,v_meeting.team_id,v_meeting.ended_at);
  v_points:=meeting967_point_rule(v_meeting.guild_id,'attendance',10);

  PERFORM meeting967_add_points(
    v_meeting.guild_id,NEW.user_id,v_points,'attendance','meeting',
    v_meeting.id::text,v_meeting.team_id,v_type,
    'attendance:'||v_meeting.id::text||':'||NEW.user_id::text,
    CASE WHEN NEW.status='late' THEN 'حضور متأخر في اجتماع' ELSE 'حضور اجتماع' END,
    NULL,
    jsonb_build_object('attendanceStatus',NEW.status)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting967_award_attendance_late_insert ON attendance;
CREATE TRIGGER trg_meeting967_award_attendance_late_insert
AFTER INSERT ON attendance
FOR EACH ROW EXECUTE FUNCTION meeting967_award_late_attendance_insert();

CREATE OR REPLACE FUNCTION meeting967_award_task_points()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_type TEXT;
  v_base INTEGER;
  v_early INTEGER;
  v_when TIMESTAMPTZ;
BEGIN
  IF NEW.review_status <> 'approved' THEN
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE' AND OLD.review_status='approved' THEN
    RETURN NEW;
  END IF;

  v_when:=COALESCE(NEW.completed_at,NEW.reviewed_at,now());
  v_type:=meeting967_member_assignment_type(NEW.guild_id,NEW.assignee_user_id,NEW.team_id,v_when);
  v_base:=meeting967_point_rule(NEW.guild_id,'task_completion',25);

  PERFORM meeting967_add_points(
    NEW.guild_id,NEW.assignee_user_id,v_base,'task_completion','task',NEW.id::text,
    NEW.team_id,v_type,'task:'||NEW.id::text||':completion',
    'إتمام مهمة واعتمادها',NEW.reviewed_by,
    jsonb_build_object('taskId',NEW.id::text,'reviewStatus',NEW.review_status)
  );

  IF NEW.due_at IS NOT NULL AND v_when <= NEW.due_at THEN
    v_early:=meeting967_point_rule(NEW.guild_id,'early_task',10);
    PERFORM meeting967_add_points(
      NEW.guild_id,NEW.assignee_user_id,v_early,'early_task','task',NEW.id::text,
      NEW.team_id,v_type,'task:'||NEW.id::text||':early',
      'إنجاز المهمة قبل الموعد النهائي',NEW.reviewed_by,
      jsonb_build_object('taskId',NEW.id::text,'dueAt',NEW.due_at,'completedAt',v_when)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting967_award_task_points ON meeting_tasks;
CREATE TRIGGER trg_meeting967_award_task_points
AFTER UPDATE OF review_status ON meeting_tasks
FOR EACH ROW
EXECUTE FUNCTION meeting967_award_task_points();
