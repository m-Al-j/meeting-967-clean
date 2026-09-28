import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionService} from '../src/application/services/PermissionService.js';

test('permission grants are loaded once per interaction subject',async()=>{
  let calls=0;
  const repo={async grantsFor(){calls++;return [{permission_key:'reports.view',effect:'allow',scope_type:'global',scope_id:null,source:'user'}];}};
  const service=new PermissionService({repo,ownerUserId:'1'});
  const subject={guildId:'g',userId:'2',roleIds:['r']};
  assert.equal(await service.hasPotential(subject,'reports.view'),true);
  assert.equal(await service.has(subject,'reports.view'),true);
  assert.equal(await service.hasAnyPotential(subject,['reports.view','meetings.view']),true);
  assert.equal(calls,1);
});
