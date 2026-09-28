CREATE TABLE IF NOT EXISTS archive_documents (
  id UUID PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  label TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_archive_documents_guild_created
  ON archive_documents(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_archive_documents_section
  ON archive_documents(guild_id, section_key, created_at DESC);

INSERT INTO permissions(permission_key, description_ar) VALUES
  ('archive.documents.view', 'عرض وتنزيل مستندات الأرشيف الرسمية ضمن النطاق المسموح'),
  ('archive.documents.generate', 'إنشاء مستندات الأرشيف الرسمية ضمن النطاق المسموح')
ON CONFLICT(permission_key) DO UPDATE SET description_ar=EXCLUDED.description_ar;
