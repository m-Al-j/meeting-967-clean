ALTER TABLE teams ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual';
DO $$ BEGIN
  ALTER TABLE teams ADD CONSTRAINT chk_teams_source_type CHECK (source_type IN ('manual','discord'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
UPDATE teams SET source_type='discord' WHERE discord_role_id IS NOT NULL;

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS final_paths JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS final_bytes BIGINT NOT NULL DEFAULT 0;

INSERT INTO permissions(permission_key, description_ar) VALUES
('reports.receive','استلام تقارير الاجتماعات تلقائيًا'),
('recordings.receive','استلام تسجيلات الاجتماعات تلقائيًا')
ON CONFLICT(permission_key) DO UPDATE SET description_ar=EXCLUDED.description_ar;

ALTER TABLE settings ALTER COLUMN recording_enabled SET DEFAULT TRUE;
ALTER TABLE settings ALTER COLUMN recording_auto_start SET DEFAULT TRUE;
UPDATE settings SET recording_enabled=TRUE, recording_auto_start=TRUE, updated_at=now();
