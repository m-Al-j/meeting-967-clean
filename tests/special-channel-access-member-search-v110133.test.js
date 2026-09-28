import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const center=fs.readFileSync('src/interfaces/discord/ownerAccessCenter.js','utf8');
const router=fs.readFileSync('src/interfaces/discord/router.js','utf8');

test('member picker uses search-first UI instead of showing every member',()=>{
  assert.match(center,/operations967-special-channel-access-search-v1\.10\.13\.3/);
  assert.match(center,/بحث عن عضو/);
  const start=center.indexOf('async function memberPicker');
  const end=center.indexOf('async function memberView',start);
  const picker=center.slice(start,end);
  assert.doesNotMatch(picker,/humanMembers\(guild\)/);
  assert.doesNotMatch(picker,/paginate\(all/);
});

test('search accepts display name username and Discord ID',()=>{
  assert.match(center,/searchGuildMembers/);
  assert.match(center,/guild\.members\.search\(\{query,limit:25\}\)/);
  assert.match(center,/displayName/);
  assert.match(center,/globalName/);
  assert.match(center,/username/);
  assert.match(center,/\^\\d\{15,22\}\$/);
});

test('search uses a modal and only renders matched results',()=>{
  assert.match(center,/ModalBuilder/);
  assert.match(center,/TextInputBuilder/);
  assert.match(center,/member-search-submit/);
  assert.match(center,/member_query/);
  assert.match(center,/memberSearchResults/);
});

test('router sends modal submissions to access center',()=>{
  assert.match(router,/isModalSubmit\(\)/);
  assert.match(router,/handleOwnerAccessCenterInteraction/);
});

test('DM compatibility and safety remain enabled',()=>{
  assert.doesNotMatch(center,/ACCESS_GUILD_ONLY/);
  assert.match(center,/async function guildFor\(interaction,app\)/);
  assert.match(center,/app\.env\.GUILD_ID/);
  assert.match(center,/await ensureOwner\(interaction,app\)/);
  assert.match(center,/previousOverwriteFor/);
  assert.match(center,/restorePayload/);
  assert.match(center,/special_channel_access/);
});
