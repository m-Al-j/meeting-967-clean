import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const r=(p)=>fs.readFileSync(p,'utf8');

test('operational DM helper exists and OFF is the only kill switch',()=>{
  const s=r('src/application/services/memberDeliveryControl.js');
  assert.match(s,/export async function operationalDmDeliveryEnabled/);
  assert.match(s,/memberDeliveryMode\(source, guildId\)\) !== DELIVERY_MODES\.OFF/);
});

test('task creation/group DMs no longer require trial access',()=>{
  const s=r('src/application/services/TaskService.js');
  assert.match(s,/operationalDmDeliveryEnabled\(this\.tasks,/);
  assert.doesNotMatch(s,/permissionService\.canUseDm/);
  if(s.includes('createAssignmentGroup'))assert.match(s,/notifyGroupAssignees/);
});

test('meeting and task reminders no longer require trial access',()=>{
  const s=r('src/application/services/AutopilotService.js');
  assert.match(s,/operationalDmDeliveryEnabled\(this\.meetings,/);
  assert.doesNotMatch(s,/permissionService\.canUseDm/);
  if(s.includes('const dmDelivery='))assert.match(s,/const dmAllowed=dmDelivery;/);
});

test('DM panel is restricted by guild membership, not trial permission',()=>{
  const s=r('src/interfaces/discord/router.js');
  assert.match(s,/production-dm:server-member-access/);
  assert.match(s,/guild\.members\.fetch/);
  assert.doesNotMatch(s,/permissionService\.canUseDm/);
});

test('permission notification does not depend on trial access when feature exists',()=>{
  const p='src/interfaces/discord/interactions/permissions.js';
  if(!fs.existsSync(p))return;
  const s=r(p); const at=s.indexOf('async function notifyPermissionUser(');
  if(at<0)return;
  const end=s.indexOf('\nfunction ',at+10); const seg=s.slice(at,end<0?s.length:end);
  assert.doesNotMatch(seg,/canUseDm/);
});
