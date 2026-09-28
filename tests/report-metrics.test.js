import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceSummary, arrivalLabel, formatDuration, meetingStatusLabel } from '../src/core/reports/metrics.js';

test('official report duration format',()=>{
  assert.equal(formatDuration(20),'00:00:20');
  assert.equal(formatDuration(3661),'01:01:01');
});

test('official report attendance summary mirrors expected attendance logic',()=>{
  const scheduled='2026-08-20T03:00:00.000Z';
  const rows=[
    {status:'present',first_join_at:'2026-08-20T03:00:00.000Z',presence_ratio:1,full_attendance:true,join_count:1},
    {status:'late',first_join_at:'2026-08-20T03:20:00.000Z',presence_ratio:0.75,full_attendance:false,join_count:2},
    {status:'absent',first_join_at:null,presence_ratio:0,full_attendance:false,join_count:0},
    {status:'excused',first_join_at:null,presence_ratio:0,full_attendance:false,join_count:0},
  ];
  const x=attendanceSummary(rows,3600,scheduled);
  assert.equal(x.expected,4);
  assert.equal(x.attended,2);
  assert.equal(x.absent,1);
  assert.equal(x.excused,1);
  assert.equal(x.attendanceRate,50);
  assert.equal(x.full,1);
  assert.equal(x.partial,1);
  assert.equal(x.joins,3);
  assert.equal(arrivalLabel(rows[0],scheduled),'في الموعد');
  assert.equal(arrivalLabel(rows[1],scheduled),'متأخر');
});

test('meeting status Arabic label',()=>{
  assert.equal(meetingStatusLabel('ended'),'مكتمل');
  assert.equal(meetingStatusLabel('postponed'),'مؤجل');
});
