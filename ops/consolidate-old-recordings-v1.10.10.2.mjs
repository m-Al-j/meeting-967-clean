import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import pg from 'pg';
import { Client, GatewayIntentBits } from 'discord.js';

const token=String(process.env.DISCORD_TOKEN??'').trim();
const dbUrl=String(process.env.DATABASE_URL??'').trim();
const ROOT=path.resolve(process.env.RECORDING_CLEANUP_ROOT??'storage/recording-message-consolidation-v1.10.10');
const DISCORD_MAX=7*1024*1024;
const CATBOX_SAFE_MAX=190*1024*1024;
const CATBOX_API='https://catbox.moe/user/api.php';
const APPLY=String(process.env.RECORDING_CLEANUP_APPLY??'1')==='1';
const VERSION='1.10.10.2';
const ACTION='meeting.recording.consolidated.v1.10.10.2';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(...x)=>console.log(...x);

function cleanId(v){return String(v??'unknown').replace(/[^A-Za-z0-9_-]/g,'_')}
function safeName(v){return String(v??'اجتماع').replace(/[<>:"/\\|?*\u0000-\u001F]/g,' ').replace(/\s+/g,' ').trim().slice(0,100)||'اجتماع'}
async function exists(p){try{const s=await fs.stat(p);return s.isFile()&&s.size>0}catch{return false}}
async function readJson(p){try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return {}}}
async function writeJson(p,v){await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(v,null,2)+'\n')}
function run(cmd,args,{timeoutMs=60*60_000}={}){
  return new Promise((resolve,reject)=>{
    const c=spawn(cmd,args,{stdio:['ignore','ignore','pipe']});let err='';
    c.stderr.on('data',d=>err=(err+String(d)).slice(-10000));
    const t=setTimeout(()=>{c.kill('SIGKILL');reject(new Error(cmd+' تجاوز مهلة التنفيذ'))},timeoutMs);
    c.once('error',e=>{clearTimeout(t);reject(e)});
    c.once('close',code=>{clearTimeout(t);code===0?resolve():reject(new Error(cmd+' فشل (code='+code+'): '+err.slice(-3000)))});
  });
}
async function duration(file){
  return await new Promise((resolve,reject)=>{
    const c=spawn('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{stdio:['ignore','pipe','pipe']});let out='',err='';
    c.stdout.on('data',d=>out+=String(d));c.stderr.on('data',d=>err+=String(d));
    c.once('error',reject);c.once('close',code=>{
      if(code!==0)return reject(new Error('ffprobe فشل: '+err.slice(-1000)));
      const n=Number.parseFloat(out.trim());Number.isFinite(n)&&n>0?resolve(n):reject(new Error('تعذر قراءة مدة '+file));
    });
  });
}
async function download(url,dest){
  const res=await fetch(url,{headers:{'User-Agent':'Operations967-RecordingCleanup/'+VERSION}});
  if(!res.ok||!res.body)throw new Error('فشل تنزيل جزء التسجيل HTTP '+res.status);
  await pipeline(Readable.fromWeb(res.body), (await import('node:fs')).createWriteStream(dest));
  const st=await fs.stat(dest);if(!st.size)throw new Error('تم تنزيل جزء فارغ.');return st.size;
}
function parseBatchKey(v){
  const m=String(v??'').match(/^batch-(\d+)-of-(\d+)$/i);
  return m?{n:Number(m[1]),total:Number(m[2])}:null;
}
async function ensureDisk(dir,neededBytes){
  try{
    const s=await fs.statfs(dir);const free=Number(s.bavail)*Number(s.bsize);
    const need=Math.max(150*1024*1024,Math.ceil(neededBytes*2.2));
    if(Number.isFinite(free)&&free<need)throw new Error('المساحة الحرة غير كافية بأمان. المتاح '+Math.round(free/1024/1024)+'MB والمطلوب تقريبًا '+Math.round(need/1024/1024)+'MB.');
  }catch(e){if(String(e?.message??'').includes('المساحة الحرة'))throw e}
}
async function mergeParts(parts,out,officialSec,{verifyInputSum=false}={}){
  if(!parts.length)throw new Error('لا توجد أجزاء لدمجها.');
  const list=out+'.concat.txt';
  await fs.writeFile(list,parts.map(p=>"file '"+String(p).replaceAll("'","'\\''")+"'").join('\n')+'\n');
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','24000','-c:a','libopus','-b:a','20k','-vbr','on','-application','voip',out],{timeoutMs:2*60*60_000});
  const finalDur=await duration(out);
  if(Number.isFinite(officialSec)&&officialSec>30){
    const r=finalDur/officialSec;
    if(r<0.55||r>1.35)throw new Error('رفض اعتماد التسجيل: مدته '+finalDur.toFixed(1)+'ث بينما مدة الاجتماع الرسمية '+officialSec.toFixed(1)+'ث.');
  }else if(verifyInputSum){
    let sum=0;for(let i=0;i<parts.length;i++)sum+=await duration(parts[i]);
    const r=finalDur/sum;if(!Number.isFinite(r)||r<0.97||r>1.03)throw new Error('فشل تحقق الدمج: '+finalDur.toFixed(1)+'ث مقابل مجموع الأجزاء '+sum.toFixed(1)+'ث.');
  }
  return finalDur;
}
async function uploadCatbox(file,stateFile,state){
  if(state.catboxUrl&&/^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(state.catboxUrl))return state.catboxUrl;
  let upload=file;let st=await fs.stat(upload);
  if(st.size>CATBOX_SAFE_MAX){
    const compact=path.join(path.dirname(file),'recording-complete-catbox.ogg');
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,'-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','24000','-c:a','libopus','-b:a','14k','-vbr','on','-application','voip',compact]);
    st=await fs.stat(compact);upload=compact;if(st.size>CATBOX_SAFE_MAX)throw new Error('التسجيل ما زال أكبر من حد Catbox الآمن بعد الضغط.');
  }
  let last;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const form=new FormData();form.append('reqtype','fileupload');
      const userhash=String(process.env.CATBOX_USERHASH??'').trim();if(userhash)form.append('userhash',userhash);
      form.append('fileToUpload',await openAsBlob(upload,{type:'audio/ogg'}),path.basename(upload));
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new Error('انتهت مهلة Catbox')),30*60_000);
      let res;try{res=await fetch(CATBOX_API,{method:'POST',body:form,signal:controller.signal,headers:{'User-Agent':'Operations967-RecordingCleanup/'+VERSION}})}finally{clearTimeout(timer)}
      const body=String(await res.text()).trim();if(!res.ok)throw new Error('Catbox HTTP '+res.status+': '+body.slice(0,300));
      if(!/^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(body))throw new Error('Catbox أعاد رابطًا غير صالح.');
      state.catboxUrl=body;await writeJson(stateFile,state);return body;
    }catch(e){last=e;if(attempt<3)await sleep(3000*attempt)}
  }
  throw last??new Error('فشل Catbox');
}
async function recordingRows(db,meetingId){
  const {rows}=await db.query(`SELECT id::text,status,storage_path,final_paths,final_bytes,started_at,stopped_at,metadata FROM recordings WHERE meeting_id=$1 ORDER BY CASE WHEN status='completed' THEN 0 ELSE 1 END, COALESCE(stopped_at,started_at) DESC, started_at DESC`,[meetingId]);
  return rows;
}
async function pickSingleLocal(db,meetingId,officialSec){
  const rows=await recordingRows(db,meetingId);const options=[];
  for(const row of rows){
    const paths=Array.isArray(row.final_paths)?row.final_paths:[];if(paths.length!==1)continue;const p=String(paths[0]??'');if(!(await exists(p)))continue;
    try{const st=await fs.stat(p);const d=await duration(p);let score=0;if(officialSec>30){score=Math.abs(d-officialSec)/officialSec;if(score>0.35)continue}options.push({path:p,bytes:st.size,duration:d,recordingId:row.id,score})}catch{}
  }
  options.sort((a,b)=>a.score-b.score||b.bytes-a.bytes);return options[0]??null;
}
async function pickLocalParts(db,meetingId){
  const rows=await recordingRows(db,meetingId);
  for(const row of rows){
    const paths=Array.isArray(row.final_paths)?row.final_paths.map(String):[];if(paths.length<2)continue;
    let ok=true;for(const p of paths){if(!(await exists(p))){ok=false;break}}
    if(ok)return {paths,recordingId:row.id};
  }
  return null;
}
async function markAudit(db,{guildId,meetingId,actorId,meta}){
  const q=await db.query("SELECT 1 FROM audit_logs WHERE guild_id=$1 AND action=$2 AND target_type='meeting' AND target_id=$3 LIMIT 1",[guildId,ACTION,meetingId]);if(q.rows.length)return;
  await db.query("INSERT INTO audit_logs(guild_id,actor_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,'meeting',$4,$5::jsonb)",[guildId,actorId,ACTION,meetingId,JSON.stringify(meta)]);
}

