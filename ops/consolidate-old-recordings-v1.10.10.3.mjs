import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import pg from 'pg';
import { Client, GatewayIntentBits } from 'discord.js';

const token=String(process.env.DISCORD_TOKEN??'').trim();
const dbUrl=String(process.env.DATABASE_URL??'').trim();
const ROOT=path.resolve(process.env.RECORDING_CLEANUP_ROOT??'storage/recording-message-consolidation-v1.10.10');
const OLD_DOWNLOAD_ROOT=ROOT;
const DISCORD_MAX=7*1024*1024;
const CATBOX_SAFE_MAX=190*1024*1024;
const CATBOX_API='https://catbox.moe/user/api.php';
const VERSION='1.10.10.3';
const ACTION='meeting.recording.consolidated.v1.10.10.3';
const SAMPLE_RATE=48000;
const BITRATE='24k';
const MAX_INPUTS=10;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(...x)=>console.log(...x);

function cleanId(v){return String(v??'unknown').replace(/[^A-Za-z0-9_-]/g,'_')}
function safeName(v){return String(v??'اجتماع').replace(/[<>:"/\\|?*\u0000-\u001F]/g,' ').replace(/\s+/g,' ').trim().slice(0,100)||'اجتماع'}
function ms(v){const n=new Date(v).getTime();return Number.isFinite(n)?n:NaN}
function fmt(sec){sec=Math.max(0,Math.round(Number(sec)||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h?`${h}س ${m}د ${s}ث`:`${m}د ${s}ث`}
async function exists(p){try{const s=await fs.stat(p);return s.isFile()&&s.size>100}catch{return false}}
async function readJson(p){try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return {}}}
async function writeJson(p,v){await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(v,null,2)+'\n')}

function run(cmd,args,{timeoutMs=20*60_000,label=cmd}={}){
  return new Promise((resolve,reject)=>{
    const c=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});let out='',err='',done=false;
    c.stdout?.on('data',d=>out=(out+String(d)).slice(-30000));
    c.stderr?.on('data',d=>err=(err+String(d)).slice(-50000));
    const finish=(fn,v)=>{if(done)return;done=true;clearTimeout(t);fn(v)};
    const t=setTimeout(()=>{try{c.kill('SIGKILL')}catch{};finish(reject,new Error(label+' تجاوز مهلة التنفيذ.\n'+err.slice(-4000)))},timeoutMs);
    c.once('error',e=>finish(reject,e));
    c.once('close',code=>code===0?finish(resolve,{out,err}):finish(reject,new Error(label+' فشل (code='+code+').\n'+err.slice(-6000))));
  });
}
async function probeDuration(file){
  try{const {out}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{timeoutMs:30_000,label:'ffprobe'});const n=Number(String(out).trim());return Number.isFinite(n)&&n>0?n:0}catch{return 0}
}
async function validAudio(file){return (await exists(file)) && (await probeDuration(file))>0.01}
function chooseCanonical(cluster){
  return [...cluster].sort((a,b)=>{
    const ac=a.status==='completed'?1:0,bc=b.status==='completed'?1:0;if(ac!==bc)return bc-ac;
    const td=Number(b.tracks??0)-Number(a.tracks??0);if(td!==0)return td;
    return ms(b.stopped_at)-ms(a.stopped_at);
  })[0];
}
function parseBatchKey(v){const m=String(v??'').match(/^batch-(\d+)-of-(\d+)$/i);return m?{n:Number(m[1]),total:Number(m[2])}:null}

