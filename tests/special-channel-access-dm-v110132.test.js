import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const center=fs.readFileSync('src/interfaces/discord/ownerAccessCenter.js','utf8');
const router=fs.readFileSync('src/interfaces/discord/router.js','utf8');

test('special channel access accepts DM interactions',()=>{
  assert.match(center,/operations967-special-channel-access-dm-v1\.10\.13\.2/);
  assert.doesNotMatch(center,/ACCESS_GUILD_ONLY/);
  assert.doesNotMatch(center,/if\s*\(\s*!interaction\.guildId\s*\)/);
});

test('DM mode resolves configured Discord guild',()=>{
  assert.match(center,/async function guildFor\(interaction,app\)/);
  assert.match(center,/interaction\.guild\s*\?\?/);
  assert.match(center,/app\.env\.GUILD_ID/);
  assert.match(center,/client\.guilds\.(?:cache|get|fetch)/);
});

test('owner protection stays enabled',()=>{
  assert.match(center,/await ensureOwner\(interaction,app\)/);
  assert.match(center,/OWNER_USER_ID/);
});

test('special access safety behavior stays present',()=>{
  assert.match(center,/previousOverwriteFor/);
  assert.match(center,/restorePayload/);
  assert.match(center,/permissionOverwrites\.edit/);
  assert.match(center,/special_channel_access/);
  assert.doesNotMatch(center,/teams\.addMember|teamService\.addMember/);
});

test('router still sends buttons and selects to access center',()=>{
  assert.match(router,/handleOwnerAccessCenterInteraction/);
  assert.match(router,/interaction\.isButton\(\).*interaction\.isAnySelectMenu\(\)/s);
});
