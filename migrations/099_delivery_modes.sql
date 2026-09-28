-- Meeting 967 v1.7.9.7 — three outgoing delivery modes.
CREATE TABLE IF NOT EXISTS member_delivery_control (
  guild_id BIGINT PRIMARY KEY,
  member_delivery_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_mode TEXT,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE member_delivery_control
  ADD COLUMN IF NOT EXISTS member_delivery_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE member_delivery_control
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT;

-- Upgrade from the previous boolean switch when it exists.
UPDATE member_delivery_control
   SET delivery_mode = CASE WHEN member_delivery_enabled IS FALSE THEN 'off' ELSE 'full' END
 WHERE delivery_mode IS NULL OR delivery_mode NOT IN ('off','team_only','full');

ALTER TABLE member_delivery_control ALTER COLUMN delivery_mode SET DEFAULT 'full';
UPDATE member_delivery_control SET delivery_mode='full' WHERE delivery_mode IS NULL;
ALTER TABLE member_delivery_control ALTER COLUMN delivery_mode SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE member_delivery_control
    ADD CONSTRAINT chk_member_delivery_mode
    CHECK (delivery_mode IN ('off','team_only','full'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
