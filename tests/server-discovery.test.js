import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStructureName,structureScore,hasTeamMarker,isLikelySystemRole,bestNamed} from '../src/core/teams/serverDiscovery.js';

test('normalizes Arabic team/channel names',()=>{
  assert.equal(normalizeStructureName('فريق الإدارة والحوكمة'),'الاداره والحوكمه');
  assert.equal(normalizeStructureName('اجتماعات الإدارة والحوكمة'),'الاداره والحوكمه');
});

test('matches role with its voice/category name',()=>{
  assert.equal(structureScore('فريق التقنية والبحث','اجتماعات التقنية والبحث'),100);
  assert.ok(structureScore('الإدارة والحوكمة','فريق الإدارة والحوكمة')>=90);
});

test('does not treat common admin/member roles as teams',()=>{
  assert.equal(isLikelySystemRole('Admin'),true);
  assert.equal(isLikelySystemRole('عضو'),true);
  assert.equal(isLikelySystemRole('فريق التقنية'),false);
});

test('recognizes explicit team marker',()=>{
  assert.equal(hasTeamMarker('فريق الإعلام'),true);
  assert.equal(hasTeamMarker('Team Media'),true);
});

test('selects closest named channel',()=>{
  const hit=bestNamed([{name:'اجتماع الإعلام',id:'1'},{name:'اجتماع التقنية',id:'2'}],'فريق التقنية',{minScore:70});
  assert.equal(hit.item.id,'2');
});

test('logical Arabic spelling variants are the same team',async()=>{
  const {sameLogicalTeamName}=await import('../src/core/teams/serverDiscovery.js');
  assert.equal(sameLogicalTeamName('فريق الإدارة والحوكمة','الاداره والحوكمه'),true);
});

test('role membership includes offline members and excludes bots',async()=>{
  const {membersWithRole}=await import('../src/core/teams/serverDiscovery.js');
  const roleId='55';
  const make=(id,{bot=false,online=false,has=true}={})=>({id,user:{bot},presence:online?{status:'online'}:null,roles:{cache:new Map(has?[[roleId,{}]]:[])}});
  const members=new Map([
    ['1',make('1',{online:true})],
    ['2',make('2',{online:false})],
    ['3',make('3',{bot:true,online:true})],
    ['4',make('4',{has:false})]
  ]);
  assert.deepEqual(membersWithRole(members,roleId).map(x=>x.id),['1','2']);
});
