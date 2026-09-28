import test from 'node:test';
import assert from 'node:assert/strict';
import {levelForPoints,ACHIEVEMENTS} from '../src/application/services/PointsService.js';

test('points levels increase at configured thresholds',()=>{
  assert.equal(levelForPoints(0).key,'new');
  assert.equal(levelForPoints(99).key,'new');
  assert.equal(levelForPoints(100).key,'participant');
  assert.equal(levelForPoints(249).key,'participant');
  assert.equal(levelForPoints(250).key,'contributor');
  assert.equal(levelForPoints(500).key,'active');
  assert.equal(levelForPoints(1000).key,'distinguished');
});

test('achievement catalog contains task, attendance and support milestones',()=>{
  const keys=new Set(ACHIEVEMENTS.map(x=>x.key));
  assert(keys.has('task-finisher-3'));
  assert(keys.has('meeting-regular-5'));
  assert(keys.has('supporter-3'));
});

test('points are designed as numeric balance rather than Discord roles',()=>{
  assert.equal(typeof levelForPoints(125).min,'number');
});
