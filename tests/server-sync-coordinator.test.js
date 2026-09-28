import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerSyncCoordinator } from '../src/application/services/ServerSyncCoordinator.js';

const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('automatic sync debounces repeated Discord structure changes',async()=>{
  let calls=0;const refresh=[];
  const teamService={autoImportFromGuild:async args=>{calls++;refresh.push(args.refreshMembers);return {teams:2,syncedMembers:4,linkedVoice:2,linkedText:2,errors:[]};}};
  const sync=new ServerSyncCoordinator({teamService,guild:{id:'1'},actorId:'owner',logger:{error(){}},debounceMs:20,intervalMs:10000});
  sync.schedule('role-created');
  sync.schedule('channel-created');
  sync.schedule('channel-updated');
  await wait(55);
  assert.equal(calls,1);
  assert.deepEqual(refresh,[false]);
  sync.stop();
});

test('startup refreshes members from Discord',async()=>{
  let refreshMembers=null;
  const teamService={autoImportFromGuild:async args=>{refreshMembers=args.refreshMembers;return {teams:1,syncedMembers:1,linkedVoice:1,linkedText:1,errors:[]};}};
  const sync=new ServerSyncCoordinator({teamService,guild:{id:'1'},actorId:'owner',logger:{error(){}}});
  await sync.run('startup');
  assert.equal(refreshMembers,true);
  sync.stop();
});

test('automatic sync does not throw when discovery fails',async()=>{
  const teamService={autoImportFromGuild:async()=>{throw new Error('boom');}};
  const sync=new ServerSyncCoordinator({teamService,guild:{id:'1'},actorId:'owner',logger:{error(){}}});
  const result=await sync.run('startup');
  assert.equal(result,null);
  assert.equal(sync.lastError.message,'boom');
  sync.stop();
});
