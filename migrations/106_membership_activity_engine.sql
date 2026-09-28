CREATE TABLE IF NOT EXISTS membership_team_assignments (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  assignment_type TEXT NOT NULL CHECK (assignment_type IN ('primary','support')),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'system',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_mta_user_active
  ON membership_team_assignments(guild_id,user_id,active,effective_from);

CREATE INDEX IF NOT EXISTS idx_mta_team_active
  ON membership_team_assignments(guild_id,team_id,active,effective_from);

CREATE INDEX IF NOT EXISTS idx_mta_history
  ON membership_team_assignments(guild_id,user_id,effective_from DESC);

CREATE TABLE IF NOT EXISTS membership_activity_settings (
  guild_id BIGINT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  minimum_attendance_pct NUMERIC(5,2) NOT NULL DEFAULT 40,
  minimum_completed_tasks INTEGER NOT NULL DEFAULT 3,
  minimum_evaluation_days INTEGER NOT NULL DEFAULT 7,
  primary_weight NUMERIC(5,4) NOT NULL DEFAULT 0.7000,
  support_weight NUMERIC(5,4) NOT NULL DEFAULT 0.3000,
  monthly_evaluation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notice_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (minimum_attendance_pct >= 0 AND minimum_attendance_pct <= 100),
  CHECK (minimum_completed_tasks >= 0),
  CHECK (minimum_evaluation_days >= 0),
  CHECK (primary_weight >= 0 AND primary_weight <= 1),
  CHECK (support_weight >= 0 AND support_weight <= 1),
  CHECK (ABS((primary_weight + support_weight) - 1.0000) < 0.0001)
);

CREATE TABLE IF NOT EXISTS membership_activity_evaluations (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('meets_minimum','needs_improvement','insufficient_data')),
  meets_minimum BOOLEAN NOT NULL,
  attendance_pct NUMERIC(6,2),
  attended_meetings INTEGER NOT NULL DEFAULT 0,
  eligible_meetings INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  required_tasks INTEGER NOT NULL DEFAULT 0,
  eligible_days INTEGER NOT NULL DEFAULT 0,
  weighted_attendance_pct NUMERIC(6,2),
  primary_attendance_pct NUMERIC(6,2),
  support_attendance_pct NUMERIC(6,2),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculation_version TEXT NOT NULL DEFAULT 'membership-activity-v1.0.1',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id,user_id,period_start,period_end)
);

CREATE INDEX IF NOT EXISTS idx_mae_period
  ON membership_activity_evaluations(guild_id,period_start,period_end,status);

CREATE INDEX IF NOT EXISTS idx_mae_user
  ON membership_activity_evaluations(guild_id,user_id,period_start DESC);

CREATE TABLE IF NOT EXISTS membership_activity_notices (
  id UUID PRIMARY KEY,
  evaluation_id UUID NOT NULL REFERENCES membership_activity_evaluations(id) ON DELETE CASCADE,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','sent','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (evaluation_id)
);

INSERT INTO membership_activity_settings (guild_id)
SELECT id FROM guilds
WHERE NOT EXISTS (
  SELECT 1 FROM membership_activity_settings s WHERE s.guild_id=guilds.id
);

INSERT INTO membership_team_assignments
  (id,guild_id,user_id,team_id,assignment_type,effective_from,active,source)
SELECT
  gen_random_uuid(),
  x.guild_id,
  x.user_id,
  x.team_id,
  CASE WHEN x.rn=1 THEN 'primary' ELSE 'support' END,
  x.joined_at,
  TRUE,
  'migration-inference'
FROM (
  SELECT
    tm.guild_id,
    tm.user_id,
    tm.team_id,
    tm.joined_at,
    ROW_NUMBER() OVER (
      PARTITION BY tm.guild_id,tm.user_id
      ORDER BY tm.joined_at ASC,tm.team_id ASC
    ) AS rn
  FROM team_members tm
  JOIN members m
    ON m.guild_id=tm.guild_id AND m.user_id=tm.user_id
  JOIN teams t
    ON t.id=tm.team_id AND t.guild_id=tm.guild_id
  WHERE tm.active=true AND m.active=true AND t.active=true
    AND t.deleted_at IS NULL
) x
WHERE NOT EXISTS (
  SELECT 1
  FROM membership_team_assignments a
  WHERE a.guild_id=x.guild_id
    AND a.user_id=x.user_id
    AND a.team_id=x.team_id
    AND a.active=true
);
