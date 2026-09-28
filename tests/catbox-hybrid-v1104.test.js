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
    if(q.includes('audit_logs'))return {rows:[]};
    throw new Error('unexpected query: '+q);
  }};
}
function service(audits=[]){
  return new DeliveryService({permissionService:{},recordings:{},outputs:null,meetings:{db:fixtureDb()},tasks:null,audit:{log:async(x)=>{audits.push(x)}},ownerUserId:'owner-1',logger:{warn:()=>{}}});
}
function guildWith(sends){
  const channel={isTextBased:()=>true,send:async(payload)=>{sends.push(payload);return {id:'msg-'+sends.length}}};
  return {id:'guild-1',members:{fetch:async()=>new Map(),cache:new Map()},channels:{fetch:async(id)=>id==='team-text-1'?channel:null},client:{users:{fetch:async()=>null}}};
}
const meeting={id:'meeting-1',team_id:'team-1',team_name:'فريق التقنية',name:'اجتماع المتابعة'};

test('small recording stays as a direct Discord attachment and does not call Catbox',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'meeting967-catbox-small-'));
  const audio=path.join(dir,'small.ogg');await fs.writeFile(audio,Buffer.alloc(2048,'a'));
  const sends=[];const audits=[];let fetchCalls=0;
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{fetchCalls++;throw new Error('Catbox should not be called')};
  try{
    const result=await service(audits).deliverMeetingOutputs({guild:guildWith(sends),meeting,recording:{id:'rec-small',status:'completed',metadata:{integrityGuardVersion:'1.10.11',integrityStatus:'verified'},final_paths:[audio]}});
    assert.equal(fetchCalls,0);
    assert.equal(sends.length,1);
    assert.equal(sends[0].files.length,1);
    assert.equal(result.some(x=>x.destination==='team_discord_recording'),true);
  }finally{globalThis.fetch=oldFetch;await fs.rm(dir,{recursive:true,force:true})}
});

test('recording larger than 7MB is uploaded anonymously to Catbox and one direct link is posted',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'meeting967-catbox-large-'));
  const audio=path.join(dir,'large.ogg');const handle=await fs.open(audio,'w');await handle.truncate(8*1024*1024);await handle.close();
  const sends=[];const audits=[];let fetchCalls=0;
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    fetchCalls++;
    assert.equal(String(url),'https://catbox.moe/user/api.php');
    assert.equal(options.method,'POST');
    assert.equal(options.body.get('reqtype'),'fileupload');
    assert.equal(options.body.has('userhash'),false);
    assert.equal(options.body.has('fileToUpload'),true);
    return new Response('https://files.catbox.moe/abc123.ogg',{status:200});
  };
  try{
    const result=await service(audits).deliverMeetingOutputs({guild:guildWith(sends),meeting,recording:{id:'rec-large',status:'completed',metadata:{integrityGuardVersion:'1.10.11',integrityStatus:'verified'},final_paths:[audio]}});
    assert.equal(fetchCalls,1);
    assert.equal(sends.length,1);
    assert.equal('files' in sends[0],false);
    assert.match(sends[0].content,/https:\/\/files\.catbox\.moe\/abc123\.ogg/);
    assert.equal(result.some(x=>x.destination==='team_catbox_recording'),true);
    assert.equal(audits.some(x=>x.action==='meeting.recording.catbox.uploaded'),true);
    assert.equal(audits.some(x=>x.action==='meeting.recording.catbox.team_channel.sent'),true);
  }finally{globalThis.fetch=oldFetch;await fs.rm(dir,{recursive:true,force:true})}
});

test('source keeps team-channel-only policy and has no Google Drive or output DM path',async()=>{
  const source=await fs.readFile(new URL('../src/application/services/DeliveryService.js',import.meta.url),'utf8');
  assert.equal(source.includes('dm.send'),false);
  assert.equal(source.includes('#driveClient()'),false);
  assert.match(source,/CATBOX_API_URL/);
  assert.match(source,/deliverTeamRecordingHybrid/);
  assert.match(source,/policy: 'team_channel_only'/);
});
