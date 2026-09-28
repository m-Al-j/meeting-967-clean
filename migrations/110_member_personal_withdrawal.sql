-- Meeting 967 — personal membership withdrawal / reactivation
ALTER TABLE membership_personal_states
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;

ALTER TABLE membership_personal_states
  ADD COLUMN IF NOT EXISTS withdraw_reason TEXT;

ALTER TABLE membership_personal_states
  ADD COLUMN IF NOT EXISTS reactivation_requested_at TIMESTAMPTZ;

ALTER TABLE membership_personal_states
  ADD COLUMN IF NOT EXISTS reactivation_status TEXT NOT NULL DEFAULT 'none';

DO $$
BEGIN
  ALTER TABLE membership_personal_states
    ADD CONSTRAINT membership_personal_states_reactivation_status_check
    CHECK (reactivation_status IN ('none','pending','approved','rejected'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
