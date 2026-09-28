import test from 'node:test';
import assert from 'node:assert/strict';
import {autopilotWindow,autoEndDecision} from '../src/core/autopilot/policy.js';

test('autopilot readiness reminder and due-start windows',()=>{
  const base=new Date('2026-08-22T18:00:00Z');
  const scheduled=new Date('2026-08-22T18:20:00Z');
  let w=autopilotWindow({scheduledAt:scheduled,now:base,readinessMinutes:30,reminderMinutes:15,startGraceMinutes:10});
  assert.equal(w.dueReadiness,true);assert.equal(w.dueReminder,false);assert.equal(w.dueStart,false);
  w=autopilotWindow({scheduledAt:scheduled,now:new Date('2026-08-22T18:10:00Z'),readinessMinutes:30,reminderMinutes:15,startGraceMinutes:10});
  assert.equal(w.dueReminder,true);
  w=autopilotWindow({scheduledAt:scheduled,now:new Date('2026-08-22T18:25:00Z'),startGraceMinutes:10});
  assert.equal(w.dueStart,true);assert.equal(w.expired,false);
});

test('autopilot ends after humans leave but not while present',()=>{
  const startedAt=new Date('2026-08-22T18:00:00Z');
  let d=autoEndDecision({startedAt,now:new Date('2026-08-22T18:20:00Z'),humanCount:1,hadHuman:false});
  assert.equal(d.shouldEnd,false);assert.equal(d.nextHadHuman,true);
  d=autoEndDecision({startedAt,now:new Date('2026-08-22T18:23:00Z'),humanCount:0,hadHuman:true,emptySince:new Date('2026-08-22T18:20:00Z'),emptyEndMinutes:2});
  assert.equal(d.shouldEnd,true);assert.equal(d.reason,'empty_after_attendance');
});

test('autopilot no-show timeout ends empty meeting',()=>{
  const d=autoEndDecision({startedAt:new Date('2026-08-22T18:00:00Z'),now:new Date('2026-08-22T18:16:00Z'),humanCount:0,hadHuman:false,noShowEndMinutes:15});
  assert.equal(d.shouldEnd,true);assert.equal(d.reason,'no_show');
});