async function chooseBatchMessages({db,channel,candidate,expected,client}){
  const expectedBatches=Math.ceil(expected/5);
  const {rows}=await db.query(`
    SELECT id,metadata,created_at FROM audit_logs
    WHERE guild_id=$1 AND action='meeting.recording.discord.team_channel.batch.sent'
      AND target_type='meeting' AND target_id=$2 AND COALESCE(metadata->>'channelId','')=$3
    ORDER BY created_at DESC,id DESC`,[candidate.guild_id,candidate.meeting_id,candidate.channel_id]);
  const groups=new Map(),allKnown=new Set();
  for(const row of rows){const k=parseBatchKey(row.metadata?.batchKey),mid=String(row.metadata?.messageId??'');if(mid)allKnown.add(mid);if(!k||k.total!==expectedBatches||!mid)continue;if(!groups.has(k.n))groups.set(k.n,[]);groups.get(k.n).push(row)}
  const finals=await db.query(`SELECT metadata FROM audit_logs WHERE guild_id=$1 AND action='meeting.recording.discord.team_channel.sent' AND target_type='meeting' AND target_id=$2 AND COALESCE(metadata->>'channelId','')=$3`,[candidate.guild_id,candidate.meeting_id,candidate.channel_id]);
  for(const row of finals.rows){const id=String(row.metadata?.messageId??'');if(id)allKnown.add(id)}
  const chosen=[];const sentAt=ms(candidate.sent_at);
  for(let n=1;n<=expectedBatches;n++){
    const need=Math.min(5,expected-(n-1)*5);
    const ordered=[...(groups.get(n)??[])].sort((a,b)=>{const at=ms(a.created_at),bt=ms(b.created_at);const ap=at<=sentAt?0:1,bp=bt<=sentAt?0:1;return ap-bp||bt-at||Number(b.id)-Number(a.id)});
    let selected=null;
    for(const row of ordered){const id=String(row.metadata?.messageId??'');const m=await channel.messages.fetch(id).catch(()=>null);if(!m||m.author?.id!==client.user.id)continue;const at=[...m.attachments.values()];if(at.length!==need)continue;selected={n,message:m,attachments:at};break}
    if(!selected)throw new Error(`لم أجد Batch صالح ${n}/${expectedBatches}. لن ألمس الرسائل.`);
    chosen.push(selected);
  }
  const attachments=chosen.flatMap(x=>x.attachments.map(a=>({url:a.url,size:Number(a.size??0),name:String(a.name??'')})));
  if(attachments.length!==expected)throw new Error(`عدد مرفقات الـAudit ${attachments.length} لا يساوي المتوقع ${expected}.`);
  return {chosen,attachments,allKnownMessageIds:[...allKnown]};
}

async function uploadCatbox(file,stateFile,state){
  if(state.catboxUrl&&/^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(state.catboxUrl))return state.catboxUrl;
  let upload=file,st=await fs.stat(file);
  if(st.size>CATBOX_SAFE_MAX){const compact=path.join(path.dirname(file),'recording-complete-catbox.ogg');await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,'-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','24000','-c:a','libopus','-b:a','14k','-vbr','on','-application','voip',compact],{timeoutMs:60*60_000,label:'ضغط Catbox'});upload=compact;st=await fs.stat(upload);if(st.size>CATBOX_SAFE_MAX)throw new Error('التسجيل أكبر من حد Catbox الآمن حتى بعد الضغط.')}
  let last;
  for(let attempt=1;attempt<=3;attempt++){
    try{const form=new FormData();form.append('reqtype','fileupload');const uh=String(process.env.CATBOX_USERHASH??'').trim();if(uh)form.append('userhash',uh);form.append('fileToUpload',await openAsBlob(upload,{type:'audio/ogg'}),path.basename(upload));const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30*60_000);let res;try{res=await fetch(CATBOX_API,{method:'POST',body:form,signal:controller.signal,headers:{'User-Agent':'Operations967-Recovery/'+VERSION}})}finally{clearTimeout(timer)}const body=String(await res.text()).trim();if(!res.ok)throw new Error('Catbox HTTP '+res.status);if(!/^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(body))throw new Error('رابط Catbox غير صالح.');state.catboxUrl=body;await writeJson(stateFile,state);return body}catch(e){last=e;if(attempt<3)await sleep(3000*attempt)}
  }
  throw last??new Error('فشل Catbox');
}

