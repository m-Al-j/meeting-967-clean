-- Meeting 967 v1.7.9.6 — owner-controlled automatic member delivery switch.
CREATE TABLE IF NOT EXISTS member_delivery_control (
  guild_id BIGINT PRIMARY KEY,
  member_delivery_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
