import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync('src/interfaces/discord/commands/panel.js','utf8');
const support=fs.readFileSync('src/interfaces/discord/interactions/support.js','utf8');
const reliability=fs.readFileSync('src/interfaces/discord/interactionReliability.js','utf8');
const dispatcher=fs.readFileSync('src/interfaces/discord/componentDispatcher.js','utf8');
const migration=fs.readFileSync('migrations/012_support_requests.sql','utf8');

test('every panel exposes help and support',()=>{
  assert.match(panel,/support:home/);
  assert.match(panel,/المساعدة والدعم/);
  assert.match(panel,/حساب المسؤول هو <@\$\{ownerUserId\}>/);
});

test('support center supports problem, help, tracking, owner inbox and direct owner contact',()=>{
  for(const token of ['support:problem','support:help','support:mine','support:admin','التواصل مع المسؤول','OWNER_USER_ID']) assert.match(support,new RegExp(token));
  assert.match(support,/discord\.com\/users\/\$\{ownerId\}/);
});

test('support modal openers are not deferred and support has a direct dispatcher',()=>{
  assert.match(reliability,/id === 'support:problem'/);
  assert.match(reliability,/id === 'support:help'/);
  assert.match(reliability,/return 'support'/);
  assert.match(dispatcher,/handleSupport/);
});

test('support requests are persisted',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS support_requests/);
  assert.match(migration,/status TEXT NOT NULL DEFAULT 'open'/);
});
