import test from 'node:test';
import assert from 'node:assert/strict';
import { roleIdForTeamDeletion, isDiscordRoleExcluded } from '../src/core/teams/deletionPolicy.js';

test('linked team deletion excludes its exact Discord role',()=>{
  assert.equal(roleIdForTeamDeletion({name:'الإدارة والحوكمة',discord_role_id:'123'},[], '1'),'123');
});

test('manual duplicate can match the original Discord team role without deleting the role',()=>{
  const roles=[{id:'55',name:'فريق الإدارة والحوكمة',managed:false},{id:'1',name:'@everyone',managed:false}];
  assert.equal(roleIdForTeamDeletion({name:'الإدارة والحوكمة',discord_role_id:null},roles,'1'),'55');
});

test('excluded Discord role stays excluded from automatic re-import',()=>{
  assert.equal(isDiscordRoleExcluded('55',new Set(['55'])),true);
  assert.equal(isDiscordRoleExcluded('56',new Set(['55'])),false);
});
