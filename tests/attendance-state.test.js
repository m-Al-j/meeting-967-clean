import test from 'node:test';import assert from 'node:assert/strict';import {deriveAttendance} from '../src/core/attendance/state.js';
const scheduled=new Date('2026-08-21T18:00:00Z');
test('absence',()=>assert.equal(deriveAttendance({scheduledAt:scheduled}).status,'absent'));
test('excused wins',()=>assert.equal(deriveAttendance({excused:true,scheduledAt:scheduled}).status,'excused'));
test('late and partial',()=>{const d=deriveAttendance({firstJoinAt:new Date('2026-08-21T18:20:00Z'),scheduledAt:scheduled,lateAfterMinutes:10,totalSeconds:1800,meetingDurationSeconds:3600});assert.equal(d.status,'late');assert.equal(d.fullAttendance,false);assert.equal(d.presenceRatio,0.5);});
