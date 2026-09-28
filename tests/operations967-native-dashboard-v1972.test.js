import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync(new URL('../src/interfaces/discord/commands/panel.js',import.meta.url),'utf8');
const misc=fs.readFileSync(new URL('../src/interfaces/discord/interactions/misc.js',import.meta.url),'utf8');

test('Operations 967 dashboard is native Components V2 with gold accent',()=>{
  assert.match(panel,/operations-967-native-dashboard-v1\.9\.7\.5/);
  assert.match(panel,/MessageFlags\.IsComponentsV2/);
  assert.match(panel,/const GOLD=0xD4AF37/);
  assert.match(panel,/accent_color:GOLD/);
  assert.match(panel,/مرحباً بك في نظام Operations 967/);
  assert.doesNotMatch(panel,/أهلاً بك في بوت 967/);
});

test('main navigation uses real functional Discord buttons',()=>{
  for(const text of ['الرئيسية','الاجتماعات','التسجيلات','التقارير','الأعضاء والفرق','الإعدادات','الدعم'])assert.match(panel,new RegExp(text));
  for(const id of ['panel:refresh','admin:recordings','admin:reports','admin:settings','support:home'])assert.match(panel,new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(panel,/rows\.push\(v2Row\(\[v2Button/);
});

test('current misc router imports are all exported by panel',()=>{
  const importMatch=misc.match(/import \{([^}]+)\} from ['"]\.\.\/commands\/panel\.js['"]/);
  assert.ok(importMatch,'misc.js panel import not found');
  const imports=importMatch[1].split(',').map(x=>x.trim()).filter(Boolean);
  for(const name of imports)assert.match(panel,new RegExp(`export\\s+async\\s+function\\s+${name}\\b`),`panel.js must export ${name}`);
});


test('deferred Components V2 reply preserves ephemeral state without editing EPHEMERAL flag',()=>{
  assert.match(panel,/const flags=Number\(V2_FLAG\);/);
  assert.doesNotMatch(panel,/V2_FLAG\)\|\(interaction\.guildId\?Number\(MessageFlags\.Ephemeral\)/);
  assert.match(panel,/return \{flags,content:null,embeds:\[\],components:\[container\]\};/);
});

test('dashboard enforces Discord Components V2 container and message limits',()=>{
  assert.match(panel,/container\.components\.length>10/);
  assert.match(panel,/Discord Container child limit exceeded/);
  assert.match(panel,/componentCount>40/);
  assert.match(panel,/duplicate custom_id/);
  assert.match(panel,/menuButtons=menuRows\(profile\)\.flatMap/);
  assert.doesNotMatch(panel,/panel:status:active/);
});

test('panel has a legacy fallback if Discord rejects V2 payload',()=>{
  assert.match(panel,/operations967-v2-panel-send-failed/);
  assert.match(panel,/legacyPanelPayload/);
  assert.match(panel,/return interaction\.editReply\(await legacyPanelPayload/);
});