async function pickValidSingleFinal(db,meetingId,officialSec){
  const {rows}=await db.query(`SELECT id::text,final_paths,final_bytes FROM recordings WHERE meeting_id=$1 AND status='completed' ORDER BY stopped_at DESC NULLS LAST,started_at DESC`,[meetingId]);
  const options=[];
  for(const r of rows){const pp=Array.isArray(r.final_paths)?r.final_paths:[];if(pp.length!==1)continue;const p=String(pp[0]);if(!(await validAudio(p)))continue;const d=await probeDuration(p);if(officialSec>30&&Math.abs(d-officialSec)/officialSec>0.05)continue;const st=await fs.stat(p);options.push({path:p,duration:d,bytes:st.size,recordingId:r.id})}
  return options[0]??null;
}

async function getRecordingSummary(db,meetingId){
  const {rows}=await db.query(`
    SELECT r.id::text,r.status,r.started_at,r.stopped_at,r.storage_path,
           COUNT(t.id)::int AS tracks,MIN(t.started_at) AS first_track,MAX(t.ended_at) AS last_track
    FROM recordings r LEFT JOIN recording_tracks t ON t.recording_id=r.id
    WHERE r.meeting_id=$1
    GROUP BY r.id,r.status,r.started_at,r.stopped_at,r.storage_path ORDER BY r.started_at`,[meetingId]);
  return rows;
}

async function prepareTracks({db,candidate,expected,batchSelection,dir}){
  const summary=await getRecordingSummary(db,candidate.meeting_id);
  const withTracks=summary.filter(r=>Number(r.tracks)>0&&r.first_track);
  if(!withTracks.length)throw new Error('لا توجد recording_tracks في قاعدة البيانات لهذا الاجتماع.');

  const clusters=[];
  for(const row of withTracks){const st=ms(row.started_at);let cl=clusters.find(x=>Math.abs(ms(x[0].started_at)-st)<=3000);if(!cl){cl=[];clusters.push(cl)}cl.push(row)}
  const canonical=clusters.map(chooseCanonical).sort((a,b)=>ms(a.started_at)-ms(b.started_at));
  const ids=canonical.map(r=>r.id);
  log('🧱 Recording rows الحقيقية:',canonical.length);
  canonical.forEach((r,i)=>log(`   ${i+1}. ${r.id} [${r.status}] tracks=${r.tracks}`));

  const {rows:allTracks}=await db.query(`SELECT * FROM recording_tracks WHERE recording_id=ANY($1::uuid[]) ORDER BY started_at,id`,[ids]);
  if(!allTracks.length)throw new Error('سجلات recording_tracks المختارة فارغة.');

  // Discord fallback is safe only if exactly one recording row has exactly the same count that was delivered.
  const exactRows=withTracks.filter(r=>Number(r.tracks)===expected);
  let fallbackMap=null;
  if(exactRows.length===1 && batchSelection?.attachments?.length===expected){
    const rid=exactRows[0].id;
    const {rows}=await db.query(`SELECT * FROM recording_tracks WHERE recording_id=$1 ORDER BY started_at,id`,[rid]);
    if(rows.length===expected){
      const oldParts=path.join(OLD_DOWNLOAD_ROOT,cleanId(candidate.meeting_id),'original-parts-v110102');
      fallbackMap=new Map();
      for(let i=0;i<rows.length;i++){
        const p=path.join(oldParts,'part-'+String(i+1).padStart(4,'0')+'.ogg');
        if(await validAudio(p))fallbackMap.set(String(rows[i].id),p);
      }
      if(fallbackMap.size)log('🛟 Discord fallback قابل للربط لسجل واحد:',fallbackMap.size,'ملفًا متاحًا محليًا من تنزيل v1.10.10.2.');
    }
  }

  const valid=[];let missing=0,bad=0,fallbackUsed=0;
  for(let i=0;i<allTracks.length;i++){
    const t=allTracks[i];const startedMs=ms(t.started_at);if(!Number.isFinite(startedMs)){bad++;continue}
    let p=String(t.path??'');
    if(!(await validAudio(p))){const fb=fallbackMap?.get(String(t.id));if(fb&&await validAudio(fb)){p=fb;fallbackUsed++}else{missing++;continue}}
    const dur=await probeDuration(p);if(!(dur>0.01)){bad++;continue}
    const audioEnd=startedMs+Math.round(dur*1000);const dbEnd=ms(t.ended_at);let endedMs=audioEnd;
    if(Number.isFinite(dbEnd)&&dbEnd>startedMs){const dbDur=dbEnd-startedMs;if(dbDur<=Math.max(dur*1500+3000,10_000))endedMs=Math.max(endedMs,dbEnd)}
    valid.push({...t,path:p,startedMs,endedMs,durationSec:dur});
    if((i+1)%75===0)log(`   🔬 فحص المقاطع ${i+1}/${allTracks.length}...`);
  }
  if(!valid.length)throw new Error('كل المقاطع الخام مفقودة/غير صالحة؛ لن ألمس Discord.');

  const seen=new Set(),dedup=[];
  for(const t of valid){const key=[String(t.user_id??''),Math.round(t.startedMs/50),Number(t.packet_count??0),Number(t.bytes??0)].join('|');if(seen.has(key))continue;seen.add(key);dedup.push(t)}
  dedup.sort((a,b)=>a.startedMs-b.startedMs||String(a.id).localeCompare(String(b.id)));
  log(`🎙️ المقاطع الصالحة: ${dedup.length} | مفقودة: ${missing} | غير صالحة: ${bad} | fallback Discord: ${fallbackUsed}`);
  return {tracks:dedup,canonical,summary};
}

