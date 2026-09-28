import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync(new URL('../src/interfaces/discord/commands/panel.js',import.meta.url),'utf8');
const reliability=fs.readFileSync(new URL('../src/interfaces/discord/interactionReliability.js',import.meta.url),'utf8');
const misc=fs.readFileSync(new URL('../src/interfaces/discord/interactions/misc.js',import.meta.url),'utf8');

test('Operations 967 keeps the current Components V2 dashboard contract',()=>{
  assert.match(panel,/operations-967-native-dashboard-v1\.9\.7\.5/);
  assert.match(panel,/MessageFlags\.IsComponentsV2/);
  assert.match(panel,/const GOLD=0xD4AF37/);
  assert.match(panel,/const V2_FLAG=MessageFlags\.IsComponentsV2/);
  assert.match(panel,/## مرحباً بك في نظام Operations 967/);
  assert.match(panel,/### ◈ القائمة الرئيسية/);
  assert.match(panel,/الاجتماعات/);
  assert.match(panel,/التسجيلات/);
  assert.match(panel,/التقارير/);
  assert.match(panel,/الأعضاء والفرق/);
  assert.match(panel,/الإعدادات/);
  assert.match(panel,/الدعم/);
  assert.match(panel,/export async function panelSection/);
  assert.match(misc,/id===['\"]panel:section['\"]/);
  assert.match(misc,/panelSection\(i,a,i\.values\?\.\[0\]/);
  assert.doesNotMatch(panel,/attachment:\/\/\$\{BANNER_NAME\}/);
});

test('old V2 dashboard messages still route safely',()=>{
  assert.match(reliability,/sourceIsComponentsV2/);
  assert.match(reliability,/id!==['"]panel:refresh['"]/);
  assert.match(reliability,/deferReply\(\{ephemeral:Boolean\(interaction\.guildId\)\}\)/);
  assert.match(panel,/if\(section===['"]guide['"]\)return personalGuide/);
  assert.match(panel,/return panelHub\(interaction,app,section\)/);
});
