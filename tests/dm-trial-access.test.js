import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PermissionService } from '../src/application/services/PermissionService.js';
import { DM_TRIAL_PERMISSION, PERMISSIONS } from '../src/core/permissions/catalog.js';

const service=(direct=false)=>new PermissionService({
  repo:{
    hasDirectUserPermission:async({permission})=>direct && permission===DM_TRIAL_PERMISSION,
    grantsFor:async()=>[]
  },
  ownerUserId:'1'
});

test('owner can always use bot DM',async()=>{
  assert.equal(await service(false).canUseDm({guildId:'g',userId:'1'}),true);
});

test('selected trial user can use bot DM',async()=>{
  assert.equal(await service(true).canUseDm({guildId:'g',userId:'2'}),true);
});

test('unselected user cannot use bot DM',async()=>{
  assert.equal(await service(false).canUseDm({guildId:'g',userId:'2'}),false);
});

test('DM trial permission is hidden from normal permission picker',()=>{
  assert.equal(PERMISSIONS.includes(DM_TRIAL_PERMISSION),false);
});

test('router contains production DM member access gate',()=>{
  const src=fs.readFileSync('src/interfaces/discord/router.js','utf8');
  assert.match(src,/production-dm:server-member-access/);
  assert.match(src,/guild\.members\.fetch/);
  assert.match(src,/DM_PRIVATE/);
  assert.doesNotMatch(src,/permissionService\.canUseDm/);
});
