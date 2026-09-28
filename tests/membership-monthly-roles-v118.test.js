import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service=fs.readFileSync(
  process.env.SERVICE_PATH,
  'utf8'
);
const index=fs.readFileSync(
  process.env.INDEX_PATH,
  'utf8'
);
const migration=fs.readFileSync(
  process.env.MIGRATION_PATH,
  'utf8'
);

test('baseline memberships use ordinary and new with distinct colors',()=>{
  assert.match(service,/key:\s*'ordinary'/);
  assert.match(service,/name:\s*'🔹 عضو عادي'/);
  assert.match(service,/color:\s*0x64748B/);
  assert.match(service,/key:\s*'new'/);
  assert.match(service,/name:\s*'🌱 عضو جديد'/);
  assert.match(service,/color:\s*0x22C55E/);
});

test('promotion thresholds are monthly',()=>{
  assert.match(service,/key:\s*'participant'[\s\S]*?minPoints:\s*100/);
  assert.match(service,/key:\s*'engaged'[\s\S]*?minPoints:\s*250/);
  assert.match(service,/key:\s*'active'[\s\S]*?minPoints:\s*500/);
  assert.match(service,/key:\s*'distinguished'[\s\S]*?minPoints:\s*1000/);
  assert.match(service,/created_at >= \$2/);
  assert.match(service,/created_at < \$3/);
});

test('monthly award replaces the baseline role and can return to baseline',()=>{
  assert.match(service,/membership_monthly_rank_awards/);
  assert.match(service,/roleForMonthlyPoints/);
  assert.match(service,/applyRoleKey/);
  assert.match(service,/baselineKey/);
});

test('a new member who earns any monthly rank becomes ordinary thereafter',()=>{
  assert.match(
    service,
    /selected\.kind === 'rank'[\s\S]*?baseline_key='ordinary'/
  );
  assert.match(
    service,
    /String\(row\.baseline_key \|\| 'ordinary'\) === 'new'[\s\S]*?UPDATE membership_member_baselines/
  );
});

test('new members get the new-member baseline',()=>{
  assert.match(index,/membership-monthly-role-new-member-handler-v1\.0\.17/);
  assert.match(index,/membershipRoleService\?\.handleNewMember\?\.\(member\)/);
});

test('old lifetime/weekly role synchronization is no longer started',()=>{
  assert.doesNotMatch(
    index,
    /app\.pointsService\?\.(?:startDiscordRoleSync|startMembershipBaselineRoleSync)\?\.\(guild\)/
  );
  assert.match(index,/membershipRoleService=new MembershipRoleService/);
  assert.match(index,/membershipRoleService\.start\(guild\)/);
});

test('first full month starts after activation',()=>{
  assert.match(migration,/first_full_month_start/);
  assert.match(migration,/interval '1 month'/);
});

test('all currently known members are frozen as ordinary at activation',()=>{
  assert.match(
    migration,
    /INSERT INTO membership_member_baselines[\s\S]*?SELECT[\s\S]*?'ordinary'/
  );
});

test('migration does not depend on missing legacy baseline/settings tables',()=>{
  assert.doesNotMatch(migration,/membership_rank_baseline/);
  assert.doesNotMatch(migration,/FROM\s+settings\b/i);
  assert.match(migration,/activated_at\s+TIMESTAMPTZ/);
  assert.match(migration,/Asia\/Riyadh/);
});

test('legacy member-add sync cannot revive lifetime roles',()=>{
  assert.doesNotMatch(index,/membership-rank-role-new-member-sync-failed/);
  assert.doesNotMatch(index,/app\.pointsService\?\.syncDiscordRoles/);
  assert.doesNotMatch(index,/startDiscordRoleSync/);
  assert.match(index,/membershipRoleService\?\.handleNewMember\?\.\(member\)/);
});

test('legacy historical bootstrap is not part of the monthly migration',()=>{
  assert.doesNotMatch(migration,/114_membership_points_legacy_bootstrap\.sql/);
  assert.doesNotMatch(migration,/membership_points_bootstrap/);
});

test('weekly membership is explicitly disabled',()=>{
  assert.match(service,/🏆 عضو الأسبوع/);
});
