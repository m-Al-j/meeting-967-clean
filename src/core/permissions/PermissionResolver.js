import { SCOPE_RANK } from './catalog.js';

export function scopeMatches(grant, context = {}) {
  if (grant.scope_type === 'global') return true;
  if (grant.scope_type === 'team') return Boolean(context.teamId) && String(grant.scope_id) === String(context.teamId);
  if (grant.scope_type === 'meeting') return Boolean(context.meetingId) && String(grant.scope_id) === String(context.meetingId);
  return false;
}

export function resolvePermission({ isOwner, grants, permission, context = {} }) {
  if (isOwner) return true;
  const candidates = grants
    .filter((g) => g.permission_key === permission && scopeMatches(g, context))
    .map((g) => ({ ...g, rank: SCOPE_RANK[g.scope_type] ?? 0 }));
  if (!candidates.length) return false;
  const maxRank = Math.max(...candidates.map((g) => g.rank));
  const mostSpecific = candidates.filter((g) => g.rank === maxRank);
  if (mostSpecific.some((g) => g.effect === 'deny')) return false;
  return mostSpecific.some((g) => g.effect === 'allow');
}
