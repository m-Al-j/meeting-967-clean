import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');

test('team manager uses the application database and not a second private pg pool',()=>{
  const s=read('src/interfaces/discord/interactions/teamManagers.js');
  assert.doesNotMatch(s,/new pg\.Pool/);
  assert.match(s,/app\.db\.query/);
});

test('team manager search modal is protected from early defer',()=>{
  const s=read('src/interfaces/discord/interactionReliability.js');
  assert.match(s,/id === 'perm:team-manager-search'/);
});

test('team manager modal submit does not manually defer a second time',()=>{
  const s=read('src/interfaces/discord/interactions/teamManagers.js');
  const start=s.indexOf("if (id === 'perm:team-manager-search-modal'");
  const end=s.indexOf("if (id === 'perm:team-manager-search-result')",start);
  const segment=s.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.doesNotMatch(segment,/deferReply\(/);
});

test('team manager validates active team membership before assignment',()=>{
  const s=read('src/interfaces/discord/interactions/teamManagers.js');
  assert.match(s,/isActiveTeamMember\(app, team\.id, subject\.guildId, userId\)/);
  assert.match(s,/NOT_ACTIVE_TEAM_MEMBER/);
});

test('team manager assignment, change and removal write audit records',()=>{
  const s=read('src/interfaces/discord/interactions/teamManagers.js');
  for(const action of ['team.manager.assigned','team.manager.changed','team.manager.removed']) assert.match(s,new RegExp(action));
  assert.match(s,/app\.audit\.log/);
});

test('team manager permission cache can be invalidated immediately',()=>{
  const s=read('src/infrastructure/repositories/PermissionRepository.js');
  assert.match(s,/touchRevision\(\)/);
  const ui=read('src/interfaces/discord/interactions/teamManagers.js');
  assert.match(ui,/app\.permissions\?\.touchRevision\?\.\(\)/);
});

test('team manager UI has assign/change and confirmed removal flow',()=>{
  const s=read('src/interfaces/discord/interactions/teamManagers.js');
  assert.match(s,/تعيين مسؤول الفريق/);
  assert.match(s,/تغيير مسؤول الفريق/);
  assert.match(s,/perm:team-manager-revoke-confirm/);
});
