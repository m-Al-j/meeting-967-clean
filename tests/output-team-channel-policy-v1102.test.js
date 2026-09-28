import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeliveryService } from '../src/application/services/DeliveryService.js';

test('v1.10.2 sends the report to the team channel once and never scans DM recipients', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'meeting967-output-policy-'));
  const reportPath=path.join(dir,'report.docx');
  await fs.writeFile(reportPath,Buffer.from('docx-test'));
  let channelSends=0;
  let memberFetches=0;
  const channel={isTextBased:()=>true,send:async()=>({id:`m-${++channelSends}`})};
  const db={query:async(sql)=>{
    const q=String(sql);
    if(q.includes('member_delivery_control'))return {rows:[{delivery_mode:'full',member_delivery_enabled:true}]};
    if(q.includes('SELECT notification_channel_id FROM teams'))return {rows:[{notification_channel_id:'team-text-1'}]};
    if(q.includes('meeting.attendance_report.team_channel.sent'))return {rows:[]};
    throw new Error(`unexpected query: ${q}`);
  }};
  const guild={
    id:'guild-1',
    members:{fetch:async()=>{memberFetches++;throw new Error('DM recipient scan must never happen');},cache:new Map()},
    channels:{fetch:async(id)=>id==='team-text-1'?channel:null},
    client:{users:{fetch:async()=>{throw new Error('user DM fetch must never happen');}}},
  };
  const meeting={id:'meeting-1',team_id:'team-1',team_name:'فريق التقنية',name:'اجتماع المتابعة'};
  const service=new DeliveryService({
    permissionService:{grants:async()=>{throw new Error('permission DM scan must never happen');}},
    recordings:{},outputs:null,meetings:{db},tasks:null,
    audit:{log:async()=>{}},ownerUserId:'owner-1',logger:{warn:()=>{}},
  });
  assert.deepEqual(await service.recipients({guild,meeting}),[]);
  const first=await service.deliverMeetingOutputs({guild,meeting,report:{id:'r1',path:reportPath,metadata:{}},recording:null});
  assert.equal(memberFetches,0);
  assert.equal(channelSends,1);
  assert.equal(first.length,1);
  assert.equal(first[0].destination,'team_channel');
  assert.equal(first.every(x=>String(x.userId).startsWith('team-')),true);
  const second=await service.deliverMeetingOutputs({guild,meeting,report:{id:'r1',path:reportPath,metadata:{}},recording:null});
  assert.equal(channelSends,1,'dedupe must prevent a second report message');
  assert.equal(second[0].skipped,true);
  await fs.rm(dir,{recursive:true,force:true});
});

test('DeliveryService contains no output DM sender', async()=>{
  const source=await fs.readFile(new URL('../src/application/services/DeliveryService.js',import.meta.url),'utf8');
  assert.equal(source.includes('dm.send'),false);
  assert.equal(source.includes("policy: 'team_channel_only'"),true);
  assert.match(source,/return \[\];/);
});
