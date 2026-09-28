import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r=p=>fs.readFileSync(p,'utf8');

test('special access center is owner-only and independent from teams',()=>{
  const s=r('src/interfaces/discord/ownerAccessCenter.js');
  assert.match(s,/operations967-special-channel-access-v1\.10\.13\.1/);
  assert.match(s,/OWNER_USER_ID/);
  assert.match(s,/special_channel_access/);
  assert.doesNotMatch(s,/teams\.addMember|teamService\.addMember/);
});

test('grant stores previous overwrite and remove restores it',()=>{
  const s=r('src/interfaces/discord/ownerAccessCenter.js');
  assert.match(s,/previousOverwriteFor/);
  assert.match(s,/previous_overwrite/);
  assert.match(s,/restorePayload/);
  assert.match(s,/permissionOverwrites\.edit/);
});

test('member and place inverse views plus multi-select are present',()=>{
  const s=r('src/interfaces/discord/ownerAccessCenter.js');
  assert.match(s,/memberAddSubmit/);
  assert.match(s,/placeAddMembersSubmit/);
  assert.match(s,/setMaxValues/);
  assert.match(s,/كل الوصولات الخاصة/);
});

test('dashboard and router are wired without replacing existing centers',()=>{
  const p=r('src/interfaces/discord/commands/panel.js');
  const q=r('src/interfaces/discord/router.js');
  assert.match(p,/owner:access/);
  assert.match(p,/الأعضاء والوصول|الوصول الخاص/);
  assert.match(q,/handleOwnerAccessCenterInteraction/);
  assert.match(q,/operations967-special-channel-access-v1\.10\.13\.1/);
  const c=r('src/interfaces/discord/ownerAccessCenter.js');
  assert.match(c,/button\('admin:teams','الأعضاء والفرق'/);
});

test('migration is additive and tracks member/channel pair',()=>{
  const s=r('migrations/105_special_channel_access.sql');
  assert.match(s,/CREATE TABLE IF NOT EXISTS special_channel_access/);
  assert.match(s,/PRIMARY KEY \(guild_id,user_id,channel_id\)/);
  assert.match(s,/previous_overwrite JSONB/);
  assert.match(s,/managed_permissions JSONB/);
  assert.doesNotMatch(s,/DROP TABLE|TRUNCATE|DELETE FROM/);
});
