import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service=fs.readFileSync(
  'src/application/services/PointsService.js',
  'utf8'
);
const index=fs.readFileSync(
  'src/index.js',
  'utf8'
);
const migration=fs.readFileSync(
  'migrations/114_membership_points_legacy_bootstrap.sql',
  'utf8'
);

test('zero-point level is explicitly beginner',()=>{
  assert.match(service,/label: 'مبتدئ'/);
  assert.doesNotMatch(service,/label: 'عضو جديد'/);
});

test('requested higher levels remain unchanged',()=>{
  assert.match(service,/label: 'مشارك'/);
  assert.match(service,/label: 'عضو متفاعل'/);
  assert.match(service,/label: 'عضو فاعل'/);
  assert.match(service,/label: 'عضو متميز'/);
});

test('new members trigger immediate rank reconciliation',()=>{
  assert.match(index,/membership-rank-role-new-member-sync-failed/);
  assert.match(index,/app\.pointsService\?\.syncDiscordRoles\?\.\(member\.guild\)/);
});

test('legacy bootstrap only applies to members that existed before cutoff',()=>{
  assert.match(migration,/membership_points_bootstrap/);
  assert.match(migration,/mem\.joined_at < v_cutoff/);
  assert.match(migration,/'bootstrap',true/);
});

test('legacy attendance/task event keys match live idempotency keys',()=>{
  assert.match(migration,/'attendance:'\|\|r\.meeting_id::text\|\|':'\|\|r\.user_id::text/);
  assert.match(migration,/'task:'\|\|r\.id::text\|\|':completion'/);
  assert.match(migration,/'task:'\|\|r\.id::text\|\|':early'/);
});