const db=new pg.Client({connectionString:dbUrl});
const client=new Client({intents:[GatewayIntentBits.Guilds]});
let readyResolve;const ready=new Promise(r=>readyResolve=r);client.once('clientReady',()=>readyResolve());

async function chooseBatchMessages({db,guild,channel,candidate,expected}){
  const expectedBatches=Math.ceil(expected/5);
  const {rows}=await db.query(`
    SELECT id,metadata,created_at
    FROM audit_logs
    WHERE guild_id=$1
      AND action='meeting.recording.discord.team_channel.batch.sent'
      AND target_type='meeting' AND target_id=$2
      AND COALESCE(metadata->>'channelId','')=$3
    ORDER BY created_at DESC,id DESC
  `,[candidate.guild_id,candidate.meeting_id,candidate.channel_id]);
  const groups=new Map();const allKnown=new Set();
  for(const row of rows){
    const key=parseBatchKey(row.metadata?.batchKey);const mid=String(row.metadata?.messageId??'');if(mid)allKnown.add(mid);
    if(!key||key.total!==expectedBatches||key.n<1||key.n>expectedBatches||!mid)continue;
    if(!groups.has(key.n))groups.set(key.n,[]);groups.get(key.n).push(row);
  }
  // Also collect every legacy final-message id so duplicate first messages can be removed after success.
  const finals=await db.query(`SELECT metadata FROM audit_logs WHERE guild_id=$1 AND action='meeting.recording.discord.team_channel.sent' AND target_type='meeting' AND target_id=$2 AND COALESCE(metadata->>'channelId','')=$3`,[candidate.guild_id,candidate.meeting_id,candidate.channel_id]);
  for(const row of finals.rows){const id=String(row.metadata?.messageId??'');if(id)allKnown.add(id)}

  const chosen=[];const sentAt=new Date(candidate.sent_at).getTime();
  for(let n=1;n<=expectedBatches;n++){
    const need=Math.min(5,expected-(n-1)*5);const entries=groups.get(n)??[];
    const ordered=[...entries].sort((a,b)=>{
      const at=new Date(a.created_at).getTime(),bt=new Date(b.created_at).getTime();
      const ap=at<=sentAt?0:1,bp=bt<=sentAt?0:1;return ap-bp||bt-at||Number(b.id)-Number(a.id);
    });
    let selected=null;
    for(const row of ordered){
      const id=String(row.metadata?.messageId??'');const m=await channel.messages.fetch(id).catch(()=>null);if(!m||m.author?.id!==client.user.id)continue;
      const at=[...m.attachments.values()];if(at.length!==need)continue;
      selected={n,message:m,attachments:at,auditId:row.id,createdAt:row.created_at};break;
    }
    if(!selected)throw new Error('لم أجد رسالة كاملة صالحة للـBatch '+n+' من '+expectedBatches+' (المطلوب '+need+' مرفقات). لن ألمس الرسائل.');
    chosen.push(selected);
  }
  const attachments=chosen.flatMap(x=>x.attachments.map(a=>({messageId:x.message.id,url:a.url,name:a.name??'',size:Number(a.size??0),batch:x.n})));
  if(attachments.length!==expected)throw new Error('اختيار الـBatch أعطى '+attachments.length+' مرفقًا بدل '+expected+'.');
  return {chosen,attachments,allKnownMessageIds:[...allKnown]};
}

