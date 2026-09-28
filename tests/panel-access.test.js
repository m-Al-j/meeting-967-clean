import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionService} from '../src/application/services/PermissionService.js';
const repo=(rows)=>({grantsFor:async()=>rows});
test('owner has potential access without grants',async()=>{const s=new PermissionService({repo:repo([]),ownerUserId:'1'});assert.equal(await s.hasPotential({guildId:'g',userId:'1',roleIds:[]},'reports.view'),true);});
test('team-scoped allow makes delegated panel section available',async()=>{const s=new PermissionService({repo:repo([{permission_key:'reports.view',effect:'allow',scope_type:'team',scope_id:'t1'}]),ownerUserId:'1'});assert.equal(await s.hasPotential({guildId:'g',userId:'2',roleIds:[]},'reports.view'),true);});
test('same-scope deny removes potential grant',async()=>{const s=new PermissionService({repo:repo([{permission_key:'reports.view',effect:'allow',scope_type:'team',scope_id:'t1'},{permission_key:'reports.view',effect:'deny',scope_type:'team',scope_id:'t1'}]),ownerUserId:'1'});assert.equal(await s.hasPotential({guildId:'g',userId:'2',roleIds:[]},'reports.view'),false);});
