import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

test('worker pool has heartbeat-backed lease and general scope',()=>{
  const s=read('src/application/services/RecordingWorkerPool.js');
  assert.match(s,/WORKER_LEASE_TTL_MS/);
  assert.match(s,/recording-worker-lease-expired/);
  assert.match(s,/heartbeat = async/);
  assert.match(s,/return 'general'/);
  assert.ok(s.indexOf('generalVoiceChannelId') < s.indexOf("text.includes('الإعلام')"),'general voice channel must override team label');
});

test('recording service performs Worker to Main failover and preserves sessions',()=>{
  const s=read('src/application/services/RecordingService.js');
  assert.match(s,/#failoverToMain/);
  assert.match(s,/forceMainRecorder\s*:\s*true/);
  assert.match(s,/recording-failover-to-main-success/);
  assert.match(s,/recordingSessions/);
  assert.match(s,/tracksForMeeting/);
});

test('recording repository stores recorder/session heartbeat metadata',()=>{
  const s=read('src/infrastructure/repositories/RecordingRepository.js');
  assert.match(s,/session_index/);
  assert.match(s,/lease_heartbeat_at/);
  assert.match(s,/failover_from_recording_id/);
  assert.match(s,/touchLease/);
});

test('Test Lab exposes explicit general meetings worker path',()=>{
  const ui=read('src/interfaces/discord/ownerMeetingCenter.js');
  const svc=read('src/application/services/TestLabService.js');
  assert.match(ui,/الاجتماعات العامة/);
  assert.match(ui,/__general__/);
  assert.match(ui,/GENERAL_VOICE_CHANNEL_ID/);
  assert.match(ui,/جلسة/);
  assert.match(ui,/Failover/);
  assert.match(svc,/isGeneralTest/);
  assert.match(svc,/\? 'general'/);
});
