import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(
  'src/interfaces/discord/interactions/membership.js',
  'utf8'
);

function homeBody(){
  const start=ui.indexOf('async function home(i,a,s){');
  const end=ui.indexOf('async function scanTeams(i,a,s){',start);
  assert.ok(start>=0,'home not found');
  assert.ok(end>start,'scanTeams boundary not found');
  return ui.slice(start,end);
}

test('admin membership action buttons are rendered only in the server',()=>{
  const b=homeBody();

  assert.match(b,/const adminControls=i\.guildId/);
  assert.match(b,/membership:publish/);
  assert.match(b,/membership:status/);
  assert.match(b,/membership:scan-teams/);
  assert.match(b,/if\(!i\.guildId\)/);
  assert.match(b,/تم إخفاء إجراءات النشر والتنفيذ/);
});

test('the publish guard remains intact as defense in depth',()=>{
  const start=ui.indexOf('async function publish(i,a,s){');
  const end=ui.indexOf('async function status(i,a,s){',start);
  assert.ok(start>=0 && end>start);
  const b=ui.slice(start,end);

  assert.match(b,/isDirectMessage/);
  assert.match(b,/i\.channel\?\.isDMBased/);
  assert.match(b,/membershipReviewService\.publish/);
});
