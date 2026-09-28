import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const center=fs.readFileSync('src/interfaces/discord/ownerAccessCenter.js','utf8');

test('member search modal is acknowledged before network search',()=>{
  assert.match(center,/operations967-special-channel-access-search-runtime-v1\.10\.13\.4/);
  const start=center.indexOf('async function memberSearchResults');
  const end=center.indexOf('async function memberPicker',start);
  const block=center.slice(start,end);
  const ack=block.indexOf('await acknowledgeMemberSearch(interaction)');
  const search=block.indexOf('await searchGuildMembers(guild,query)');
  assert.ok(ack>=0,'missing early acknowledge');
  assert.ok(search>ack,'search must happen after acknowledge');
});

test('deferred modal edits original message instead of second initial response',()=>{
  assert.match(center,/interaction\.deferUpdate\(\)/);
  assert.match(center,/interaction\.editReply\(payload\)/);
  assert.match(center,/interaction\.deferred\|\|interaction\.replied/);
});

test('search failure has graceful fallback',()=>{
  assert.match(center,/Never crash the whole access center/);
  assert.match(center,/guild\.members\.cache\.values\(\)/);
  assert.match(center,/تعذر البحث البعيد مؤقتًا/);
});

test('DM and special-access safety remain intact',()=>{
  assert.doesNotMatch(center,/ACCESS_GUILD_ONLY/);
  assert.match(center,/async function guildFor\(interaction,app\)/);
  assert.match(center,/app\.env\.GUILD_ID/);
  assert.match(center,/await ensureOwner\(interaction,app\)/);
  assert.match(center,/previousOverwriteFor/);
  assert.match(center,/restorePayload/);
  assert.match(center,/special_channel_access/);
});
