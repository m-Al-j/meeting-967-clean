import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeliveryService } from '../src/application/services/DeliveryService.js';

function fixtureDb(){
  return {query:async(sql)=>{
    const q=String(sql);
    if(q.includes('member_delivery_control'))return {rows:[{delivery_mode:'full',member_delivery_enabled:true}]};
    if(q.includes('SELECT notification_channel_id FROM teams'))return {rows:[{notification_channel_id:'team-text-1'}]};
    if(q.includes('meeting.attendance_report.team_channel.sent'))return {rows:[]};
    if(q.includes('meeting.recording.discord.team_channel.sent'))return {rows:[]};
    if(q.includes('meeting.recording.discord.team_channel.batch.sent'))return {rows:[]};
    throw new Error('unexpected query: '+q);
  }};
}

test('v1.10.3 attaches a small recording directly to the team channel and never uses DM/Drive',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'meeting967-direct-rec-'));
  const audio=path.join(dir,'meeting.ogg');await fs.writeFile(audio,Buffer.alloc(1024,'a'));
  const report=path.join(dir,'report.docx');await fs.writeFile(report,Buffer.from('docx-test'));
  const sends=[];const audits=[];let memberFetches=0;
  const channel={isTextBased:()=>true,send:async(payload)=>{sends.push(payload);return {id:'msg-'+sends.length}}};
  const guild={id:'guild-1',members:{fetch:async()=>{memberFetches++;throw new Error('no member scan');},cache:new Map()},channels:{fetch:async(id)=>id==='team-text-1'?channel:null},client:{users:{fetch:async()=>{throw new Error('no user DM')}}}};
  const meeting={id:'meeting-1',team_id:'team-1',team_name:'فريق التقنية',name:'اجتماع المتابعة'};
  const service=new DeliveryService({permissionService:{},recordings:{},outputs:null,meetings:{db:fixtureDb()},tasks:null,audit:{log:async(x)=>{audits.push(x)}},ownerUserId:'owner-1',logger:{warn:()=>{}}});
  const result=await service.deliverMeetingOutputs({guild,meeting,report:{id:'r1',path:report,metadata:{}},recording:{id:'rec-1',status:'completed',metadata:{integrityGuardVersion:'1.10.11',integrityStatus:'verified'},final_paths:[audio]}});
  assert.equal(memberFetches,0);
  assert.equal(sends.length,2,'one report message + one recording message');
  assert.equal(sends[1].files.length,1);
  assert.equal(sends[1].files[0].attachment,audio);
  assert.match(sends[1].content,/مرفق مباشرة/);
  assert.equal(result.some(x=>x.destination==='team_discord_recording'&&x.recordingFiles===1),true);
  assert.equal(audits.some(x=>x.action==='meeting.recording.discord.team_channel.sent'),true);
  await fs.rm(dir,{recursive:true,force:true});
});

test('source contains no output DM sender and no active Google Drive delivery',async()=>{
  const source=await fs.readFile(new URL('../src/application/services/DeliveryService.js',import.meta.url),'utf8');
  assert.equal(source.includes('dm.send'),false);
  assert.equal(source.includes('#driveClient()'),false);
  assert.equal(source.includes('#deliverTeamDriveRecording'),false);
  assert.match(source,/discord-attachments-to-team-channel/);
  assert.match(source,/DISCORD_RECORDING_SEGMENT_SECONDS/);
  assert.match(source,/policy: 'team_channel_only'/);
});
