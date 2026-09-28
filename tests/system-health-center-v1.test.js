import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service=fs.readFileSync(new URL('../src/application/services/SystemHealthService.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const owner=fs.readFileSync(new URL('../src/interfaces/discord/ownerMeetingCenter.js',import.meta.url),'utf8');

test('system health center service has safe operational checks',()=>{
  assert.match(service,/operations967-system-health-center-v1:service/);
  assert.match(service,/SELECT 1/);
  assert.match(service,/RECORDING_WORKER_TOKEN_/);
  assert.match(service,/workerSummary/);
  assert.match(service,/statfs/);
  assert.match(service,/system-health-owner-alert/);
  assert.doesNotMatch(service,/console\.log\(.*TOKEN/i);
});

test('system health service is wired into lifecycle',()=>{
  assert.match(app,/systemHealthService/);
  assert.match(index,/systemHealthService\?\.start/);
  assert.match(index,/systemHealthService\?\.stop/);
});

test('owner meeting center exposes health screens',()=>{
  assert.match(owner,/owner:meeting-center:health/);
  assert.match(owner,/health-workers/);
  assert.match(owner,/health-recordings/);
  assert.match(owner,/health-errors/);
  assert.match(owner,/صحة النظام/);
});
