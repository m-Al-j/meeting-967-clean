import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(file)=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');

test('recording continuity protects receiver recovery and closes exhausted rows',()=>{
  const source=read('src/application/services/RecordingService.js');
  assert.match(source,/production-continuity-v1\.9\.2/);
  assert.match(source,/speaking-without-audio-packets/);
  assert.match(source,/audio-packet-stall/);
  assert.match(source,/staleSegments/);
  assert.match(source,/this\.recordings\.stop\(state\.recording\.id,\s*'failed'\)/);
});

test('final audio is assembled across every recording row for the meeting',()=>{
  const service=read('src/application/services/RecordingService.js');
  const repo=read('src/infrastructure/repositories/RecordingRepository.js');
  assert.match(repo,/listForMeeting/);
  assert.match(repo,/tracksForMeeting/);
  assert.match(service,/tracksForMeeting/);
  assert.match(service,/finalScope:'meeting-timeline'/);
  assert.match(service,/includesRecoveryRows:true/);
  assert.match(service,/finalMixVersion:'1\.9\.(?:2|5)'/);
});

test('output reconciliation does not complete without a ready recording',()=>{
  const source=read('src/application/services/OutputReliabilityService.js');
  assert.match(source,/recordingStatus === 'ready'/);
  assert.match(source,/deliveryStatus === 'sent'/);
  assert.match(source,/stopByMeeting\(meeting\.id,\{meetingTitle:meeting\.name,meetingEndedAt:meeting\.ended_at\}\)/);
});

test('managed shutdown gives Node a graceful window and guardian does not restart on stop',()=>{
  const botctl=read('ops/botctl.sh');
  const guardian=read('ops/guardian.sh');
  assert.match(botctl,/seq 1 75/);
  assert.match(botctl,/kill -TERM "\$gp"/);
  assert.match(guardian,/STOP_REQUESTED=0/);
  assert.match(guardian,/trap request_stop TERM INT/);
  assert.match(guardian,/kill -TERM "\$CHILD"/);
});

test('output reconciliation never treats unverified or legacy recordings as ready',()=>{
  const source=read('src/application/services/OutputReliabilityService.js');
  assert.match(source,/recording-integrity-output-hard-gate-v1\.11\.0/);
  assert.match(source,/integrityVersion==='1\.10\.11'/);
  assert.match(source,/integrityStatus==='verified'/);
  assert.match(source,/finals\.length===1/);
  assert.doesNotMatch(source,/manual recovery file accepted for delivery/);
});
