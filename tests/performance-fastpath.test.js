import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionService} from '../src/application/services/PermissionService.js';
import {guildMemberOptions,invalidateGuildPickerCache} from '../src/interfaces/discord/guildPicker.js';

test('permission cache is reused across consecutive interactions and invalidates on permission revision',async()=>{
  let calls=0,revision=0;
  const repo={
    getRevision(){return revision;},
    async grantsFor(){calls++;return [{permission_key:'reports.view',effect:'allow',scope_type:'global',scope_id:null,source:'user'}];},
    async hasDirectUserPermission(){return true;}
  };
  const service=new PermissionService({repo,ownerUserId:'1',cacheTtlMs:60_000});
  assert.equal(await service.hasPotential({guildId:'g',userId:'2',roleIds:['10']},'reports.view'),true);
  assert.equal(await service.hasPotential({guildId:'g',userId:'2',roleIds:['10']},'reports.view'),true);
  assert.equal(calls,1);
  revision++;
  assert.equal(await service.hasPotential({guildId:'g',userId:'2',roleIds:['10']},'reports.view'),true);
  assert.equal(calls,2);
});

test('member picker fast path uses Discord member cache without network fetch',async()=>{
  const members=new Map([
    ['1',{id:'1',displayName:'أحمد',user:{username:'ahmad',bot:false}}],
    ['2',{id:'2',displayName:'سالم',user:{username:'salem',bot:false}}]
  ]);
  let fetches=0;
  const guild={id:'g-fast',members:{cache:members,async fetch(){fetches++;throw new Error('should not fetch');}}};
  invalidateGuildPickerCache(guild.id);
  const a=await guildMemberOptions(guild);
  const b=await guildMemberOptions(guild);
  assert.equal(a.length,2);
  assert.equal(b.length,2);
  assert.equal(fetches,0);
});

