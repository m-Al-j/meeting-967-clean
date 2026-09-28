import 'dotenv/config';
import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { Client, GatewayIntentBits } from 'discord.js';

const APPLY=String(process.env.RECORDING_CLEANUP_APPLY??'0')==='1';
const APP=process.cwd();
const ROOT=path.join(APP,'storage','recording-message-consolidation-v1.10.10');
const DISCORD_MAX=7*1024*1024;
const CATBOX_SAFE_MAX=190*1024*1024;
const CATBOX_API='https://catbox.moe/user/api.php';
const token=String(process.env.DISCORD_TOKEN??'').trim();
const dbUrl=String(process.env.DATABASE_URL??'').trim();

function log(...x){console.log(...x)}
function safeName(v){
  const s=String(v??'اجتماع').replace(/[\\/:*?"<>|\u0000-\u001F]/g,'-').replace(/\s+/g,' ').trim();
  return (s||'اجتماع').slice(0,90);
}
function cleanId(v){return String(v??'unknown').replace(/[^A-Za-z0-9_-]/g,'_')}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function exists(p){try{await fs.access(p);return true}catch{return false}}
async function readJson(p){try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return {}}}
async function writeJson(p,obj){await fs.writeFile(p,JSON.stringify(obj,null,2)+'\n')}

async function run(command,args,{timeoutMs=60*60_000}={}){
  await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','ignore','pipe']});
    let stderr='';
    child.stderr?.on('data',c=>{stderr=(stderr+String(c)).slice(-12000)});
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(command+' تجاوز مهلة التنفيذ.'))},timeoutMs);
    child.once('error',e=>{clearTimeout(timer);reject(e)});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(command+' فشل (code='+code+'): '+stderr.slice(-2500)))});
  });
}
async function duration(file){
  return await new Promise((resolve,reject)=>{
    const child=spawn('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{stdio:['ignore','pipe','pipe']});
    let out='',err='';
    child.stdout.on('data',c=>out+=String(c));child.stderr.on('data',c=>err+=String(c));
    child.once('error',reject);
    child.once('close',code=>{
      if(code!==0)return reject(new Error('ffprobe فشل: '+err.slice(-1000)));
      const n=Number.parseFloat(out.trim());
      Number.isFinite(n)&&n>0?resolve(n):reject(new Error('مدة ملف غير صالحة: '+file));
    });
  });
}
async function download(url,dest){
  const res=await fetch(url,{headers:{'User-Agent':'Operations967-RecordingCleanup/1.10.10'}});
  if(!res.ok)throw new Error('فشل تنزيل جزء التسجيل HTTP '+res.status);
  const buf=Buffer.from(await res.arrayBuffer());
  if(!buf.length)throw new Error('تم تنزيل جزء فارغ.');
  await fs.writeFile(dest,buf);
  return buf.length;
}
function partNumber(name){
  const s=String(name??'');
  const m=s.match(/جزء\s+(\d+)\s+من\s+(\d+)/u) || s.match(/part[-_ ]?(\d+)/i);
  return m?Number(m[1]):null;
}
async function uploadCatbox(file,stateFile,state){
  if(state.catboxUrl && /^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(state.catboxUrl))return state.catboxUrl;
  let upload=file;
  let stat=await fs.stat(upload);
  if(stat.size>CATBOX_SAFE_MAX){
    const compact=path.join(path.dirname(file),'recording-complete-catbox.ogg');
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,'-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','24000','-c:a','libopus','-b:a','14k','-vbr','on','-application','voip',compact]);
    stat=await fs.stat(compact);upload=compact;
    if(stat.size>CATBOX_SAFE_MAX)throw new Error('التسجيل الموحد ما زال أكبر من الحد الآمن لـCatbox حتى بعد الضغط.');
  }
  let last;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const form=new FormData();form.append('reqtype','fileupload');
      const userhash=String(process.env.CATBOX_USERHASH??'').trim();if(userhash)form.append('userhash',userhash);
      form.append('fileToUpload',await openAsBlob(upload,{type:'audio/ogg'}),path.basename(upload));
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(new Error('انتهت مهلة Catbox')),30*60_000);
      let res;try{res=await fetch(CATBOX_API,{method:'POST',body:form,signal:controller.signal,headers:{'User-Agent':'Operations967-RecordingCleanup/1.10.10'}})}finally{clearTimeout(timer)}
      const body=String(await res.text()).trim();
      if(!res.ok)throw new Error('Catbox HTTP '+res.status+': '+body.slice(0,300));
      if(!/^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(body))throw new Error('Catbox أعاد رابطًا غير صالح: '+body.slice(0,300));
      state.catboxUrl=body;await writeJson(stateFile,state);return body;
    }catch(e){last=e;if(attempt<3)await sleep(3000*attempt)}
  }
  throw last??new Error('فشل Catbox');
}

