-- Meeting 967 — Membership Points v1.0.11
-- One-time bootstrap for members who already existed when the points
-- system was introduced.
--
-- New members after cutoff receive no historical points. Their live
-- 0-point balance maps to 🌱 مبتدئ.
--
-- Attendance bootstrap intentionally checks for an existing attendance
-- ledger row by source fields as well as using a per-user bootstrap key.
-- This protects against the historical meeting-end trigger's old key
-- collision while avoiding duplicate attendance credit for rows that
-- were already awarded correctly.

BEGIN;

CREATE TABLE IF NOT EXISTS membership_points_bootstrap (
  guild_id BIGINT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  cutoff_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attendance_events INTEGER NOT NULL DEFAULT 0,
  task_events INTEGER NOT NULL DEFAULT 0,
  early_task_events INTEGER NOT NULL DEFAULT 0
);

DO $$
DECLARE
  g RECORD;
  v_cutoff TIMESTAMPTZ;
  v_attendance INTEGER := 0;
  v_tasks INTEGER := 0;
  v_early INTEGER := 0;
  r RECORD;
  v_when TIMESTAMPTZ;
  v_type TEXT;
  v_points INTEGER;
  v_exists BOOLEAN;
BEGIN
  FOR g IN SELECT id FROM guilds LOOP
    INSERT INTO membership_points_bootstrap(guild_id,cutoff_at)
    VALUES(g.id,clock_timestamp())
    ON CONFLICT(guild_id) DO NOTHING;

    SELECT cutoff_at
      INTO v_cutoff
    FROM membership_points_bootstrap
    WHERE guild_id=g.id;

    /*
     * Historical attendance.
     * The source-fields NOT EXISTS check prevents duplicate credit if an
     * earlier live trigger already awarded this exact meeting/user event.
     */
    FOR r IN
      SELECT
        a.meeting_id,
        a.user_id,
        a.status AS attendance_status,
        m.team_id,
        m.guild_id,
        COALESCE(m.ended_at,m.updated_at,m.created_at) AS event_at,
        mem.joined_at
      FROM attendance a
      JOIN meetings m
        ON m.id=a.meeting_id
      JOIN members mem
        ON mem.guild_id=m.guild_id
       AND mem.user_id=a.user_id
      WHERE m.guild_id=g.id
        AND m.status='ended'
        AND COALESCE(m.is_test,false)=false
        AND a.status IN ('present','late')
        AND mem.joined_at < v_cutoff
        AND COALESCE(m.ended_at,m.updated_at,m.created_at) >= mem.joined_at
        AND COALESCE(m.ended_at,m.updated_at,m.created_at) < v_cutoff
    LOOP
      SELECT EXISTS(
        SELECT 1
        FROM membership_points_ledger mpl
        WHERE mpl.guild_id=r.guild_id
          AND mpl.user_id=r.user_id
          AND mpl.point_type='attendance'
          AND mpl.source_type='meeting'
          AND mpl.source_id=r.meeting_id::text
      ) INTO v_exists;

      IF NOT v_exists THEN
        v_type := meeting967_member_assignment_type(
          r.guild_id,r.user_id,r.team_id,r.event_at
        );
        v_points := meeting967_point_rule(r.guild_id,'attendance',10);

        PERFORM meeting967_add_points(
          r.guild_id,
          r.user_id,
          v_points,
          'attendance',
          'meeting',
          r.meeting_id::text,
          r.team_id,
          v_type,
          'bootstrap:attendance:'||r.meeting_id::text||':'||r.user_id::text,
          CASE
            WHEN r.attendance_status='late'
            THEN 'حضور متأخر في اجتماع — ترحيل تاريخي'
            ELSE 'حضور اجتماع — ترحيل تاريخي'
          END,
          NULL,
          jsonb_build_object(
            'bootstrap',true,
            'attendanceStatus',r.attendance_status,
            'meetingId',r.meeting_id::text
          )
        );

        v_attendance := v_attendance + 1;
      END IF;
    END LOOP;

    /*
     * Historical approved tasks.
     * Live task event keys are already per-task and idempotent, so the same
     * keys are intentionally reused here.
     */
    FOR r IN
      SELECT
        t.id,
        t.guild_id,
        t.team_id,
        t.assignee_user_id,
        t.due_at,
        t.reviewed_by,
        t.review_status,
        mem.joined_at,
        COALESCE(t.completed_at,t.reviewed_at,t.updated_at,t.created_at) AS event_at
      FROM meeting_tasks t
      JOIN members mem
        ON mem.guild_id=t.guild_id
       AND mem.user_id=t.assignee_user_id
      WHERE t.guild_id=g.id
        AND t.review_status='approved'
        AND mem.joined_at < v_cutoff
        AND COALESCE(t.completed_at,t.reviewed_at,t.updated_at,t.created_at) >= mem.joined_at
        AND COALESCE(t.completed_at,t.reviewed_at,t.updated_at,t.created_at) < v_cutoff
    LOOP
      v_type := meeting967_member_assignment_type(
        r.guild_id,r.assignee_user_id,r.team_id,r.event_at
      );
      v_points := meeting967_point_rule(r.guild_id,'task_completion',25);

      PERFORM meeting967_add_points(
        r.guild_id,
        r.assignee_user_id,
        v_points,
        'task_completion',
        'task',
        r.id::text,
        r.team_id,
        v_type,
        'task:'||r.id::text||':completion',
        'إتمام مهمة واعتمادها — ترحيل تاريخي',
        r.reviewed_by,
        jsonb_build_object(
          'bootstrap',true,
          'taskId',r.id::text,
          'reviewStatus',r.review_status
        )
      );

      v_tasks := v_tasks + 1;

      IF r.due_at IS NOT NULL AND r.event_at <= r.due_at THEN
        v_points := meeting967_point_rule(r.guild_id,'early_task',10);

        PERFORM meeting967_add_points(
          r.guild_id,
          r.assignee_user_id,
          v_points,
          'early_task',
          'task',
          r.id::text,
          r.team_id,
          v_type,
          'task:'||r.id::text||':early',
          'إنجاز المهمة قبل الموعد — ترحيل تاريخي',
          r.reviewed_by,
          jsonb_build_object(
            'bootstrap',true,
            'taskId',r.id::text,
            'dueAt',r.due_at,
            'completedAt',r.event_at
          )
        );

        v_early := v_early + 1;
      END IF;
    END LOOP;

    UPDATE membership_points_bootstrap
       SET applied_at=now(),
           attendance_events=v_attendance,
           task_events=v_tasks,
           early_task_events=v_early
     WHERE guild_id=g.id;

    RAISE NOTICE
      'Membership points bootstrap guild %: attendance %, tasks %, early tasks %',
      g.id,v_attendance,v_tasks,v_early;
  END LOOP;
END $$;

COMMIT;