async function mixTimeline({candidate,tracks,dir,officialSec}){
  const work=path.join(dir,'.timeline-mix-v110103');await fs.rm(work,{recursive:true,force:true}).catch(()=>{});await fs.mkdir(work,{recursive:true});
  const meetingStart=ms(candidate.started_at);const meetingEnd=ms(candidate.ended_at);
  const minTrack=Math.min(...tracks.map(t=>t.startedMs));const maxTrack=Math.max(...tracks.map(t=>t.endedMs));
  const useOfficial=Number.isFinite(meetingStart)&&Number.isFinite(meetingEnd)&&meetingEnd>meetingStart&&officialSec>30&&officialSec<6*3600;
  const timelineStart=useOfficial?meetingStart:minTrack;const timelineEnd=useOfficial?meetingEnd:maxTrack;const targetSec=(timelineEnd-timelineStart)/1000;
  if(!(targetSec>10&&targetSec<6*3600))throw new Error('مدة الاسترجاع غير منطقية: '+fmt(targetSec));

  const relevant=tracks.filter(t=>t.startedMs<timelineEnd+5000&&t.endedMs>timelineStart-5000);
  if(!relevant.length)throw new Error('لا توجد مقاطع تقع داخل زمن الاجتماع.');
  log('🕒 المدة المستهدفة:',fmt(targetSec),'| المقاطع داخل الزمن:',relevant.length);

  let nodes=relevant.map(t=>({path:t.path,startMs:t.startedMs,endMs:t.endedMs,leaf:true}));
  let round=0;
  while(nodes.length>1){
    round++;const next=[];log(`🎚️ جولة المزج ${round}: ${nodes.length} → ${Math.ceil(nodes.length/MAX_INPUTS)}`);
    for(let i=0;i<nodes.length;i+=MAX_INPUTS){
      const group=nodes.slice(i,i+MAX_INPUTS);if(group.length===1){next.push(group[0]);continue}
      const base=Math.min(...group.map(n=>n.startMs));const end=Math.max(...group.map(n=>n.endMs));const durSec=Math.max(0.05,(end-base)/1000);
      const out=path.join(work,`round-${String(round).padStart(2,'0')}-${String(next.length+1).padStart(4,'0')}.ogg`);
      const args=['-hide_banner','-loglevel','error','-y'];const filters=[],labels=[];
      group.forEach((n,idx)=>{args.push('-i',n.path);const delay=Math.max(0,Math.round(n.startMs-base));filters.push(`[${idx}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=mono,asetpts=N/SR/TB,adelay=${delay}:all=1[a${idx}]`);labels.push(`[a${idx}]`)});
      filters.push(`${labels.join('')}amix=inputs=${group.length}:duration=longest:dropout_transition=0,apad,atrim=duration=${durSec.toFixed(3)}[m]`);
      args.push('-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[m]','-t',durSec.toFixed(3),'-ac','1','-ar',String(SAMPLE_RATE),'-c:a','libopus','-b:a',BITRATE,out);
      await run('ffmpeg',args,{timeoutMs:Math.max(5*60_000,Math.ceil(durSec*2000)),label:`مزج الجولة ${round}`});
      const got=await probeDuration(out);if(!(got>0)&&group.length)throw new Error('خرج وسيط غير صالح في جولة المزج.');
      next.push({path:out,startMs:base,endMs:end,leaf:false});
    }
    // delete intermediate nodes from older rounds; raw leaves are never deleted.
    for(const n of nodes){if(!n.leaf&&!next.some(x=>x.path===n.path))await fs.rm(n.path,{force:true}).catch(()=>{})}
    nodes=next.sort((a,b)=>a.startMs-b.startMs);
  }

  const mixed=nodes[0];const trimStart=Math.max(0,(timelineStart-mixed.startMs)/1000);const delayMs=Math.max(0,Math.round(mixed.startMs-timelineStart));
  const finalPath=path.join(dir,safeName(candidate.meeting_name)+' - التسجيل الكامل.ogg');const tmp=finalPath+'.tmp.ogg';
  const filter=`atrim=start=${trimStart.toFixed(3)},asetpts=N/SR/TB,adelay=${delayMs}:all=1,apad,atrim=duration=${targetSec.toFixed(3)}`;
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',mixed.path,'-af',filter,'-t',targetSec.toFixed(3),'-ac','1','-ar',String(SAMPLE_RATE),'-c:a','libopus','-b:a',BITRATE,tmp],{timeoutMs:Math.max(10*60_000,Math.ceil(targetSec*2000)),label:'بناء الملف النهائي'});
  const actual=await probeDuration(tmp);if(!(actual>0))throw new Error('الملف النهائي غير قابل للقراءة.');const ratio=actual/targetSec;if(ratio<0.985||ratio>1.015)throw new Error(`رفض اعتماد الملف: ${fmt(actual)} مقابل المستهدف ${fmt(targetSec)}.`);
  const st=await fs.stat(tmp);if(st.size<1000)throw new Error('الملف النهائي صغير جدًا.');
  if(await exists(finalPath))await fs.rename(finalPath,finalPath+'.before-'+Date.now()+'.bak');await fs.rename(tmp,finalPath);
  await fs.rm(work,{recursive:true,force:true}).catch(()=>{});
  return {path:finalPath,duration:actual,bytes:st.size,targetSec};
}

