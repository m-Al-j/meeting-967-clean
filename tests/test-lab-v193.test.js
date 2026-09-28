import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(p,'utf8');
const migration=read('migrations/100_test_lab.sql');
const service=read('src/application/services/TestLabService.js');
const app=read('src/app.js');
const repo=read('src/infrastructure/repositories/MeetingRepository.js');
const owner=read('src/interfaces/discord/ownerMeetingCenter.js');
const voice=read('src/interfaces/discord/voiceHandler.js');
const misc=read('src/interfaces/discord/interactions/misc.js');
test('owner-only isolated test lab is wired',()=>{
  assert.match(app,/TestLabService/);
  assert.match(owner,/مختبر التجارب — المالك فقط/);
  assert.match(owner,/owner:meeting-center:testlab/);
  assert.match(migration,/ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE/);
});
test('test meetings are excluded from production flows',()=>{
  assert.match(repo,/COALESCE\(m\.is_test,false\)=false/);
  assert.match(repo,/includeTest=false/);
  assert.match(voice,/includeTest:true/);
  assert.match(misc,/COALESCE\(m\.is_test,false\)=false/);
});
test('test lab uses real recording/report engine but zero outbound delivery',()=>{
  assert.match(service,/recordingService\.start/);
  assert.match(service,/recordingService\.stopByMeeting/);
  assert.match(service,/reportService\.generate/);
  assert.doesNotMatch(service,/deliveryService/);
  assert.match(service,/REAL_MEETING_RUNNING/);
  assert.match(service,/REAL_MEETING_SOON/);
});
