import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionService } from '../src/application/services/PermissionService.js';
import { SUPER_ADMIN_PERMISSION } from '../src/core/permissions/catalog.js';

const serviceFor=(rows)=>new PermissionService({repo:{grantsFor:async()=>rows},ownerUserId:'1'});
const subject={guildId:'g',userId:'2',roleIds:['r1']};

test('direct global super admin gets every normal permission',async()=>{
  const s=serviceFor([{permission_key:SUPER_ADMIN_PERMISSION,effect:'allow',scope_type:'global',scope_id:null,source:'user'}]);
  assert.equal(await s.isSuperAdmin(subject),true);
  assert.equal(await s.has(subject,'permissions.manage'),true);
  assert.equal(await s.has(subject,'settings.manage'),true);
  assert.equal(await s.has(subject,'meetings.create',{teamId:'t1'}),true);
});

test('super admin through role is ignored',async()=>{
  const s=serviceFor([{permission_key:SUPER_ADMIN_PERMISSION,effect:'allow',scope_type:'global',scope_id:null,source:'role'}]);
  assert.equal(await s.isSuperAdmin(subject),false);
  assert.equal(await s.has(subject,'permissions.manage'),false);
});

test('team-scoped super admin is ignored',async()=>{
  const s=serviceFor([{permission_key:SUPER_ADMIN_PERMISSION,effect:'allow',scope_type:'team',scope_id:'t1',source:'user'}]);
  assert.equal(await s.isSuperAdmin(subject),false);
  assert.equal(await s.has(subject,'settings.manage',{teamId:'t1'}),false);
});
