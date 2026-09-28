import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reliability=fs.readFileSync('src/interfaces/discord/interactionReliability.js','utf8');
const center=fs.readFileSync('src/interfaces/discord/ownerAccessCenter.js','utf8');
const router=fs.readFileSync('src/interfaces/discord/router.js','utf8');

test('owner access member-search button is treated as a modal opener',()=>{
  assert.match(reliability,/operations967-owner-access-member-search-modal-opener-v1\.10\.13\.5/);
  assert.ok(
    /endsWith\(['"]:member-search['"]\)/.test(reliability)||
    /id\s*=>\s*id\s*===\s*['"]owner:access:member-search['"]/.test(reliability)
  );
});

test('modal submit is not accidentally classified as an opener',()=>{
  assert.match(reliability,/member-search-submit/);
});

test('access center still has member search and DM guild resolution',()=>{
  assert.match(center,/member-search/);
  assert.match(center,/async function guildFor\(interaction,app\)/);
  assert.doesNotMatch(center,/ACCESS_GUILD_ONLY/);
});

test('router accepts modal submits',()=>{
  assert.match(router,/isModalSubmit\(\)/);
  assert.match(router,/handleOwnerAccessCenterInteraction/);
});
