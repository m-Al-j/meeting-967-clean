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

test('DM membership home does not append navigation twice',()=>{
  const b=homeBody();

  assert.match(b,/const finalComponents = i\.guildId/);
  assert.match(b,/\? withNavigation\(adminControls\)/);
  assert.match(b,/: adminControls;/);

  const dmBranch=b.match(/const adminControls=i\.guildId[\s\S]*?: rowsFromButtons\(\[[\s\S]*?panel:refresh[\s\S]*?\]\);/);
  assert.ok(dmBranch,'DM fallback navigation branch missing');

  assert.match(b,/components:finalComponents/);
});

test('server membership home still keeps the three admin actions',()=>{
  const b=homeBody();
  assert.match(b,/membership:publish/);
  assert.match(b,/membership:status/);
  assert.match(b,/membership:scan-teams/);
});

test('the exact duplicate-id pattern is gone',()=>{
  const b=homeBody();
  assert.doesNotMatch(
    b,
    /const adminControls=i\.guildId[\s\S]*?withNavigation\(adminControls\)[\s\S]*?panel:refresh/
  );
});
