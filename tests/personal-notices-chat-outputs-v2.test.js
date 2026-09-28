import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeliveryService } from '../src/application/services/DeliveryService.js';

const auto=fs.readFileSync('src/application/services/AutopilotService.js','utf8');
const meetings=fs.readFileSync('src/interfaces/discord/interactions/meetings.js','utf8');
const delivery=fs.readFileSync('src/application/services/DeliveryService.js','utf8');

test('scheduled meeting and reminders are private DMs',()=>{
  assert.match(auto,/notifyMeetingScheduled/);
  assert.match(auto,/meeting-scheduled/);
  assert.match(auto,/await user\.send\(text\)/);
  assert.doesNotMatch(meetings,/📅 \*\*اجتماع جديد —/);
  assert.doesNotMatch(meetings,/await ch\.send\(\{content:`▶️ بدأ اجتماع/);
  assert.doesNotMatch(meetings,/await ch\.send\(\{content:`⏹️ انتهى اجتماع/);
});

test('delivery resolver is strict team chat only',()=>{
  assert.match(delivery,/team-chat-meeting-outputs-v2/);
  assert.match(delivery,/isChatName/);
  assert.match(delivery,/name\.includes\('شات'\)/);
  assert.match(delivery,/channel\.type===0/);
  assert.match(delivery,/اعلان\|إعلان/);
});

test('announcement is skipped and sibling chat receives report',async()=>{
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'m967-chat-out-'));
  try{
    const reportPath=path.join(dir,'report.docx');
    await fsp.writeFile(reportPath,Buffer.from('x'));

    const sent=[];
    const category='cat-team';
    const ann={id:'ann',name:'اعلانات-الفريق-التنفيذي',type:5,parentId:category,isTextBased:()=>true,send:async()=>{throw new Error('NO')}};
    const chat={id:'chat',name:'شات-الفريق-التنفيذي',type:0,parentId:category,isTextBased:()=>true,send:async p=>{sent.push(p);return{id:'msg'}}};
    const voice={id:'voice',name:'اجتماعات الفريق التنفيذي',type:2,parentId:category,isTextBased:()=>false};
    const cache=new Map([[ann.id,ann],[chat.id,chat],[voice.id,voice]]);
    const guild={
      id:'g1',
      channels:{cache,fetch:async id=>id?cache.get(String(id))??null:cache},
      members:{fetch:async()=>new Map(),cache:new Map()},
      client:{users:{fetch:async()=>null}},
    };
    const db={query:async sql=>{
      const q=String(sql);
      if(q.includes('member_delivery_control'))return {rows:[{delivery_mode:'full',member_delivery_enabled:true}]};
      if(q.includes('SELECT notification_channel_id FROM teams'))return {rows:[{notification_channel_id:'ann'}]};
      if(q.includes('meeting.attendance_report.team_channel.sent'))return {rows:[]};
      throw new Error('unexpected: '+q);
    }};
    const service=new DeliveryService({
      permissionService:{},recordings:{},outputs:null,meetings:{db},tasks:null,
      audit:{log:async()=>{}},ownerUserId:'owner',logger:{warn:()=>{}},
    });
    const meeting={id:'m1',team_id:'t1',team_name:'الفريق التنفيذي',name:'اجتماع',voice_channel_id:'voice'};
    const result=await service.deliverMeetingOutputs({
      guild,meeting,report:{id:'r',path:reportPath,metadata:{}},recording:null
    });
    assert.equal(sent.length,1);
    assert.equal(result[0]?.error,null);
    assert.match(sent[0].content,/التقرير الرسمي/);
  }finally{
    await fsp.rm(dir,{recursive:true,force:true});
  }
});
