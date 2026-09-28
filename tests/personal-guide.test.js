import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync(new URL('../src/interfaces/discord/commands/panel.js',import.meta.url),'utf8');
const misc=fs.readFileSync(new URL('../src/interfaces/discord/interactions/misc.js',import.meta.url),'utf8');

test('panel exposes detailed personalized guide for every access level',()=>{
  assert.match(panel,/panel:guide/);
  assert.match(panel,/دليلك الشخصي/);
  assert.match(panel,/شرح مفصل/);
  assert.match(panel,/guide:member/);
  assert.match(panel,/guide:help/);
});

test('guide is split into permission-aware sections',()=>{
  assert.match(panel,/guide:meetings/);
  assert.match(panel,/guide:outputs/);
  assert.match(panel,/guide:admin/);
  assert.match(panel,/الأقسام الإدارية المتاحة لك الآن/);
});

test('guide explains member search without member command and automatic outputs',()=>{
  assert.match(panel,/البحث بالاسم أو اليوزر/);
  assert.match(panel,/لا تحتاج `\/member`/);
  assert.match(panel,/التسجيل والتقرير والحفظ والتسليم جزء تلقائي/);
});

test('guide includes troubleshooting instructions',()=>{
  assert.match(panel,/didn’t respond in time/);
  assert.match(panel,/مخرجات الاجتماعات/);
  assert.match(panel,/Audit Log/);
});

test('misc router handles guide pages',()=>{
  assert.match(misc,/panel:guide/);
  assert.match(misc,/startsWith\('guide:'\)/);
  assert.match(misc,/personalGuide/);
});
