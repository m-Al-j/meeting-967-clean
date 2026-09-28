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
  return new DeliveryService({permissionService:{},recordings:{},outputs:null,meetings:{db:fixtureDb()},tasks:null,audit:{log:async(x)=>audits.push(x)},ownerUserId:'owner-1',logger:{warn:()=>{}}});
}
function guildWith(sends){
  const channel={isTextBased:()=>true,send:async(payload)=>{sends.push(payload);return {id:'msg-'+sends.length}}};
  return {id:'guild-1',members:{fetch:async()=>new Map(),cache:new Map()},channels:{fetch:async(id)=>id==='team-text-1'?channel:null},client:{users:{fetch:async()=>null}}};
}
const meeting={id:'meeting-single-1',team_id:'team-1',team_name:'فريق الإدارة والحوكمة',name:'اجتماع الإدارة والحوكمة'};

test('large recording never falls back to segmented Discord when Catbox fails',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'meeting967-single-fail-'));
  const audio=path.join(dir,'large.ogg');const h=await fs.open(audio,'w');await h.truncate(8*1024*1024);await h.close();
  const sends=[];let fetchCalls=0;
  const oldFetch=globalThis.fetch;const oldAttempts=process.env.CATBOX_SINGLE_UPLOAD_ATTEMPTS;const oldDelay=process.env.CATBOX_SINGLE_RETRY_DELAY_MS;
  process.env.CATBOX_SINGLE_UPLOAD_ATTEMPTS='3';process.env.CATBOX_SINGLE_RETRY_DELAY_MS='1';
  globalThis.fetch=async()=>{fetchCalls++;return new Response('temporary failure',{status:503})};
  try{
    const result=await service().deliverMeetingOutputs({guild:guildWith(sends),meeting,recording:{id:'rec-large',status:'completed',final_paths:[audio],metadata:{integrityGuardVersion:'1.10.11',integrityStatus:'verified'}}});
    assert.equal(fetchCalls,3);
    assert.equal(sends.length,0,'must not send segmented attachments');
    const failed=result.find(x=>x.destination==='team_recording_hybrid');
    assert.ok(failed?.error);
    assert.match(failed.error,/لن يتم تقسيمه|ملف واحد/);
  }finally{
    globalThis.fetch=oldFetch;
    if(oldAttempts===undefined)delete process.env.CATBOX_SINGLE_UPLOAD_ATTEMPTS;else process.env.CATBOX_SINGLE_UPLOAD_ATTEMPTS=oldAttempts;
    if(oldDelay===undefined)delete process.env.CATBOX_SINGLE_RETRY_DELAY_MS;else process.env.CATBOX_SINGLE_RETRY_DELAY_MS=oldDelay;
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('multiple source files are blocked instead of being published as parts',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'meeting967-single-multi-'));
  const a=path.join(dir,'a.ogg');const b=path.join(dir,'b.ogg');await fs.writeFile(a,Buffer.alloc(1024));await fs.writeFile(b,Buffer.alloc(1024));
  const sends=[];
  try{
    const result=await service().deliverMeetingOutputs({guild:guildWith(sends),meeting,recording:{id:'rec-multi',status:'completed',final_paths:[a,b],metadata:{integrityGuardVersion:'1.10.11',integrityStatus:'verified'}}});
    assert.equal(sends.length,0);
    const failed=result.find(x=>x.destination==='team_recording_hybrid');
    assert.match(failed?.error??'',/ليس ملفًا واحدًا/);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('source has single-recording marker and no segmented fallback',async()=>{
  const source=await fs.readFile(new URL('../src/application/services/DeliveryService.js',import.meta.url),'utf8');
  assert.match(source,/Operations 967 v1\.10\.9 — single recording delivery only/);
  assert.equal(source.includes('falling back to segmented Discord attachments'),false);
  assert.match(source,/OutputReliability/);
  assert.match(source,/audioFiles\.length!==1/);
});