async function pickLocalCanonical(db,meetingId,officialSec){
  const {rows}=await db.query(`
    SELECT id::text,status,storage_path,final_paths,final_bytes,started_at,stopped_at,metadata
    FROM recordings
    WHERE meeting_id=$1
    ORDER BY
      CASE WHEN status='completed' THEN 0 ELSE 1 END,
      COALESCE(stopped_at,started_at) DESC,
      started_at DESC
  `,[meetingId]);
  const options=[];
  for(const row of rows){
    const paths=Array.isArray(row.final_paths)?row.final_paths:[];
    if(paths.length!==1)continue;
    const p=String(paths[0]??'').trim();
    if(!p || !(await exists(p)))continue;
    try{
      const st=await fs.stat(p);
      if(!st.isFile()||st.size<=0)continue;
      const dur=await duration(p);
      let score=0;
      if(Number.isFinite(officialSec)&&officialSec>10){
        score=Math.abs(dur-officialSec)/officialSec;
        // لا نعتمد ملفًا محليًا يبدو أطول/أقصر بشكل شاذ عن الاجتماع.
        if(score>0.35)continue;
      }
      options.push({path:p,bytes:st.size,duration:dur,recordingId:row.id,score});
    }catch{}
  }
  options.sort((a,b)=>a.score-b.score || b.bytes-a.bytes);
  return options[0]??null;
}

async function markAudit(db,{guildId,meetingId,actorId,meta}){
  const already=await db.query("SELECT 1 FROM audit_logs WHERE guild_id=$1 AND action='meeting.recording.consolidated.v1.10.10' AND target_type='meeting' AND target_id=$2 LIMIT 1",[guildId,meetingId]);
  if(already.rows.length)return;
  await db.query(
    "INSERT INTO audit_logs(guild_id,actor_id,action,target_type,target_id,metadata) VALUES($1,$2,'meeting.recording.consolidated.v1.10.10','meeting',$3,$4::jsonb)",
    [guildId,actorId,meetingId,JSON.stringify(meta)],
  );
}

const db=new pg.Client({connectionString:dbUrl});
const client=new Client({intents:[GatewayIntentBits.Guilds]});
let readyResolve;const ready=new Promise(r=>readyResolve=r);client.once('clientReady',()=>readyResolve());

