import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OutputReliabilityService } from '../src/application/services/OutputReliabilityService.js';
import { DeliveryService } from '../src/application/services/DeliveryService.js';

test('output reliability enforces automatic recording and recovers an ongoing meeting',async()=>{
  const patches=[];let settingsPatch=null;let recoveryCalls=0;
  const outputs={
    async ensure(){return {attempts:0,last_attempt_at:null};},
    async patch(_id,p){patches.push(p);return {...p,attempts:p.attempts??1};}
  };
  const svc=new OutputReliabilityService({
    meetings:{async ongoingForGuild(){return [{id:'m1',team_id:'t1',name:'اجتماع'}];},async outputCandidates(){return []; }},
    guilds:{async getSettings(){return {recording_enabled:false,recording_auto_start:false};},async updateSettings(_g,p){settingsPatch=p;}},
    reports:{},recordings:{},outputs,reportService:{},
    recordingService:{active:new Map(),async requestRecovery(){recoveryCalls++;return {id:'r1'};}},
    deliveryService:{},audit:{async log(){}},logger:{error(){},warn(){}},ownerUserId:'1'
  });
  svc.guild={id:'g1',client:{user:{id:'bot'},users:{fetch:async()=>null}}};svc.client=svc.guild.client;
  await svc.tick();
  assert.deepEqual(settingsPatch,{recording_enabled:true,recording_auto_start:true});
  assert.equal(recoveryCalls,1);
  assert.ok(patches.some(p=>p.recording_status==='recording'));
});

test('team-channel delivery is idempotent across repeated reliability ticks', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'m967-out-'));
  const reportPath=path.join(dir,'report.docx');const audioPath=path.join(dir,'audio.ogg');
  await fs.writeFile(reportPath,'report');await fs.writeFile(audioPath,'audio');

  const sent=[];const auditRows=[];
  const db={query:async(sql,params=[])=>{
    const q=String(sql);
    if(q.includes('member_delivery_control'))return {rows:[{delivery_mode:'team_only',member_delivery_enabled:false}]};
    if(q.includes('SELECT notification_channel_id FROM teams'))return {rows:[{notification_channel_id:'team-text-1'}]};
    if(q.includes('meeting.attendance_report.team_channel.sent'))return {rows:[]};
    if(q.includes('meeting.recording.discord.team_channel.sent')){
      const meetingId=String(params?.[1]??'');const channelId=String(params?.[2]??'');
      return {rows:auditRows.filter(x=>x.action==='meeting.recording.discord.team_channel.sent'&&x.meetingId===meetingId&&x.channelId===channelId).length?[{'?column?':1}]:[]};
    }
    if(q.includes('meeting.recording.discord.team_channel.batch.sent'))return {rows:[]};
    throw new Error('unexpected query: '+q);
  }};
  const channel={isTextBased:()=>true,send:async(payload)=>{sent.push(payload);return {id:'msg-'+sent.length}}};
  const guild={id:'g1',members:{fetch:async()=>new Map(),cache:new Map()},channels:{fetch:async id=>id==='team-text-1'?channel:null},client:{users:{fetch:async()=>null}}};
  const audit={log:async(entry)=>{
    auditRows.push({action:entry.action,meetingId:String(entry.targetId??''),channelId:String(entry.metadata?.channelId??'')});
  }};
  const service=new DeliveryService({permissionService:{},recordings:{},outputs:null,meetings:{db},tasks:null,audit,ownerUserId:'1',logger:{warn(){}}});
  const meeting={id:'m1',team_id:'t1',team_name:'الإدارة',name:'اختبار'};
  const report={path:reportPath};
  const recording={id:'r1',status:'completed',metadata:{integrityGuardVersion:'1.10.11',integrityStatus:'verified'},final_paths:[audioPath]};

  const first=await service.deliverMeetingOutputs({guild,meeting,report,recording});
  assert.equal(sent.length,2,'one report message + one recording message');
  assert.equal(first.some(x=>x.destination==='team_discord_recording'),true);

  const second=await service.deliverMeetingOutputs({guild,meeting,report,recording});
  assert.equal(sent.length,2,'repeat delivery must not publish duplicates');
  assert.equal(second.some(x=>x.skipped===true),true);

  await fs.rm(dir,{recursive:true,force:true});
});
