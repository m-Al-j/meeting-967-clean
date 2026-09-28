import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { evaluateRecordingIntegrity, RECORDING_INTEGRITY_VERSION } from '../src/application/services/RecordingService.js';

const row=(start,end,meta={})=>({
  started_at:new Date(start),stopped_at:new Date(end),status:'completed',
  metadata:{integrityGuardVersion:RECORDING_INTEGRITY_VERSION,integrityCoverageStartedAt:new Date(start).toISOString(),integrityCoverageEndedAt:new Date(end).toISOString(),integrityMaxNonReadyMs:0,integrityCompromised:false,...meta},
});
const base=Date.parse('2026-08-30T00:00:00Z');
const at=(ms)=>new Date(base+ms).toISOString();

test('contiguous failover sessions with a small handoff gap are verified',()=>{
  const r=evaluateRecordingIntegrity({
    sessions:[row(at(0),at(300000)),row(at(300500),at(600000))],
    meetingStartedAt:at(0),meetingEndedAt:at(600000),maxGapMs:1500,
  });
  assert.equal(r.ok,true);assert.equal(r.maxGapMs,500);
});

test('large recorder coverage gap blocks publication',()=>{
  const r=evaluateRecordingIntegrity({
    sessions:[row(at(0),at(300000)),row(at(302500),at(600000))],
    meetingStartedAt:at(0),meetingEndedAt:at(600000),maxGapMs:1500,
  });
  assert.equal(r.ok,false);assert.ok(r.reasons.includes('recorder-timeline-gap-too-large'));
});

test('receiver stall flag blocks publication even when session duration looks complete',()=>{
  const r=evaluateRecordingIntegrity({
    sessions:[row(at(0),at(600000),{integrityCompromised:true})],
    meetingStartedAt:at(0),meetingEndedAt:at(600000),maxGapMs:1500,
  });
  assert.equal(r.ok,false);assert.ok(r.reasons.includes('receiver-integrity-compromised'));
});

test('long non-ready interval blocks publication',()=>{
  const r=evaluateRecordingIntegrity({
    sessions:[row(at(0),at(600000),{integrityMaxNonReadyMs:2500})],
    meetingStartedAt:at(0),meetingEndedAt:at(600000),maxGapMs:1500,
  });
  assert.equal(r.ok,false);assert.ok(r.reasons.includes('voice-nonready-gap-too-large'));
});

test('source includes hard integrity gate and single-file delivery gate',async()=>{
  const delivery=await fs.readFile(new URL('../src/application/services/DeliveryService.js',import.meta.url),'utf8');
  const recording=await fs.readFile(new URL('../src/application/services/RecordingService.js',import.meta.url),'utf8');
  const output=await fs.readFile(new URL('../src/application/services/OutputReliabilityService.js',import.meta.url),'utf8');
  const meeting=await fs.readFile(new URL('../src/application/services/MeetingService.js',import.meta.url),'utf8');
  assert.match(delivery,/recording-integrity-delivery-v1\.11\.0/);
  assert.match(delivery,/audioFiles\.length!==1/);
  assert.match(recording,/recording-integrity-guard-v1\.10\.11/);
  assert.match(recording,/recording-integrity-handoff-v1\.10\.11/);
  assert.match(recording,/strategy:.*['"]make-before-break['"]/);
  assert.match(recording,/recording-integrity-prestart-abort-v1\.10\.11/);
  assert.match(recording,/integrityStatus:'needs_recovery'/);
  assert.match(recording,/integrityStatus:'verified'/);
  assert.match(output,/recording-integrity-output-v1\.10\.11/);
  assert.match(meeting,/recording-integrity-meeting-start-v1\.10\.11/);
  assert.match(meeting,/RECORDING_NOT_READY/);
  assert.match(meeting,/recording-integrity-meeting-end-v1\.10\.11/);
  assert.match(meeting,/meetingStartedAt:ended\.started_at/);
});

test('delivery gate never falls back to raw tracks or manual recovery',async()=>{
  const delivery=await fs.readFile(new URL('../src/application/services/DeliveryService.js',import.meta.url),'utf8');
  assert.match(delivery,/recording-integrity-hard-gate-v1\.11\.0/);
  assert.match(delivery,/recording\?\.status !== 'completed'/);
  assert.match(delivery,/integrityVersion !== '1\.10\.11'/);
  assert.match(delivery,/integrityStatus !== 'verified'/);
  assert.match(delivery,/finalPaths\.length !== 1/);
  assert.doesNotMatch(delivery,/manualRecovery!==true/);
});
