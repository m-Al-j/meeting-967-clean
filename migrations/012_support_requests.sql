-- Meeting 967 v1.4.0: in-bot help desk and issue reporting.
CREATE TABLE IF NOT EXISTS support_requests (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('problem','help')),
  category TEXT NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  owner_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_support_requests_guild_status ON support_requests(guild_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_user ON support_requests(guild_id,user_id,created_at DESC);
