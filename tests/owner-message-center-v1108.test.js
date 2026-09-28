import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r=(p)=>fs.readFileSync(p,'utf8');

test('owner message center route and implementation exist',()=>{
  const s=r('src/interfaces/discord/interactions/misc.js');
  assert.match(s,/operations967-owner-message-center-v1\.10\.8/);
  assert.match(s,/ownerMessages\(i,a,s,id\)/);
  assert.match(s,/ownerMessageUserPicker/);
  assert.match(s,/ownerMessageTeamPicker/);
  assert.match(s,/ownerMessageConfirm/);
});

test('owner-only protection and personalized names exist',()=>{
  const s=r('src/interfaces/discord/interactions/misc.js');
  const at=s.indexOf('async function ownerMessages(');
  const seg=s.slice(at,at+1200);
  assert.match(seg,/await ownerOnly\(s,a\)/);
  assert.match(s,/السلام عليكم يا \$\{name\}/);
  assert.match(s,/replaceAll\('\{name\}',name\)/);
});

test('server/team/user targets exclude bots and support confirmation',()=>{
  const s=r('src/interfaces/discord/interactions/misc.js');
  assert.match(s,/filter\(m=>m\?\.user&&!m\.user\.bot\)/);
  assert.match(s,/mode==='server'/);
  assert.match(s,/a\.teams\.members/);
  assert.match(s,/owner:messages:confirm:/);
  assert.match(s,/OWNER_MESSAGE_DRAFT_TTL/);
});

test('global OFF blocks manual member delivery',()=>{
  const s=r('src/interfaces/discord/interactions/misc.js');
  assert.match(s,/ownerMessageDeliveryIsOff/);
  assert.match(s,/delivery_mode/);
  assert.match(s,/DELIVERY_OFF/);
});

test('dashboard button and modal openers are wired',()=>{
  const p=r('src/interfaces/discord/commands/panel.js');
  const rel=r('src/interfaces/discord/interactionReliability.js');
  assert.match(p,/owner:messages/);
  assert.match(p,/مركز الرسائل/);
  assert.match(rel,/owner:messages:user-search/);
  assert.match(rel,/owner:messages:compose:/);
});
