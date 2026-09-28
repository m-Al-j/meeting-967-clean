import { normalizeStructureName } from './serverDiscovery.js';

export function roleIdForTeamDeletion(team, roles = [], guildId = null) {
  if (team?.discord_role_id) return String(team.discord_role_id);
  const key = normalizeStructureName(team?.name ?? '');
  if (!key) return null;
  const match = [...roles].find(role => !role?.managed && String(role?.id) !== String(guildId ?? '') && normalizeStructureName(role?.name ?? '') === key);
  return match ? String(match.id) : null;
}

export function isDiscordRoleExcluded(roleId, excludedRoleIds) {
  const values = excludedRoleIds instanceof Set ? excludedRoleIds : new Set(excludedRoleIds ?? []);
  return values.has(String(roleId));
}
