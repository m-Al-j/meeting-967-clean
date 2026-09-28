import test from 'node:test';
import assert from 'node:assert/strict';
import {taskDisplayStatus,canAssigneeTransition} from '../src/core/tasks/state.js';

test('submitted and rejected task states are visible',()=>{
  assert.equal(taskDisplayStatus({status:'in_progress',review_status:'submitted'}),'submitted');
  assert.equal(taskDisplayStatus({status:'in_progress',review_status:'rejected'}),'rejected');
});

test('assignee cannot mark own task done without review',()=>{
  assert.equal(canAssigneeTransition('pending','in_progress'),true);
  assert.equal(canAssigneeTransition('in_progress','pending'),true);
  assert.equal(canAssigneeTransition('in_progress','done'),false);
});