async function main(){
  await fs.mkdir(ROOT,{recursive:true});
  await db.connect();
  const {rows:candidates}=await db.query(`
    SELECT DISTINCT ON (a.guild_id,a.target_id)
      a.guild_id::text AS guild_id,
      a.target_id AS meeting_id,
      a.metadata,
      m.started_at,
      m.ended_at,
      COALESCE(m.name,'اجتماع') AS meeting_name,
      COALESCE(t.name,'الفريق') AS team_name
    FROM audit_logs a
    LEFT JOIN meetings m ON m.guild_id=a.guild_id AND m.id::text=a.target_id
    LEFT JOIN teams t ON t.id=m.team_id
    WHERE a.action='meeting.recording.discord.team_channel.sent'
      AND a.target_type='meeting'
      AND COALESCE(a.metadata->>'parts','') ~ '^[0-9]+$'
      AND (a.metadata->>'parts')::int > 1
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs z
        WHERE z.guild_id=a.guild_id
          AND z.target_type='meeting'
          AND z.target_id=a.target_id
          AND z.action='meeting.recording.consolidated.v1.10.10'
      )
    ORDER BY a.guild_id,a.target_id,a.created_at DESC,a.id DESC
  `);

  log('🔎 التسجيلات القديمة المجزأة المرشحة:',candidates.length);
  if(!candidates.length)return {ok:0,failed:0,skipped:0};
  if(!APPLY){
    for(const c of candidates)log(' •',c.team_name,'—',c.meeting_name,'| أجزاء:',c.metadata?.parts,'| meeting:',c.meeting_id);
    log('ℹ️ وضع فحص فقط. للتطبيق استخدم RECORDING_CLEANUP_APPLY=1');
    return {ok:0,failed:0,skipped:candidates.length};
  }

  await client.login(token);await ready;
  log('🤖 Discord online كـ',client.user?.tag??client.user?.id);
  let ok=0,failed=0,skipped=0;

  for(const c of candidates){
    const expected=Number(c.metadata?.parts??0);
    const channelId=String(c.metadata?.channelId??'');
    const officialSec=(
      c.started_at && c.ended_at
        ? Math.max(0,(new Date(c.ended_at).getTime()-new Date(c.started_at).getTime())/1000)
        : 0
    );
    const dir=path.join(ROOT,cleanId(c.meeting_id));
    const partsDir=path.join(dir,'original-parts');
    const stateFile=path.join(dir,'state.json');
    await fs.mkdir(partsDir,{recursive:true});
    const state={...(await readJson(stateFile)),guildId:c.guild_id,meetingId:c.meeting_id,channelId,expectedParts:expected,meetingName:c.meeting_name,teamName:c.team_name};
    try{
      log('\n────────────────────────────────────────────────────────');
      log('🎙️',c.team_name,'—',c.meeting_name,'| المتوقع:',expected,'جزء');
      if(!channelId)throw new Error('سجل التدقيق القديم لا يحتوي channelId.');
      const guild=await client.guilds.fetch(c.guild_id);
      const channel=await guild.channels.fetch(channelId);
      if(!channel?.isTextBased?.() || !channel.messages?.fetch)throw new Error('قناة التسجيل غير متاحة أو لا تدعم سجل الرسائل.');

      const {rows:batches}=await db.query(`
        SELECT id,metadata,created_at
        FROM audit_logs
        WHERE guild_id=$1
          AND action='meeting.recording.discord.team_channel.batch.sent'
          AND target_type='meeting' AND target_id=$2
          AND COALESCE(metadata->>'channelId','')=$3
        ORDER BY id ASC
      `,[c.guild_id,c.meeting_id,channelId]);
      const messageIds=[...new Set(batches.map(x=>String(x.metadata?.messageId??'')).filter(Boolean))];
      const preferred=String(c.metadata?.messageId??'');
      if(preferred && !messageIds.includes(preferred))messageIds.unshift(preferred);
      if(!messageIds.length)throw new Error('لم أجد معرفات رسائل الأجزاء في سجل التدقيق.');
      state.messageIds=messageIds;state.keeperMessageId=state.keeperMessageId||preferred||messageIds[0];await writeJson(stateFile,state);

      // إذا كانت الرسالة الموحدة تم تحديثها في محاولة سابقة، نكمل حذف البقايا فقط.
      if(state.keeperUpdated){
        const keeperId=String(state.keeperMessageId);
        for(const id of messageIds){
          if(id===keeperId)continue;
          const m=await channel.messages.fetch(id).catch(()=>null);
          if(m && m.author?.id===client.user.id)await m.delete().catch(e=>{throw new Error('تعذر حذف رسالة جزء '+id+': '+e.message)});
        }
        await markAudit(db,{guildId:c.guild_id,meetingId:c.meeting_id,actorId:client.user.id,meta:{channelId,keeperMessageId:keeperId,originalParts:expected,delivery:state.delivery??null,catboxUrl:state.catboxUrl??null,backupDir:dir}});
        state.completed=true;state.completedAt=new Date().toISOString();await writeJson(stateFile,state);ok++;
        log('✅ اكتمل تنظيف الرسائل المتبقية لمحاولة سابقة.');
        continue;
      }

      const messages=[];
      for(const id of messageIds){
        const m=await channel.messages.fetch(id).catch(()=>null);
        if(m && m.author?.id===client.user.id)messages.push(m);
      }
      if(!messages.length)throw new Error('رسائل الأجزاء لم تعد موجودة في القناة.');
      let keeper=messages.find(m=>m.id===String(state.keeperMessageId))??messages[0];
      state.keeperMessageId=keeper.id;await writeJson(stateFile,state);

      const found=[];let fallbackOrder=0;
      for(const m of messages){
        for(const a of m.attachments.values()){
          fallbackOrder++;
          const n=partNumber(a.name);
          found.push({messageId:m.id,url:a.url,name:a.name??('part-'+fallbackOrder+'.ogg'),number:n,fallbackOrder,size:Number(a.size??0)});
        }
      }
      if(!found.length)throw new Error('لم أجد أي مرفق تسجيل في رسائل الأجزاء.');

      // v1.10.10.1: بعض محاولات OutputReliability أعادت إرسال نفس أجزاء التسجيل،
      // لذلك قد نجد 523 مرفقًا بينما السجل النهائي يقول 269 جزءًا منطقيًا.
      // نعتمد أول نسخة لكل رقم جزء ولا نخلط النسخ المكررة داخل الصوت.
      const byNumber=new Map();
      const duplicates=[];
      const unnumbered=[];
      for(const item of found){
        if(Number.isInteger(item.number) && item.number>=1 && item.number<=expected){
          if(!byNumber.has(item.number))byNumber.set(item.number,item);
          else duplicates.push(item);
        }else{
          unnumbered.push(item);
        }
      }

      let selected=[];
      if(byNumber.size===expected){
        selected=Array.from({length:expected},(_,i)=>byNumber.get(i+1));
        log('♻️ اكتشفنا',found.length,'مرفقًا، منها',duplicates.length,'نسخة مكررة. سنستخدم',selected.length,'جزءًا منطقيًا فقط.');
      }else if(found.length===expected){
        selected=[...found].sort((a,b)=>a.fallbackOrder-b.fallbackOrder);
        log('ℹ️ أسماء الأجزاء غير كاملة، لكن عدد المرفقات يطابق المتوقع تمامًا؛ سنستخدم ترتيب رسائل Discord.');
      }else{
        throw new Error(
          'المرفقات الموجودة '+found.length+
          '، والأجزاء المرقمة الفريدة '+byNumber.size+
          '، والمتوقع '+expected+
          '. لا يمكن تحديد مجموعة كاملة بأمان؛ لن ألمس الرسائل.'
        );
      }

      await writeJson(path.join(dir,'manifest.json'),{
        meetingId:c.meeting_id,guildId:c.guild_id,channelId,messageIds,
        keeperMessageId:keeper.id,expectedParts:expected,
        totalDiscordAttachments:found.length,duplicateAttachments:duplicates.length,
        ignoredUnnumbered:unnumbered.length,
        selectedAttachments:selected.map(({messageId,name,number,size})=>({messageId,name,number,size})),
        savedAt:new Date().toISOString()
      });

      // الأفضل دائمًا استخدام الملف النهائي الأصلي الموجود محليًا إن كان صالحًا؛
      // فهو أدق من إعادة تركيب مرفقات Discord المكررة.
      let unified=null;
      let sourceDuration=0;
      let mergedDur=0;
      let localParts=[];
      const canonical=await pickLocalCanonical(db,c.meeting_id,officialSec);
      if(canonical){
        unified=canonical.path;
        sourceDuration=canonical.duration;
        mergedDur=canonical.duration;
        log('✅ وجدنا الملف النهائي الأصلي محليًا؛ سنستخدمه مباشرة بدل إعادة تركيب أجزاء Discord.');
        log('   المدة:',mergedDur.toFixed(1)+'ث','| الحجم:',canonical.bytes,'bytes');
        state.canonicalRecordingId=canonical.recordingId;
        state.canonicalSource='recordings.final_paths';
      }else{
        log('ℹ️ لم نجد ملف final_paths محليًا صالحًا؛ سنعيد تركيب نسخة واحدة من كل جزء منطقي.');
        for(let i=0;i<selected.length;i++){
          const dest=path.join(partsDir,'part-'+String(i+1).padStart(4,'0')+'.ogg');
          if(!(await exists(dest)) || (await fs.stat(dest)).size===0){
            log('⬇️ تنزيل الجزء',i+1,'من',expected);
            await download(selected[i].url,dest);
          }
          localParts.push(dest);
        }

        const concatList=path.join(dir,'concat.txt');
        await fs.writeFile(concatList,localParts.map(p=>"file '"+p.replaceAll("'","'\\''")+"'").join('\n')+'\n');
        unified=path.join(dir,'recording-complete.ogg');
        if(!(await exists(unified)) || (await fs.stat(unified)).size===0){
          log('🧩 دمج',expected,'جزء منطقي إلى تسجيل واحد...');
          await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',concatList,'-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','24000','-c:a','libopus','-b:a','20k','-vbr','on','-application','voip',unified]);
        }
        log('🔎 التحقق من مدة التسجيل الموحد...');
        for(const p of localParts)sourceDuration+=await duration(p);
        mergedDur=await duration(unified);
        const mergeRatio=mergedDur/sourceDuration;
        if(!Number.isFinite(mergeRatio)||mergeRatio<0.97||mergeRatio>1.03){
          throw new Error('فشل تحقق الدمج: الموحد '+mergedDur.toFixed(1)+'ث مقابل الأجزاء '+sourceDuration.toFixed(1)+'ث. لن ألمس الرسائل.');
        }
        if(Number.isFinite(officialSec)&&officialSec>30){
          const officialRatio=mergedDur/officialSec;
          if(officialRatio<0.55||officialRatio>1.35){
            throw new Error(
              'مدة التسجيل المجمّع '+mergedDur.toFixed(1)+'ث لا تبدو منطقية مقارنة بمدة الاجتماع الرسمية '+
              officialSec.toFixed(1)+'ث. لن ألمس الرسائل.'
            );
          }
        }
        state.canonicalSource='discord-deduplicated-parts';
      }

      const st=await fs.stat(unified);
      if(!st.isFile()||st.size<=0)throw new Error('ملف التسجيل الموحد فارغ.');
      if(!mergedDur)mergedDur=await duration(unified);
      if(Number.isFinite(officialSec)&&officialSec>30){
        const r=mergedDur/officialSec;
        if(r<0.55||r>1.35){
          throw new Error(
            'رفض اعتماد التسجيل: مدته '+mergedDur.toFixed(1)+'ث بينما مدة الاجتماع الرسمية '+
            officialSec.toFixed(1)+'ث. لن ألمس الرسائل.'
          );
        }
      }
      state.unifiedPath=unified;
      state.unifiedBytes=st.size;
      state.sourceDurationSeconds=sourceDuration||mergedDur;
      state.unifiedDurationSeconds=mergedDur;
      state.officialMeetingDurationSeconds=officialSec||null;
      state.discordAttachmentsFound=found.length;
      state.logicalPartsSelected=selected.length;
      state.duplicateAttachmentsIgnored=duplicates.length;
      await writeJson(stateFile,state);

      const title=safeName(c.meeting_name);
      const base=[
        '🎙️ **تسجيل الاجتماع — Operations 967**',
        'الفريق: **'+c.team_name+'**',
        'الاجتماع: **'+c.meeting_name+'**',
      ];
      if(st.size<=DISCORD_MAX){
        log('📎 استبدال رسالة التسجيل الأولى بملف واحد...');
        const content=[...base,'📎 **التسجيل النهائي الكامل مرفق في هذه الرسالة.**','📌 ملف واحد كامل للاجتماع.'].join('\n');
        await keeper.edit({content,attachments:[],files:[{attachment:unified,name:'تسجيل - '+title+'.ogg'}]});
        state.delivery='discord-single-attachment';
      }else{
        log('🔗 رفع التسجيل الموحد إلى Catbox...');
        const url=await uploadCatbox(unified,stateFile,state);
        const content=[...base,'🔗 **التسجيل النهائي الكامل:** '+url,'📌 رابط واحد للتسجيل الكامل.'].join('\n');
        log('✏️ تحديث رسالة التسجيل الأولى بالرابط الواحد...');
        await keeper.edit({content,attachments:[]});
        state.delivery='catbox-single-link';state.catboxUrl=url;
      }
      state.keeperUpdated=true;state.keeperUpdatedAt=new Date().toISOString();await writeJson(stateFile,state);

      log('🧹 حذف رسائل الأجزاء الإضافية...');
      for(const id of messageIds){
        if(id===keeper.id)continue;
        const m=await channel.messages.fetch(id).catch(()=>null);
        if(!m)continue;
        if(m.author?.id!==client.user.id)throw new Error('رفض حذف رسالة ليست للبوت: '+id);
        await m.delete();
      }

      await markAudit(db,{guildId:c.guild_id,meetingId:c.meeting_id,actorId:client.user.id,meta:{channelId,keeperMessageId:keeper.id,originalParts:expected,discordAttachmentsFound:found.length,duplicateAttachmentsIgnored:duplicates.length,unifiedBytes:st.size,sourceDurationSeconds:state.sourceDurationSeconds,unifiedDurationSeconds:mergedDur,delivery:state.delivery,catboxUrl:state.catboxUrl??null,backupDir:dir}});
      state.completed=true;state.completedAt=new Date().toISOString();await writeJson(stateFile,state);
      ok++;log('✅ تم: يظهر الآن تسجيل واحد فقط لهذا الاجتماع.');
    }catch(error){
      failed++;state.lastError=error?.message??String(error);state.lastErrorAt=new Date().toISOString();await writeJson(stateFile,state).catch(()=>{});
      console.error('❌ لم يتم تنظيف هذا الاجتماع بأمان:',state.lastError);
      if(!state.keeperUpdated)console.error('   لم يتم تعديل أو حذف رسائل التسجيل القديمة لهذا الاجتماع.');
      else console.error('   الرسالة الموحدة جاهزة؛ أعد التشغيل ليكمل حذف أي رسائل متبقية.');
    }
  }
  return {ok,failed,skipped};
}

let result={ok:0,failed:0,skipped:0};
try{result=await main()}finally{client.destroy();await db.end().catch(()=>{})}
log('\n================================================================');
log('نتيجة تنظيف التسجيلات القديمة');
log('✅ موحدة:',result.ok);
log('⏭️ متجاوزة/فحص:',result.skipped);
log('❌ فشلت بأمان:',result.failed);
log('💾 نسخ الأجزاء الأصلية:',ROOT);
log('================================================================');
if(result.failed>0)process.exitCode=2;