async function persistRecoveredFinal(db,{candidate,recovered,summary}){
  const target=[...summary].filter(r=>r.status==='completed').sort((a,b)=>ms(b.stopped_at)-ms(a.stopped_at))[0]??summary[summary.length-1];
  if(!target?.id)return;
  await db.query(`UPDATE recordings SET final_paths=$2::jsonb,final_bytes=$3,metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('recovered_by',$4::text,'recovered_at',now(),'recovery_mode','timeline_tree_v110103','recovery_actual_seconds',$5::numeric) WHERE id=$1`,[target.id,JSON.stringify([recovered.path]),recovered.bytes,'meeting967-v1.10.10.3',recovered.duration]);
}

async function markAudit(db,{guildId,meetingId,actorId,meta}){
  const q=await db.query("SELECT 1 FROM audit_logs WHERE guild_id=$1 AND action=$2 AND target_type='meeting' AND target_id=$3 LIMIT 1",[guildId,ACTION,meetingId]);if(q.rows.length)return;
  await db.query("INSERT INTO audit_logs(guild_id,actor_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,'meeting',$4,$5::jsonb)",[guildId,actorId,ACTION,meetingId,JSON.stringify(meta)]);
}

const db=new pg.Client({connectionString:dbUrl});
const client=new Client({intents:[GatewayIntentBits.Guilds]});
let readyResolve;const ready=new Promise(r=>readyResolve=r);client.once('clientReady',()=>readyResolve());

