CREATE TABLE IF NOT EXISTS guilds (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  username TEXT,
  display_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, name)
);
CREATE INDEX IF NOT EXISTS idx_teams_guild_active ON teams(guild_id, active);

CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(guild_id, user_id, active);

CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  description TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  original_scheduled_at TIMESTAMPTZ NOT NULL,
  voice_channel_id BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('upcoming','ongoing','ended','canceled','postponed')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  postponed_at TIMESTAMPTZ,
  cancel_reason TEXT,
  postpone_note TEXT,
  summary TEXT,
  created_by BIGINT NOT NULL,
  updated_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_meetings_guild_status_time ON meetings(guild_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_team_time ON meetings(team_id, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS meeting_member_snapshots (
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  display_name TEXT NOT NULL,
  team_id UUID NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'absent' CHECK (status IN ('present','absent','late','excused')),
  first_join_at TIMESTAMPTZ,
  last_leave_at TIMESTAMPTZ,
  total_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_seconds >= 0),
  presence_ratio NUMERIC(6,4) NOT NULL DEFAULT 0,
  full_attendance BOOLEAN NOT NULL DEFAULT FALSE,
  late_by_seconds INTEGER NOT NULL DEFAULT 0,
  manually_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  original_status TEXT,
  overridden_by BIGINT,
  override_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id, meeting_id);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id BIGSERIAL PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL,
  left_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  UNIQUE (meeting_id, user_id, joined_at)
);
CREATE INDEX IF NOT EXISTS idx_att_sessions_open ON attendance_sessions(meeting_id, user_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS excuses (
  id UUID PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by BIGINT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  UNIQUE (meeting_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_excuses_meeting_status ON excuses(meeting_id, status);

CREATE TABLE IF NOT EXISTS permissions (
  permission_key TEXT PRIMARY KEY,
  description_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id BIGSERIAL PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  permission_key TEXT NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
  scope_type TEXT NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global','team','meeting')),
  scope_id TEXT,
  granted_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope_type='global' AND scope_id IS NULL) OR (scope_type<>'global' AND scope_id IS NOT NULL)),
  UNIQUE (guild_id, user_id, permission_key, effect, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGSERIAL PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL,
  permission_key TEXT NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
  scope_type TEXT NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global','team','meeting')),
  scope_id TEXT,
  granted_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope_type='global' AND scope_id IS NULL) OR (scope_type<>'global' AND scope_id IS NOT NULL)),
  UNIQUE (guild_id, role_id, permission_key, effect, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS team_permissions (
  id BIGSERIAL PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
  scope_type TEXT NOT NULL DEFAULT 'team' CHECK (scope_type IN ('global','team','meeting')),
  scope_id TEXT,
  granted_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope_type='global' AND scope_id IS NULL) OR (scope_type<>'global' AND scope_id IS NOT NULL)),
  UNIQUE (guild_id, team_id, permission_key, effect, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_resolve ON user_permissions(guild_id, user_id, permission_key);
CREATE INDEX IF NOT EXISTS idx_role_permissions_resolve ON role_permissions(guild_id, role_id, permission_key);
CREATE INDEX IF NOT EXISTS idx_team_permissions_resolve ON team_permissions(guild_id, team_id, permission_key);

CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  started_by BIGINT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('recording','completed','failed')),
  storage_path TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS recording_tracks (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  path TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  packet_count INTEGER NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  generated_by BIGINT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_reports_meeting ON reports(meeting_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS meeting_decisions (
  id UUID PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  decision_text TEXT NOT NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  actor_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  old_value JSONB,
  new_value JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_guild_time ON audit_logs(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);

CREATE TABLE IF NOT EXISTS backups (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  requested_by BIGINT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  path TEXT,
  size_bytes BIGINT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  guild_id BIGINT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  report_channel_id BIGINT,
  audit_channel_id BIGINT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  late_after_minutes INTEGER NOT NULL DEFAULT 10 CHECK (late_after_minutes BETWEEN 0 AND 180),
  recording_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  recording_auto_start BOOLEAN NOT NULL DEFAULT FALSE,
  auto_backup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_backup_hour INTEGER NOT NULL DEFAULT 3 CHECK (auto_backup_hour BETWEEN 0 AND 23),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
