CREATE TABLE IF NOT EXISTS data_archives (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  archive_type TEXT NOT NULL CHECK (archive_type IN ('trial_to_production','manual_snapshot','system_snapshot')),
  label TEXT NOT NULL,
  note TEXT,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('creating','completed','failed')),
  database_dump_path TEXT,
  files_archive_path TEXT,
  manifest_path TEXT,
  database_sha256 TEXT,
  files_sha256 TEXT,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  preserved JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_data_archives_guild_created
  ON data_archives(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_archives_type
  ON data_archives(guild_id, archive_type, created_at DESC);