async function main(){
  await fs.mkdir(ROOT,{recursive:true});await db.connect();
  const {rows:candidates}=await db.query(`
    SELECT DISTINCT ON (a.guild_id,a.target_id)
      a.guild_id::text AS guild_id,a.target_id AS meeting_id,a.metadata,a.created_at AS sent_at,
      COALESCE(a.metadata->>'channelId','') AS channel_id,
      m.started_at,m.ended_at,COALESCE(m.name,'اجتماع') AS meeting_name,COALESCE(t.name,'الفريق') AS team_name
    FROM audit_logs a
    LEFT JOIN meetings m ON m.guild_id=a.guild_id AND m.id::text=a.target_id
    LEFT JOIN teams t ON t.id=m.team_id
    WHERE a.action='meeting.recording.discord.team_channel.sent' AND a.target_type='meeting'
      AND COALESCE(a.metadata->>'parts','')~'^[0-9]+$' AND (a.metadata->>'parts')::int>1
      AND NOT EXISTS(SELECT 1 FROM audit_logs z WHERE z.guild_id=a.guild_id AND z.target_type='meeting' AND z.target_id=a.target_id AND z.action=$1)
    ORDER BY a.guild_id,a.target_id,a.created_at DESC,a.id DESC`,[ACTION]);
  log('🔎 التسجيلات القديمة المجزأة المرشحة:',candidates.length);if(!candidates.length)return {ok:0,failed:0,skipped:0};
  await client.login(token);await ready;log('🤖 Discord online كـ',client.user?.tag??client.user?.id);
  let ok=0,failed=0,skipped=0;
  for(const c of candidates){
    const expected=Number(c.metadata?.parts??0),channelId=String(c.channel_id??'');const officialSec=c.started_at&&c.ended_at?Math.max(0,(ms(c.ended_at)-ms(c.started_at))/1000):0;
    const dir=path.join(ROOT,cleanId(c.meeting_id));const stateFile=path.join(dir,'state-v1.10.10.3.json');await fs.mkdir(dir,{recursive:true});let state={...(await readJson(stateFile)),meetingId:c.meeting_id,guildId:c.guild_id,channelId,expectedParts:expected};
    try{
      log('\n────────────────────────────────────────────────────────');log('🎙️',c.team_name,'—',c.meeting_name,'| legacy files:',expected,'| مدة الاجتماع:',fmt(officialSec));
      if(!channelId)throw new Error('لا يوجد channelId في Audit Log.');
      const guild=await client.guilds.fetch(c.guild_id),channel=await guild.channels.fetch(channelId);if(!channel?.isTextBased?.()||!channel.messages?.fetch)throw new Error('قناة التسجيل غير متاحة.');

      if(state.keeperUpdated&&Array.isArray(state.cleanupMessageIds)&&state.keeperMessageId){
        let deleted=0;for(const id of state.cleanupMessageIds){if(String(id)===String(state.keeperMessageId))continue;const m=await channel.messages.fetch(String(id)).catch(()=>null);if(!m)continue;if(m.author?.id!==client.user.id)throw new Error('رفض حذف رسالة ليست للبوت: '+id);await m.delete();deleted++}
        await markAudit(db,{guildId:c.guild_id,meetingId:c.meeting_id,actorId:client.user.id,meta:{channelId,keeperMessageId:state.keeperMessageId,deletedMessages:deleted,resumed:true}});state.completed=true;await writeJson(stateFile,state);ok++;log('✅ اكتمل حذف البقايا من محاولة ناجحة سابقة.');continue;
      }

      const batchSelection=await chooseBatchMessages({db,channel,candidate:c,expected,client});const keeper=batchSelection.chosen[0].message;state.keeperMessageId=keeper.id;state.cleanupMessageIds=batchSelection.allKnownMessageIds;await writeJson(stateFile,state);
      log('🧾 Audit:',batchSelection.chosen.length,'Batch /',batchSelection.attachments.length,'ملف خام | الرسائل المعروفة:',batchSelection.allKnownMessageIds.length);

      let recovered=null,sourceKind='';const existing=await pickValidSingleFinal(db,c.meeting_id,officialSec);
      if(existing){recovered={path:existing.path,duration:existing.duration,bytes:existing.bytes,targetSec:officialSec||existing.duration};sourceKind='existing-valid-final';log('✅ يوجد ملف نهائي محلي صالح بالفعل؛ لن نعيد المزج.');}
      else{
        log('🧠 إعادة بناء التسجيل من timeline الحقيقي للمقاطع الخام...');const prep=await prepareTracks({db,candidate:c,expected,batchSelection,dir});recovered=await mixTimeline({candidate:c,tracks:prep.tracks,dir,officialSec});await persistRecoveredFinal(db,{candidate:c,recovered,summary:prep.summary});sourceKind='recording_tracks-timeline-tree';
      }

      log('✅ التسجيل النهائي صالح | المدة:',fmt(recovered.duration),'| الحجم:',(recovered.bytes/1024/1024).toFixed(2)+'MB');
      state.unifiedPath=recovered.path;state.unifiedDurationSeconds=recovered.duration;state.unifiedBytes=recovered.bytes;state.sourceKind=sourceKind;await writeJson(stateFile,state);
      const base=['🎙️ **تسجيل الاجتماع — Operations 967**','الفريق: **'+c.team_name+'**','الاجتماع: **'+c.meeting_name+'**'];
      if(recovered.bytes<=DISCORD_MAX){log('📎 استبدال أول رسالة بملف واحد...');const content=[...base,'📎 **التسجيل النهائي الكامل مرفق في هذه الرسالة.**','📌 ملف واحد كامل للاجتماع.'].join('\n');await keeper.edit({content,attachments:[],files:[{attachment:recovered.path,name:'تسجيل - '+safeName(c.meeting_name)+'.ogg'}]});state.delivery='discord-single-attachment'}
      else{log('🔗 رفع الملف الكامل إلى Catbox...');const url=await uploadCatbox(recovered.path,stateFile,state);const content=[...base,'🔗 **التسجيل النهائي الكامل:** '+url,'📌 رابط واحد للتسجيل الكامل.'].join('\n');await keeper.edit({content,attachments:[]});state.delivery='catbox-single-link';state.catboxUrl=url}
      state.keeperUpdated=true;state.keeperUpdatedAt=new Date().toISOString();await writeJson(stateFile,state);

      log('🧹 حذف رسائل المقاطع والنسخ المكررة بعد نجاح الاستبدال...');let deleted=0;
      for(const id of batchSelection.allKnownMessageIds){if(String(id)===String(keeper.id))continue;const m=await channel.messages.fetch(String(id)).catch(()=>null);if(!m)continue;if(m.author?.id!==client.user.id)throw new Error('رفض حذف رسالة ليست للبوت: '+id);await m.delete();deleted++;if(deleted%20===0)log('   حُذف',deleted,'رسالة...')}
      await markAudit(db,{guildId:c.guild_id,meetingId:c.meeting_id,actorId:client.user.id,meta:{channelId,keeperMessageId:keeper.id,originalRawFiles:expected,knownLegacyMessages:batchSelection.allKnownMessageIds.length,deletedMessages:deleted,unifiedBytes:recovered.bytes,unifiedDurationSeconds:recovered.duration,sourceKind,delivery:state.delivery,catboxUrl:state.catboxUrl??null}});
      state.completed=true;state.deletedMessages=deleted;state.completedAt=new Date().toISOString();await writeJson(stateFile,state);ok++;log('✅ تم: بقيت رسالة تسجيل واحدة فقط لهذا الاجتماع.');
    }catch(error){failed++;state.lastError=error?.message??String(error);state.lastErrorAt=new Date().toISOString();await writeJson(stateFile,state).catch(()=>{});console.error('❌ توقف آمن لهذا الاجتماع:',state.lastError);console.error('   لم يتم حذف الرسائل قبل نجاح التسجيل النهائي.')}
  }
  return {ok,failed,skipped};
}

let result;try{result=await main()}finally{await db.end().catch(()=>{});try{client.destroy()}catch{}}
log('\n================================================================');log('نتيجة v1.10.10.3');log('✅ موحدة:',result.ok);log('⏭️ متجاوزة:',result.skipped);log('❌ فشلت بأمان:',result.failed);log('================================================================');if(result.failed)process.exitCode=2;