async function main(){
  await fs.mkdir(ROOT,{recursive:true});await db.connect();
  const {rows:candidates}=await db.query(`
    SELECT DISTINCT ON (a.guild_id,a.target_id)
      a.guild_id::text AS guild_id,a.target_id AS meeting_id,a.metadata,
      a.created_at AS sent_at,a.id AS sent_audit_id,
      COALESCE(a.metadata->>'channelId','') AS channel_id,
      m.started_at,m.ended_at,COALESCE(m.name,'اجتماع') AS meeting_name,COALESCE(t.name,'الفريق') AS team_name
    FROM audit_logs a
    LEFT JOIN meetings m ON m.guild_id=a.guild_id AND m.id::text=a.target_id
    LEFT JOIN teams t ON t.id=m.team_id
    WHERE a.action='meeting.recording.discord.team_channel.sent'
      AND a.target_type='meeting'
      AND COALESCE(a.metadata->>'parts','') ~ '^[0-9]+$'
      AND (a.metadata->>'parts')::int > 1
      AND NOT EXISTS(SELECT 1 FROM audit_logs z WHERE z.guild_id=a.guild_id AND z.target_type='meeting' AND z.target_id=a.target_id AND z.action=$1)
    ORDER BY a.guild_id,a.target_id,a.created_at DESC,a.id DESC
  `,[ACTION]);
  log('🔎 التسجيلات القديمة المجزأة المرشحة:',candidates.length);if(!candidates.length)return {ok:0,failed:0,skipped:0};
  if(!APPLY){for(const c of candidates)log(' •',c.team_name,'—',c.meeting_name,'| أجزاء:',c.metadata?.parts);return {ok:0,failed:0,skipped:candidates.length}}
  await client.login(token);await ready;log('🤖 Discord online كـ',client.user?.tag??client.user?.id);
  let ok=0,failed=0,skipped=0;

  for(const c of candidates){
    const expected=Number(c.metadata?.parts??0);const channelId=String(c.channel_id??'');
    const officialSec=c.started_at&&c.ended_at?Math.max(0,(new Date(c.ended_at)-new Date(c.started_at))/1000):0;
    const dir=path.join(ROOT,cleanId(c.meeting_id));const partsDir=path.join(dir,'original-parts-v110102');const stateFile=path.join(dir,'state-v1.10.10.2.json');
    await fs.mkdir(partsDir,{recursive:true});let state={...(await readJson(stateFile)),meetingId:c.meeting_id,guildId:c.guild_id,channelId,expectedParts:expected,meetingName:c.meeting_name,teamName:c.team_name};
    try{
      log('\n────────────────────────────────────────────────────────');log('🎙️',c.team_name,'—',c.meeting_name,'| المتوقع:',expected,'جزء');if(!channelId)throw new Error('لا يوجد channelId في Audit Log.');
      const guild=await client.guilds.fetch(c.guild_id);const channel=await guild.channels.fetch(channelId);if(!channel?.isTextBased?.()||!channel.messages?.fetch)throw new Error('قناة التسجيل غير متاحة.');

      // Resume only-deletion stage safely.
      if(state.keeperUpdated&&Array.isArray(state.cleanupMessageIds)&&state.keeperMessageId){
        let deleted=0;for(const id of state.cleanupMessageIds){if(String(id)===String(state.keeperMessageId))continue;const m=await channel.messages.fetch(String(id)).catch(()=>null);if(!m)continue;if(m.author?.id!==client.user.id)throw new Error('رفض حذف رسالة ليست للبوت: '+id);await m.delete();deleted++;}
        await markAudit(db,{guildId:c.guild_id,meetingId:c.meeting_id,actorId:client.user.id,meta:{channelId,keeperMessageId:state.keeperMessageId,originalParts:expected,delivery:state.delivery,catboxUrl:state.catboxUrl??null,deletedMessages:deleted,backupDir:dir}});
        state.completed=true;state.completedAt=new Date().toISOString();await writeJson(stateFile,state);ok++;log('✅ اكتمل حذف البقايا لمحاولة سابقة.');continue;
      }

      let unified=null,unifiedDur=0,sourceKind=null;
      const single=await pickSingleLocal(db,c.meeting_id,officialSec);
      if(single){unified=single.path;unifiedDur=single.duration;sourceKind='recordings.final_paths-single';log('✅ وجدنا تسجيلًا نهائيًا واحدًا محليًا صالحًا؛ لن ننزل أجزاء Discord.');}

      let batchSelection=null;
      // We still need the exact legacy messages for cleanup. Use Audit batch order, never filenames.
      batchSelection=await chooseBatchMessages({db,guild,channel,candidate:c,expected});
      const keeper=batchSelection.chosen[0].message;
      state.keeperMessageId=keeper.id;state.cleanupMessageIds=batchSelection.allKnownMessageIds;await writeJson(stateFile,state);
      log('🧾 تم تحديد',batchSelection.chosen.length,'Batch بالترتيب، والمجموع',batchSelection.attachments.length,'مرفقًا بالضبط.');
      log('♻️ رسائل التسجيل المعروفة في Audit (بما فيها التكرارات):',batchSelection.allKnownMessageIds.length);

      if(!unified){
        const localMulti=await pickLocalParts(db,c.meeting_id);
        if(localMulti){
          log('💾 وجدنا',localMulti.paths.length,'ملف final_paths محليًا؛ سنبني منها التسجيل الموحد قبل تنزيل Discord.');
          unified=path.join(dir,'recording-complete-local.ogg');unifiedDur=await mergeParts(localMulti.paths,unified,officialSec,{verifyInputSum:!officialSec});sourceKind='recordings.final_paths-multi';
        }
      }

      if(!unified){
        const totalBytes=batchSelection.attachments.reduce((s,a)=>s+(Number(a.size)||0),0);await ensureDisk(dir,totalBytes);
        const localParts=[];
        for(let i=0;i<batchSelection.attachments.length;i++){
          const a=batchSelection.attachments[i];const dest=path.join(partsDir,'part-'+String(i+1).padStart(4,'0')+'.ogg');
          if(!(await exists(dest))){if(i%10===0||i===batchSelection.attachments.length-1)log('⬇️ تنزيل',i+1,'/',expected);await download(a.url,dest)}
          localParts.push(dest);
        }
        unified=path.join(dir,'recording-complete-from-audit-batches.ogg');log('🧩 دمج',localParts.length,'جزءًا بالترتيب المحفوظ في Audit...');
        unifiedDur=await mergeParts(localParts,unified,officialSec,{verifyInputSum:!officialSec});sourceKind='discord-audit-batches';
      }

      const st=await fs.stat(unified);if(!st.isFile()||st.size<=0)throw new Error('ملف التسجيل الموحد غير صالح.');
      if(!unifiedDur)unifiedDur=await duration(unified);
      state.unifiedPath=unified;state.unifiedBytes=st.size;state.unifiedDurationSeconds=unifiedDur;state.officialMeetingDurationSeconds=officialSec||null;state.sourceKind=sourceKind;await writeJson(stateFile,state);
      log('✅ التحقق نجح | المدة:',unifiedDur.toFixed(1)+'ث','| الحجم:',Math.round(st.size/1024/1024*10)/10+'MB');

      const title=safeName(c.meeting_name);const base=['🎙️ **تسجيل الاجتماع — Operations 967**','الفريق: **'+c.team_name+'**','الاجتماع: **'+c.meeting_name+'**'];
      if(st.size<=DISCORD_MAX){
        log('📎 تحديث رسالة التسجيل الأولى بملف واحد...');const content=[...base,'📎 **التسجيل النهائي الكامل مرفق في هذه الرسالة.**','📌 ملف واحد كامل للاجتماع.'].join('\n');
        await keeper.edit({content,attachments:[],files:[{attachment:unified,name:'تسجيل - '+title+'.ogg'}]});state.delivery='discord-single-attachment';
      }else{
        log('🔗 رفع التسجيل الموحد إلى Catbox...');const url=await uploadCatbox(unified,stateFile,state);const content=[...base,'🔗 **التسجيل النهائي الكامل:** '+url,'📌 رابط واحد للتسجيل الكامل.'].join('\n');
        log('✏️ تحديث رسالة التسجيل الأولى بالرابط الواحد...');await keeper.edit({content,attachments:[]});state.delivery='catbox-single-link';state.catboxUrl=url;
      }
      state.keeperUpdated=true;state.keeperUpdatedAt=new Date().toISOString();await writeJson(stateFile,state);

      log('🧹 حذف كل رسائل الأجزاء والنسخ المكررة المعروفة في Audit...');let deleted=0;
      for(const id of batchSelection.allKnownMessageIds){if(String(id)===String(keeper.id))continue;const m=await channel.messages.fetch(String(id)).catch(()=>null);if(!m)continue;if(m.author?.id!==client.user.id)throw new Error('رفض حذف رسالة ليست للبوت: '+id);await m.delete();deleted++;if(deleted%20===0)log('   حُذف',deleted,'رسالة...')}
      await markAudit(db,{guildId:c.guild_id,meetingId:c.meeting_id,actorId:client.user.id,meta:{channelId,keeperMessageId:keeper.id,originalParts:expected,selectedBatches:batchSelection.chosen.length,knownLegacyMessages:batchSelection.allKnownMessageIds.length,deletedMessages:deleted,unifiedBytes:st.size,unifiedDurationSeconds:unifiedDur,sourceKind,delivery:state.delivery,catboxUrl:state.catboxUrl??null,backupDir:dir}});
      state.completed=true;state.completedAt=new Date().toISOString();state.deletedMessages=deleted;await writeJson(stateFile,state);ok++;log('✅ تم بنجاح: بقيت رسالة تسجيل واحدة فقط من الرسائل المعروفة لهذا الاجتماع.');
    }catch(error){failed++;state.lastError=error?.message??String(error);state.lastErrorAt=new Date().toISOString();await writeJson(stateFile,state).catch(()=>{});console.error('❌ توقف آمن لهذا الاجتماع:',state.lastError);console.error('   لم يتم حذف أو تعديل التسجيل القديم إلا إذا كانت keeperUpdated=true من مرحلة ناجحة سابقة.');}
  }
  return {ok,failed,skipped};
}

let result;try{result=await main()}finally{await db.end().catch(()=>{});try{client.destroy()}catch{}}
log('\n================================================================');log('نتيجة v1.10.10.2');log('✅ موحدة:',result.ok);log('⏭️ متجاوزة:',result.skipped);log('❌ فشلت بأمان:',result.failed);log('💾 مجلد النسخ/العمل:',ROOT);log('================================================================');
if(result.failed)process.exitCode=2;
