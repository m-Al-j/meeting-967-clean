// Meeting 967 v1.7.9.7 — owner-controlled outgoing delivery modes.
function resolveDb(source) {
  if (source && typeof source.query === 'function') return source;
  if (source?.db && typeof source.db.query === 'function') return source.db;
  return null;
}

export const DELIVERY_MODES = Object.freeze({
  OFF: 'off',
  TEAM_ONLY: 'team_only',
  FULL: 'full',
});

export async function memberDeliveryMode(source, guildId) {
  const db = resolveDb(source);
  if (!db || !guildId) return DELIVERY_MODES.FULL;
  try {
    const { rows } = await db.query(
      'SELECT delivery_mode,member_delivery_enabled FROM member_delivery_control WHERE guild_id=$1 LIMIT 1',
      [String(guildId)],
    );
    const row = rows?.[0];
    if (!row) return DELIVERY_MODES.FULL;
    if (['off','team_only','full'].includes(String(row.delivery_mode))) return String(row.delivery_mode);
    return row.member_delivery_enabled === false ? DELIVERY_MODES.OFF : DELIVERY_MODES.FULL;
  } catch (error) {
    // Before migration finishes, preserve the previous behavior.
    if (['42P01','42703'].includes(String(error?.code ?? ''))) return DELIVERY_MODES.FULL;
    throw error;
  }
}

export async function memberDmDeliveryEnabled(source, guildId) {
  return (await memberDeliveryMode(source, guildId)) === DELIVERY_MODES.FULL;
}

// operations967-production-personal-dm-v1.10.7
// Operational DMs are personal workflow messages (meeting reminders, tasks, reviews).
// They stay enabled in team_only; OFF is the explicit emergency kill switch.
export async function operationalDmDeliveryEnabled(source, guildId) {
  return (await memberDeliveryMode(source, guildId)) !== DELIVERY_MODES.OFF;
}

export async function teamChannelDeliveryEnabled(source, guildId) {
  return (await memberDeliveryMode(source, guildId)) !== DELIVERY_MODES.OFF;
}

// Compatibility with v1.7.9.6 callers: true means some outgoing delivery is allowed.
export async function memberDeliveryEnabled(source, guildId) {
  return teamChannelDeliveryEnabled(source, guildId);
}

export async function setMemberDeliveryMode(source, guildId, mode, actorId = null) {
  const db = resolveDb(source);
  if (!db) throw new Error('Database is unavailable for delivery control.');
  const normalized = String(mode ?? '');
  if (!['off','team_only','full'].includes(normalized)) throw new Error('Invalid delivery mode.');
  const { rows } = await db.query(
    `INSERT INTO member_delivery_control(guild_id,member_delivery_enabled,delivery_mode,updated_by,updated_at)
     VALUES($1,$2,$3,$4,now())
     ON CONFLICT(guild_id)
     DO UPDATE SET member_delivery_enabled=EXCLUDED.member_delivery_enabled,
                   delivery_mode=EXCLUDED.delivery_mode,
                   updated_by=EXCLUDED.updated_by,
                   updated_at=now()
     RETURNING delivery_mode,member_delivery_enabled,updated_by,updated_at`,
    [String(guildId), normalized !== 'off', normalized, actorId ? String(actorId) : null],
  );
  return rows[0];
}

// Compatibility helper for the old two-state UI.
export async function setMemberDeliveryEnabled(source, guildId, enabled, actorId = null) {
  return setMemberDeliveryMode(source, guildId, enabled ? DELIVERY_MODES.FULL : DELIVERY_MODES.OFF, actorId);
}
