import test from 'node:test';import assert from 'node:assert/strict';import {resolvePermission} from '../src/core/permissions/PermissionResolver.js';
test('owner always allowed',()=>assert.equal(resolvePermission({isOwner:true,grants:[],permission:'meetings.create'}),true));
test('global allow works',()=>assert.equal(resolvePermission({isOwner:false,grants:[{permission_key:'meetings.view',effect:'allow',scope_type:'global',scope_id:null}],permission:'meetings.view'}),true));
test('deny wins at same specificity',()=>assert.equal(resolvePermission({isOwner:false,grants:[{permission_key:'meetings.view',effect:'allow',scope_type:'team',scope_id:'t1'},{permission_key:'meetings.view',effect:'deny',scope_type:'team',scope_id:'t1'}],permission:'meetings.view',context:{teamId:'t1'}}),false));
