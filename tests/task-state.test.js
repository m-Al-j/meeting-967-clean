import test from 'node:test';
import assert from 'node:assert/strict';
import {taskDisplayStatus,canAssigneeTransition} from '../src/core/tasks/state.js';

test('unfinished past-due task is displayed as overdue',()=>{
  assert.equal(taskDisplayStatus({status:'pending',due_at:'2026-08-21T00:00:00Z'},new Date('2026-08-22T00:00:00Z')),'overdue');
  assert.equal(taskDisplayStatus({status:'done',due_at:'2026-08-21T00:00:00Z'},new Date('2026-08-22T00:00:00Z')),'done');
});
test('assignee can progress but completion requires reviewer approval',()=>{
  assert.equal(canAssigneeTransition('pending','in_progress'),true);
  assert.equal(canAssigneeTransition('in_progress','pending'),true);
  assert.equal(canAssigneeTransition('in_progress','done'),false);
  assert.equal(canAssigneeTransition('pending','cancelled'),false);
});
