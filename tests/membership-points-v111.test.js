import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service=fs.readFileSync('src/application/services/PointsService.js','utf8');
const index=fs.readFileSync('src/index.js','utf8');
const migration=fs.readFileSync(
  'migrations/114_membership_points_legacy_bootstrap.sql',
  'utf8'
);

test('zero-point level is beginner',()=>{
  assert.match(
    service,
    /key:\s*'new'\s*,\s*label:\s*'مبتدئ'/
  );
  assert.doesNotMatch(
    service,
    /key:\s*'new'\s*,\s*label:\s*'عضو جديد'/
  );
});

test('higher levels remain unchanged',()=>{
  assert.match(service,/label:\s*'مشارك'/);
  assert.match(service,/label:\s*'عضو متفاعل'/);
  assert.match(service,/label:\s*'عضو فاعل'/);
  assert.match(service,/label:\s*'عضو متميز'/);
});

test('new members get an immediate rank reconciliation',()=>{
  assert.match(index,/membership-rank-role-new-member-sync-failed/);
  assert.match(
    index,
    /app\.pointsService\?\.\s*syncDiscordRoles\?\.\(member\.guild\)/
  );
});

test('bootstrap is one-time and uses member join cutoff',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS membership_points_bootstrap/);
  assert.match(migration,/mem\.joined_at < v_cutoff/);
  assert.match(migration,/'bootstrap',true/);
});

test('historical attendance is de-duplicated by source fields',()=>{
  assert.match(migration,/mpl\.point_type='attendance'/);
  assert.match(migration,/mpl\.source_type='meeting'/);
  assert.match(migration,/mpl\.source_id=r\.meeting_id::text/);
});

test('task bootstrap reuses idempotent live event keys',()=>{
  assert.match(migration,/task:'\|\|r\.id::text\|\|':completion/);
  assert.match(migration,/task:'\|\|r\.id::text\|\|':early/);
});
