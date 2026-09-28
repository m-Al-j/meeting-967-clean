import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePermission } from '../src/core/permissions/PermissionResolver.js';

test('team-scoped report receiver does not leak to another team',()=>{
  const grants=[{permission_key:'reports.receive',effect:'allow',scope_type:'team',scope_id:'team-a'}];
  assert.equal(resolvePermission({isOwner:false,grants,permission:'reports.receive',context:{teamId:'team-a',meetingId:'m1'}}),true);
  assert.equal(resolvePermission({isOwner:false,grants,permission:'reports.receive',context:{teamId:'team-b',meetingId:'m2'}}),false);
});

test('meeting-scoped recording receiver only gets that meeting',()=>{
  const grants=[{permission_key:'recordings.receive',effect:'allow',scope_type:'meeting',scope_id:'m1'}];
  assert.equal(resolvePermission({isOwner:false,grants,permission:'recordings.receive',context:{teamId:'team-a',meetingId:'m1'}}),true);
  assert.equal(resolvePermission({isOwner:false,grants,permission:'recordings.receive',context:{teamId:'team-a',meetingId:'m2'}}),false);
});
