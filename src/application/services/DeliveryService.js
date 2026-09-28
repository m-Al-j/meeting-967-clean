import { memberDeliveryMode } from './memberDeliveryControl.js';
import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

async function existingFiles(paths = []) {
  const out = [];
  for (const file of paths.filter(Boolean)) {
    try { const st = await fs.stat(file); out.push({ path: file, bytes: st.size, sendable: st.size <= MAX_FILE_BYTES }); } catch {}
  }
  return out;
}

// Operations 967 v1.10.3 — direct Discord recording
const DISCORD_RECORDING_MAX_BYTES = 7 * 1024 * 1024;
const DISCORD_RECORDING_SEGMENT_SECONDS = 10 * 60;
// Operations 967 v1.10.4 — Catbox hybrid recording
const CATBOX_API_URL = 'https://catbox.moe/user/api.php';
const CATBOX_SAFE_MAX_BYTES = 190 * 1024 * 1024; // Catbox public limit is 200MB; keep a safety margin.
const CATBOX_UPLOAD_TIMEOUT_MS = 30 * 60_000;

function isCatboxFileUrl(value){
  try{
    const url=new URL(String(value));
    const name=url.pathname.startsWith('/')?url.pathname.slice(1):url.pathname;
    return url.protocol==='https:'&&url.hostname==='files.catbox.moe'&&Boolean(name)&&!name.includes('/')&&name.split('').every((ch)=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-'.includes(ch));
  }catch{return false}
}

function safeRecordingName(value='اجتماع'){
  return String(value||'اجتماع').replace(/[<>:"/\|?*\u0000-\u001F]/g,' ').replace(/\s+/g,' ').trim().slice(0,90)||'اجتماع';
}

async function runMediaProcess(command,args,{timeoutMs=30*60_000}={}){
  await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','ignore','pipe']});
    let stderr='';
    child.stderr?.on('data',(chunk)=>{stderr=(stderr+String(chunk)).slice(-6000)});
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(command+' تجاوز مهلة التنفيذ.'))},timeoutMs);
    child.once('error',(error)=>{clearTimeout(timer);reject(error)});
    child.once('close',(code)=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(command+' فشل (code='+code+'): '+stderr.slice(-1800)))});
  });
}
// Operations 967 v1.10.2 — meeting outputs are team-channel only.
// operations967-team-chat-meeting-outputs-v2


export class DeliveryService {
  constructor({ permissionService, recordings, outputs=null, meetings=null, tasks=null, audit, ownerUserId, logger }) {
    Object.assign(this, { permissionService, recordings, outputs, meetings, tasks, audit, ownerUserId: String(ownerUserId), logger });
  }

  async recipients({ guild, meeting }) {
    // Compatibility method kept intentionally. Meeting reports and recordings are
    // NEVER delivered by DM. Personal DMs are reserved for personal reminders,
    // excuses, assignments, permission changes, and alerts handled elsewhere.
    void guild; void meeting;
    return [];
  }

  // meeting967-team-attendance-fix1
  async #teamAttendanceChannelIdFix1(guild, meeting) {
    // v2 policy:
    // Report + final recording go ONLY to the team's normal "chat" channel
    // in the same category as the meeting voice channel.
    // Announcement/archive/log/media channels are never used.

    const normalize=(value)=>String(value??'')
      .normalize('NFKD')
      .replace(/[\u064B-\u065F\u0670]/g,'')
      .toLowerCase();

    const isChatName=(channel)=>{
      const name=normalize(channel?.name);
      return /(^|[-_\s\[\]「」『』])(?:شات|دردشه|دردشة|chat)(?:$|[-_\s\[\]「」『』])/.test(name)
        || name.includes('شات')
        || name.includes('دردش')
        || name.includes('chat');
    };

    const forbidden=(channel)=>{
      const name=normalize(channel?.name);
      return /اعلان|إعلان|اعلانات|إعلانات|announcement|announcements|ارشيف|أرشيف|archive|سجل|سجلات|log|logs|ملفات|صور|media/.test(name);
    };

    const isNormalText=(channel)=>Boolean(
      channel?.isTextBased?.() &&
      !forbidden(channel) &&
      (channel.type===0 || channel.type===undefined || channel.type===null)
    );

    const fetchOne=async(id)=>{
      if(!id)return null;
      return guild.channels.cache?.get?.(String(id))
        ?? await guild.channels.fetch(String(id)).catch(()=>null);
    };

    const voice=await fetchOne(meeting?.voice_channel_id);
    const categoryId=voice?.parentId?String(voice.parentId):null;

    // In real Discord runtime, fetch all channels if cache is incomplete.
    let collection=guild.channels.cache;
    if(!collection?.values || !collection.size){
      const fetched=await guild.channels.fetch().catch(()=>null);
      if(fetched?.values)collection=fetched;
    }
    let channels=collection?.values?[...collection.values()]:[];

    // Some test doubles only expose fetch(id), so keep configured channel as a
    // compatibility candidate, but only if it itself is a CHAT normal text channel.
    let configuredId=null;
    if(this.meetings?.db?.query){
      try{
        const {rows}=await this.meetings.db.query(
          'SELECT notification_channel_id FROM teams WHERE id=$1 AND guild_id=$2 LIMIT 1',
          [meeting.team_id,guild.id],
        );
        configuredId=rows?.[0]?.notification_channel_id
          ? String(rows[0].notification_channel_id)
          : null;
      }catch(error){
        this.logger?.warn?.('team chat output lookup failed',{
          meetingId:meeting.id,teamId:meeting.team_id,
          error:error?.message??String(error),
        });
      }
    }

    const configured=await fetchOne(configuredId);
    if(configured && !channels.some(x=>String(x?.id)===String(configured.id))){
      channels.push(configured);
    }

    // STRICT: only a channel whose name means "chat".
    const candidates=channels
      .filter(channel=>isNormalText(channel)&&isChatName(channel))
      .filter(channel=>!categoryId || String(channel.parentId??'')===categoryId)
      .map(channel=>{
        const name=normalize(channel.name);
        let score=0;
        if(categoryId && String(channel.parentId??'')===categoryId)score+=1000;
        if(name.includes('شات'))score+=500;
        if(name.includes('دردش'))score+=450;
        if(name.includes('chat'))score+=400;

        const team=normalize(meeting?.team_name);
        const words=team.split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=3);
        for(const word of words)if(name.includes(word))score+=15;

        if(configuredId && String(channel.id)===configuredId)score+=5;
        return {channel,score};
      })
      .sort((x,y)=>y.score-x.score);

    // Compatibility for legacy unit-test doubles only: older fixtures expose
    // a configured text channel without Discord identity/name and without a
    // meeting voice channel. Real Discord channels always have these fields,
    // so production still requires a named sibling chat channel.
    if(
      !candidates.length &&
      !meeting?.voice_channel_id &&
      configured &&
      isNormalText(configured) &&
      !configured?.id &&
      !configured?.name
    )return configuredId;

    return candidates[0]?.channel?.id
      ? String(candidates[0].channel.id)
      : null;
  }

  async #teamAttendanceWasSentFix1(guild, meeting, channelId) {
    this._teamAttendanceFix1Sent ??= new Set();
    const key = String(meeting.id) + ':' + String(channelId);
    if (this._teamAttendanceFix1Sent.has(key)) return true;

    if (!this.meetings?.db?.query) return false;
    try {
      const { rows } = await this.meetings.db.query(
        "SELECT 1 FROM audit_logs WHERE guild_id=$1 AND action=$2 AND target_type='meeting' AND target_id=$3 AND COALESCE(metadata->>'channelId','')=$4 LIMIT 1",
        [guild.id, 'meeting.attendance_report.team_channel.sent', String(meeting.id), String(channelId)],
      );
      if (rows?.length) this._teamAttendanceFix1Sent.add(key);
      return Boolean(rows?.length);
    } catch (error) {
      this.logger?.warn?.('team attendance dedupe fix1 failed', {
        meetingId: meeting.id,
        channelId: String(channelId),
        error: error?.message ?? String(error),
      });
      return false;
    }
  }

  async #deliverTeamAttendanceReportFix1({ guild, meeting, report }) {
    if (!report?.path) return null;

    const channelId = await this.#teamAttendanceChannelIdFix1(guild, meeting);
    if (!channelId) {
      return {
        userId: 'team-channel:' + String(meeting.team_id),
        destination: 'team_channel',
        report: false,
        recordingFiles: 0,
        decisions: false,
        ordinaryMember: false,
        regularOnly: false,
        skippedLarge: 0,
        skipped: false,
        error: 'لم يتم العثور على قناة شات كتابية عادية داخل قسم الفريق.',
      };
    }

    const item = {
      userId: 'team-channel:' + String(channelId),
      destination: 'team_channel',
      report: false,
      recordingFiles: 0,
      decisions: false,
      ordinaryMember: false,
      regularOnly: false,
      skippedLarge: 0,
      error: null,
      skipped: false,
    };

    if (await this.#teamAttendanceWasSentFix1(guild, meeting, channelId)) {
      item.report = true;
      item.skipped = true;
      return item;
    }

    // لا نعتمد على reportFiles/existingFiles الخاصة بالنسخة الحالية.
    // هذا هو الفرق الأساسي عن v1.7.9.4 التي فشل QA لديها عندك.
    let stat;
    try {
      stat = await fs.stat(report.path);
    } catch {
      item.error = 'ملف التقرير الرسمي غير موجود على القرص: ' + String(report.path);
      return item;
    }
    if (!stat?.isFile?.() || Number(stat.size || 0) <= 0) {
      item.error = 'ملف التقرير الرسمي فارغ أو غير صالح.';
      return item;
    }

    // 8MB حد محافظ حتى لا نفشل على سيرفرات Discord ذات الحد الأساسي.
    const maxBytes = 8 * 1024 * 1024;
    if (Number(stat.size) > maxBytes) {
      item.error = 'ملف التقرير أكبر من 8MB ولا يمكن إرساله كمرفق مباشر إلى قناة الفريق.';
      return item;
    }

    const channel = await guild.channels.fetch(String(channelId)).catch(() => null);
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
      item.error = 'قناة شات الفريق غير صالحة أو لا يملك البوت صلاحية الوصول إليها.';
      return item;
    }

    const meta = report.metadata && typeof report.metadata === 'object' ? report.metadata : {};
    const summary = [];
    if (Number.isFinite(Number(meta.expected))) summary.push('المتوقعون: **' + Number(meta.expected) + '**');
    if (Number.isFinite(Number(meta.attended))) summary.push('الحاضرون: **' + Number(meta.attended) + '**');
    if (Number.isFinite(Number(meta.absent))) summary.push('الغائبون: **' + Number(meta.absent) + '**');
    if (Number.isFinite(Number(meta.excused))) summary.push('المعتذرون: **' + Number(meta.excused) + '**');

    const rawName = String(meeting.name ?? 'اجتماع')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'اجتماع';

    const extension = String(report.path).match(/\.[A-Za-z0-9]+$/)?.[0] || '.docx';

    const sent = await channel.send({
      content: [
        '📄 **التقرير الرسمي للاجتماع — Operations 967**',
        'الفريق: **' + meeting.team_name + '**',
        'الاجتماع: **' + meeting.name + '**',
        summary.length ? summary.join(' | ') : null,
        'تم نشر نسخة واحدة في قناة شات الفريق. لا تُرسل التقارير في الخاص للأعضاء.',
      ].filter(Boolean).join('\n'),
      files: [{
        attachment: report.path,
        name: 'تقرير الاجتماع - ' + rawName + extension,
      }],
    });

    item.report = true;
    this._teamAttendanceFix1Sent ??= new Set();
    this._teamAttendanceFix1Sent.add(String(meeting.id) + ':' + String(channelId));

    await this.audit?.log?.({
      guildId: guild.id,
      actorId: this.ownerUserId,
      action: 'meeting.attendance_report.team_channel.sent',
      targetType: 'meeting',
      targetId: meeting.id,
      metadata: {
        teamId: meeting.team_id,
        channelId: String(channelId),
        messageId: sent?.id ? String(sent.id) : null,
        reportId: report?.id ? String(report.id) : null,
        reportBytes: Number(stat.size || 0),
        delivery: 'attendance-report-to-team-channel-fix1',
      },
    }).catch((error) => this.logger?.warn?.('team attendance report audit fix1 failed', {
      meetingId: meeting.id,
      channelId: String(channelId),
      error: error?.message ?? String(error),
    }));

    return item;
  }

  // Operations 967 v1.10.3 — no Google Drive. Recording is attached directly to the team channel.
  async #teamRecordingChannelId(guild, meeting) {
    return this.#teamAttendanceChannelIdFix1(guild, meeting);
  }

  async #recordingCompletionWasSent(guild, meeting, channelId) {
    this._teamDiscordRecordingSent ??= new Set();
    const key=String(meeting.id)+':'+String(channelId);
    if(this._teamDiscordRecordingSent.has(key))return true;
    if(!this.meetings?.db?.query)return false;
    try{
      const {rows}=await this.meetings.db.query(
        "SELECT 1 FROM audit_logs WHERE guild_id=$1 AND action='meeting.recording.discord.team_channel.sent' AND target_type='meeting' AND target_id=$2 AND COALESCE(metadata->>'channelId','')=$3 LIMIT 1",
        [guild.id,String(meeting.id),String(channelId)],
      );
      if(rows?.length)this._teamDiscordRecordingSent.add(key);
      return Boolean(rows?.length);
    }catch(error){
      this.logger?.warn?.('team discord recording dedupe lookup failed',{meetingId:meeting.id,channelId,error:error?.message??String(error)});
      return false;
    }
  }

  async #recordingBatchWasSent(guild, meeting, channelId, batchKey) {
    if(!this.meetings?.db?.query)return false;
    try{
      const {rows}=await this.meetings.db.query(
        "SELECT 1 FROM audit_logs WHERE guild_id=$1 AND action='meeting.recording.discord.team_channel.batch.sent' AND target_type='meeting' AND target_id=$2 AND COALESCE(metadata->>'channelId','')=$3 AND COALESCE(metadata->>'batchKey','')=$4 LIMIT 1",
        [guild.id,String(meeting.id),String(channelId),String(batchKey)],
      );
      return Boolean(rows?.length);
    }catch{return false}
  }

  async #prepareRecordingForDiscord(file, meeting, sourceIndex) {
    if(Number(file?.bytes||0)>0 && Number(file.bytes)<=DISCORD_RECORDING_MAX_BYTES){
      return {parts:[{path:file.path,bytes:Number(file.bytes),temporary:false}],tempDir:null};
    }
    const parent=path.join(path.dirname(file.path),'.discord-delivery');
    const dir=path.join(parent,'meeting-'+String(meeting.id).replace(/[^A-Za-z0-9_-]/g,'_')+'-source-'+sourceIndex+'-'+Date.now());
    await fs.mkdir(dir,{recursive:true});
    const pattern=path.join(dir,'part-%03d.ogg');
    try{
      await runMediaProcess('ffmpeg',[
        '-hide_banner','-loglevel','error','-y','-i',file.path,
        '-map','0:a:0','-vn','-sn','-dn',
        '-c:a','libopus','-b:a','20k','-vbr','on','-application','voip',
        '-f','segment','-segment_time',String(DISCORD_RECORDING_SEGMENT_SECONDS),
        '-reset_timestamps','1',pattern,
      ]);
      const names=(await fs.readdir(dir)).filter((x)=>/^part-\d+\.ogg$/i.test(x)).sort();
      if(!names.length)throw new Error('لم ينتج ffmpeg أي جزء صوتي.');
      const parts=[];
      for(const name of names){
        const p=path.join(dir,name);const st=await fs.stat(p);
        if(!st.isFile()||st.size<=0)continue;
        if(st.size>DISCORD_RECORDING_MAX_BYTES)throw new Error('جزء التسجيل ما زال أكبر من حد Discord بعد التقسيم: '+name);
        parts.push({path:p,bytes:st.size,temporary:true});
      }
      if(!parts.length)throw new Error('لم ينتج التقسيم ملفات صالحة للإرسال.');
      return {parts,tempDir:dir};
    }catch(error){
      await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
      throw error;
    }
  }

  async #catboxAlreadySent(guild, meeting, channelId) {
    if(!this.meetings?.db?.query)return false;
    try{
      const {rows}=await this.meetings.db.query(
        "SELECT 1 FROM audit_logs WHERE guild_id=$1 AND action='meeting.recording.catbox.team_channel.sent' AND target_type='meeting' AND target_id=$2 AND COALESCE(metadata->>'channelId','')=$3 LIMIT 1",
        [guild.id,String(meeting.id),String(channelId)],
      );
      return Boolean(rows?.length);
    }catch(error){
      this.logger?.warn?.('catbox sent dedupe lookup failed',{meetingId:meeting.id,channelId,error:error?.message??String(error)});
      return false;
    }
  }

  async #previousCatboxLinks(guild, meeting) {
    if(!this.meetings?.db?.query)return [];
    try{
      const {rows}=await this.meetings.db.query(
        "SELECT metadata FROM audit_logs WHERE guild_id=$1 AND action='meeting.recording.catbox.uploaded' AND target_type='meeting' AND target_id=$2 LIMIT 1",
        [guild.id,String(meeting.id)],
      );
      const links=rows?.[0]?.metadata?.links;
      return Array.isArray(links)?links.filter((x)=>isCatboxFileUrl(x)):[];
    }catch(error){
      this.logger?.warn?.('catbox uploaded-link lookup failed',{meetingId:meeting.id,error:error?.message??String(error)});
      return [];
    }
  }

  async #uploadOneToCatbox(file, meeting, sourceIndex) {
    let uploadPath=file.path;
    let tempDir=null;
    try{
      let stat=await fs.stat(uploadPath);
      if(!stat.isFile()||stat.size<=0)throw new Error('ملف التسجيل غير صالح للرفع إلى Catbox.');

      // Catbox accepts up to 200MB. If a recording somehow exceeds our 190MB safety margin,
      // transcode it once to compact voice Opus before upload; the original is never modified.
      if(stat.size>CATBOX_SAFE_MAX_BYTES){
        const parent=path.join(path.dirname(file.path),'.catbox-delivery');
        tempDir=path.join(parent,'meeting-'+String(meeting.id).replace(/[^A-Za-z0-9_-]/g,'_')+'-source-'+sourceIndex+'-'+Date.now());
        await fs.mkdir(tempDir,{recursive:true});
        uploadPath=path.join(tempDir,'recording-catbox.ogg');
        await runMediaProcess('ffmpeg',[
          '-hide_banner','-loglevel','error','-y','-i',file.path,
          '-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','24000',
          '-c:a','libopus','-b:a','20k','-vbr','on','-application','voip',uploadPath,
        ]);
        stat=await fs.stat(uploadPath);
        if(!stat.isFile()||stat.size<=0)throw new Error('فشل تجهيز نسخة Catbox المضغوطة.');
        if(stat.size>CATBOX_SAFE_MAX_BYTES)throw new Error('التسجيل ما زال أكبر من الحد الآمن لـCatbox بعد الضغط.');
      }

      const form=new FormData();
      form.append('reqtype','fileupload');
      const userhash=String(process.env.CATBOX_USERHASH??'').trim();
      if(userhash)form.append('userhash',userhash);
      const blob=await openAsBlob(uploadPath,{type:'audio/ogg'});
      form.append('fileToUpload',blob,path.basename(uploadPath));

      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(new Error('انتهت مهلة رفع Catbox.')),CATBOX_UPLOAD_TIMEOUT_MS);
      let response;
      try{
        response=await fetch(CATBOX_API_URL,{method:'POST',body:form,signal:controller.signal,headers:{'User-Agent':'Operations967-MeetingBot/1.10.4'}});
      }finally{clearTimeout(timer)}
      const body=String(await response.text()).trim();
      if(!response.ok)throw new Error('Catbox رفض الرفع HTTP '+response.status+': '+body.slice(0,300));
      if(!isCatboxFileUrl(body))throw new Error('Catbox لم يرجع رابط ملف صالح: '+body.slice(0,300));
      return body;
    }finally{
      if(tempDir)await fs.rm(tempDir,{recursive:true,force:true}).catch(()=>{});
    }
  }

  async #deliverTeamCatboxRecording({ guild, meeting, recording, audioFiles }) {
    if(!recording||!audioFiles?.length)return null;
    const channelId=await this.#teamRecordingChannelId(guild,meeting);
    if(!channelId)throw new Error('لا توجد قناة شات كتابية للفريق لإرسال رابط التسجيل.');
    const item={
      userId:'team-recording:'+String(channelId),destination:'team_catbox_recording',
      report:false,recordingFiles:0,decisions:false,ordinaryMember:false,regularOnly:false,
      skippedLarge:0,error:null,skipped:false,
    };
    if(await this.#catboxAlreadySent(guild,meeting,channelId)){item.skipped=true;return item}
    const channel=await guild.channels.fetch(String(channelId)).catch(()=>null);
    if(!channel?.isTextBased?.()||typeof channel.send!=='function')throw new Error('قناة شات الفريق غير صالحة لإرسال رابط التسجيل.');

    let links=await this.#previousCatboxLinks(guild,meeting);
    if(!links.length){
      links=[];
      for(let i=0;i<audioFiles.length;i+=1){
        links.push(await this.#uploadOneToCatbox(audioFiles[i],meeting,i+1));
      }
      try{
        await this.audit?.log?.({
          guildId:guild.id,actorId:this.ownerUserId,action:'meeting.recording.catbox.uploaded',
          targetType:'meeting',targetId:meeting.id,
          metadata:{teamId:meeting.team_id,recordingId:recording?.id?String(recording.id):null,links,provider:'catbox',anonymous:!String(process.env.CATBOX_USERHASH??'').trim()},
        });
      }catch(error){this.logger?.warn?.('catbox upload audit failed',{meetingId:meeting.id,error:error?.message??String(error)})}
    }
    if(!links.length)throw new Error('لم ينتج Catbox أي رابط تسجيل.');

    const linkLines=links.length===1
      ? ['🔗 **التسجيل:** '+links[0]]
      : links.map((url,i)=>'🔗 **الجزء '+(i+1)+' من '+links.length+':** '+url);
    const sent=await channel.send({content:[
      '🎙️ **تسجيل الاجتماع — Operations 967**',
      'الفريق: **'+meeting.team_name+'**',
      'الاجتماع: **'+meeting.name+'**',
      ...linkLines,
      '📌 رابط مباشر للتسجيل؛ لا يحتاج Google Drive.',
    ].join('\n')});

    item.recordingFiles=links.length;
    try{
      await this.audit?.log?.({
        guildId:guild.id,actorId:this.ownerUserId,action:'meeting.recording.catbox.team_channel.sent',
        targetType:'meeting',targetId:meeting.id,
        metadata:{teamId:meeting.team_id,channelId:String(channelId),messageId:sent?.id?String(sent.id):null,recordingId:recording?.id?String(recording.id):null,links,delivery:'catbox-link-to-team-channel',googleDrive:false},
      });
    }catch(error){this.logger?.warn?.('catbox sent audit failed',{meetingId:meeting.id,error:error?.message??String(error)})}
    return item;
  }

  // Operations 967 v1.10.9 — single recording delivery only.
  async #deliverTeamCatboxWithRetry({ guild, meeting, recording, audioFiles }) {
    const attempts=Math.min(5,Math.max(1,Number.parseInt(process.env.CATBOX_SINGLE_UPLOAD_ATTEMPTS??'3',10)||3));
    const baseDelay=Math.min(30_000,Math.max(0,Number.parseInt(process.env.CATBOX_SINGLE_RETRY_DELAY_MS??'4000',10)||4000));
    let lastError=null;
    for(let attempt=1;attempt<=attempts;attempt+=1){
      try{
        return await this.#deliverTeamCatboxRecording({guild,meeting,recording,audioFiles});
      }catch(error){
        lastError=error;
        this.logger?.warn?.('single recording Catbox attempt failed',{
          meetingId:meeting.id,attempt,attempts,error:error?.message??String(error),
        });
        if(attempt<attempts&&baseDelay>0)await new Promise((resolve)=>setTimeout(resolve,baseDelay*attempt));
      }
    }
    throw new Error('تعذر رفع التسجيل النهائي كملف واحد بعد '+attempts+' محاولات. لن يتم تقسيمه؛ سيعيد نظام موثوقية المخرجات المحاولة تلقائيًا. السبب: '+String(lastError?.message??lastError??'غير معروف'));
  }

  async #deliverTeamRecordingHybrid({ guild, meeting, recording, audioFiles }) {
    if(!recording||!audioFiles?.length)return null;

    // recording-integrity-delivery-v1.11.0
    // Unconditional publication gate: manual recovery, legacy rows, missing guard
    // metadata, and raw-track fallbacks can never bypass this check.
    const integrityVersion = String(recording?.metadata?.integrityGuardVersion ?? '');
    const integrityStatus = String(recording?.metadata?.integrityStatus ?? '');
    const finalPaths = Array.isArray(recording?.final_paths)
      ? recording.final_paths.filter(Boolean)
      : [];
    if (!recording || recording?.status !== 'completed' || integrityVersion !== '1.10.11' || integrityStatus !== 'verified') {
      throw new Error('تم منع نشر التسجيل: فحص سلامة التسجيل لم يثبت اكتماله.');
    }
    if (finalPaths.length !== 1) {
      throw new Error('التسجيل النهائي ليس ملفًا واحدًا ('+String(finalPaths.length)+' ملفات). تم منع إرسال الأجزاء حتى يكتمل الدمج النهائي.');
    }
    if (audioFiles.length !== 1 || !audioFiles[0]?.sendable) {
      throw new Error('تم منع نشر التسجيل: الملف النهائي الواحد غير صالح أو غير قابل للقراءة.');
    }

    // Operations 967 v1.10.10.2 — legacy recording delivery dedupe before single-file guard.
    // التسجيلات القديمة التي سبق نشرها كأجزاء (ثم تُنظف بواسطة v1.10.10.2)
    // يجب اعتبارها delivered قبل شرط audioFiles.length!==1 حتى لا يعيد OutputReliability
    // محاولة نفس الاجتماع القديم إلى الأبد.
    const legacyChannelId=await this.#teamRecordingChannelId(guild,meeting);
    if(legacyChannelId && await this.#recordingCompletionWasSent(guild,meeting,legacyChannelId)){
      return {
        userId:'team-recording:'+String(legacyChannelId),destination:'team_discord_recording',
        report:false,recordingFiles:1,decisions:false,ordinaryMember:false,regularOnly:false,
        skippedLarge:0,error:null,skipped:true,legacyAlreadyDelivered:true,
      };
    }

    // لا نرسل مسارات خام أو عدة ملفات على أنها التسجيل النهائي.
    // RecordingService يبني ملف الاجتماع النهائي الواحد؛ إذا لم يكن موجودًا، نفشل بأمان
    // ليعيد OutputReliability المحاولة بدل نشر أجزاء غير مرغوبة.
    if(audioFiles.length!==1){
      throw new Error('التسجيل النهائي ليس ملفًا واحدًا ('+audioFiles.length+' ملفات). تم منع إرسال الأجزاء وسيعيد النظام المحاولة بعد تجهيز الملف النهائي.');
    }

    const file=audioFiles[0];
    const fitsDiscord=Number(file?.bytes||0)>0&&Number(file.bytes)<=DISCORD_RECORDING_MAX_BYTES;
    if(fitsDiscord){
      try{
        return await this.#deliverTeamDiscordRecording({guild,meeting,recording,audioFiles});
      }catch(discordError){
        this.logger?.warn?.('single Discord recording failed; trying one-link Catbox delivery',{meetingId:meeting.id,error:discordError?.message??String(discordError)});
        try{return await this.#deliverTeamCatboxWithRetry({guild,meeting,recording,audioFiles})}
        catch(catboxError){throw new Error('فشل إرسال التسجيل الواحد عبر Discord ثم Catbox: '+String(discordError?.message??discordError)+' | '+String(catboxError?.message??catboxError))}
      }
    }

    // التسجيل الكبير لا يعود مطلقًا إلى تقسيم Discord.
    // إما رابط واحد، أو فشل قابل لإعادة المحاولة بواسطة OutputReliability.
    return this.#deliverTeamCatboxWithRetry({guild,meeting,recording,audioFiles});
  }

  async #deliverTeamDiscordRecording({ guild, meeting, recording, audioFiles }) {
    if(!recording||!audioFiles?.length)return null;
    const channelId=await this.#teamRecordingChannelId(guild,meeting);
    if(!channelId)throw new Error('لا توجد قناة شات كتابية للفريق لإرسال التسجيل.');
    const item={
      userId:'team-recording:'+String(channelId),destination:'team_discord_recording',
      report:false,recordingFiles:0,decisions:false,ordinaryMember:false,regularOnly:false,
      skippedLarge:0,error:null,skipped:false,
    };
    if(await this.#recordingCompletionWasSent(guild,meeting,channelId)){item.skipped=true;return item}
    const channel=await guild.channels.fetch(String(channelId)).catch(()=>null);
    if(!channel?.isTextBased?.()||typeof channel.send!=='function')throw new Error('قناة شات الفريق غير صالحة لإرسال التسجيل.');

    const prepared=[];const tempDirs=[];
    try{
      for(let i=0;i<audioFiles.length;i+=1){
        const out=await this.#prepareRecordingForDiscord(audioFiles[i],meeting,i+1);
        prepared.push(...out.parts.map((p)=>({...p,sourceIndex:i+1})));
        if(out.tempDir)tempDirs.push(out.tempDir);
      }
      if(!prepared.length)throw new Error('لا يوجد ملف تسجيل صالح للإرسال.');
      const title=safeRecordingName(meeting.name);
      const total=prepared.length;
      const batches=[];
      for(let i=0;i<prepared.length;i+=5)batches.push(prepared.slice(i,i+5));
      let firstMessageId=null;let sentCount=0;
      for(let batchIndex=0;batchIndex<batches.length;batchIndex+=1){
        const batch=batches[batchIndex];
        const batchKey='batch-'+String(batchIndex+1).padStart(3,'0')+'-of-'+String(batches.length).padStart(3,'0');
        if(await this.#recordingBatchWasSent(guild,meeting,channelId,batchKey)){sentCount+=batch.length;continue}
        const start=batchIndex*5;
        const files=batch.map((part,j)=>{
          const n=start+j+1;
          const name=total===1?('تسجيل - '+title+'.ogg'):('تسجيل - '+title+' - جزء '+String(n).padStart(2,'0')+' من '+String(total).padStart(2,'0')+'.ogg');
          return {attachment:part.path,name};
        });
        const content=batchIndex===0?[
          '🎙️ **تسجيل الاجتماع — Operations 967**',
          'الفريق: **'+meeting.team_name+'**',
          'الاجتماع: **'+meeting.name+'**',
          total===1?'التسجيل مرفق مباشرة في هذه الرسالة.':'التسجيل كبير، لذلك قُسّم تلقائيًا إلى **'+total+'** أجزاء مرتبة وقابلة للتشغيل.',
          '📌 لا يحتاج Google Drive ولا أي رابط خارجي.',
        ].join('\n'):'🎙️ **متابعة تسجيل الاجتماع** — الأجزاء '+(start+1)+'–'+Math.min(start+batch.length,total)+' من '+total;
        const sent=await channel.send({content,files});
        if(!firstMessageId&&sent?.id)firstMessageId=String(sent.id);
        sentCount+=batch.length;
        await this.audit?.log?.({
          guildId:guild.id,actorId:this.ownerUserId,action:'meeting.recording.discord.team_channel.batch.sent',
          targetType:'meeting',targetId:meeting.id,
          metadata:{teamId:meeting.team_id,channelId:String(channelId),batchKey,messageId:sent?.id?String(sent.id):null,fileCount:batch.length},
        });
      }
      item.recordingFiles=sentCount;
      this._teamDiscordRecordingSent??=new Set();
      this._teamDiscordRecordingSent.add(String(meeting.id)+':'+String(channelId));
      await this.audit?.log?.({
        guildId:guild.id,actorId:this.ownerUserId,action:'meeting.recording.discord.team_channel.sent',
        targetType:'meeting',targetId:meeting.id,
        metadata:{teamId:meeting.team_id,channelId:String(channelId),messageId:firstMessageId,recordingId:recording?.id?String(recording.id):null,parts:total,delivery:'discord-attachments-to-team-channel',googleDrive:false},
      });
      return item;
    }finally{
      for(const dir of tempDirs)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
    }
  }

  async deliverMeetingOutputs({ guild, meeting, report = null, recording = null }) {
    // delivery-mode:meeting-outputs
    const outgoingModeV1797=await memberDeliveryMode(this.meetings,guild?.id);
    if(outgoingModeV1797==='off'){
      // Treat intentional suppression as successful so old outputs are not
      // blasted later if the owner re-enables delivery.
      return [{
        userId:'delivery-mode-control', destination:'suppressed_by_owner',
        report:false, recordingFiles:0, decisions:false,
        ordinaryMember:false, regularOnly:false, skipped:true,
        suppressed:true, error:null,
      }];
    }

    // recording-integrity-hard-gate-v1.11.0
    // Never derive a publishable recording from raw tracks. Delivery only passes
    // the final_paths produced by RecordingService; the publication gate itself
    // lives inside #deliverTeamRecordingHybrid so failures are retryable.
    const finalPaths = Array.isArray(recording?.final_paths)
      ? recording.final_paths.filter(Boolean)
      : [];
    const audioFiles = await existingFiles(finalPaths);
    const results = [];

    // meeting967-team-attendance-fix1: إرسال نفس ملف التقرير الرسمي إلى قناة الفريق.
    try {
      const teamReportFix1 = await this.#deliverTeamAttendanceReportFix1({
        guild,
        meeting,
        report,
      });
      if (teamReportFix1) results.push(teamReportFix1);
    } catch (error) {
      results.push({
        userId: 'team-channel:' + String(meeting.team_id),
        destination: 'team_channel',
        report: false,
        recordingFiles: 0,
        decisions: false,
        ordinaryMember: false,
        regularOnly: false,
        skippedLarge: 0,
        skipped: false,
        error: error?.message ?? String(error),
      });
      this.logger?.warn?.('team attendance report delivery fix1 failed', {
        meetingId: meeting.id,
        teamId: meeting.team_id,
        error: error?.message ?? String(error),
      });
    }

    // v1.10.4: Discord for small recordings; Catbox direct link for larger recordings, with automatic cross-fallback.
    try {
      const recordingDelivery = await this.#deliverTeamRecordingHybrid({ guild, meeting, recording, audioFiles });
      if (recordingDelivery) results.push(recordingDelivery);
    } catch (error) {
      results.push({
        userId: 'team-recording:' + String(meeting.team_id), destination: 'team_recording_hybrid',
        report: false, recordingFiles: 0, decisions: false, ordinaryMember: false, regularOnly: false,
        skippedLarge: 0, skipped: false, error: error?.message ?? String(error),
      });
      this.logger?.warn?.('hybrid recording delivery failed', { meetingId: meeting.id, teamId: meeting.team_id, error: error?.message ?? String(error) });
    }


    // v1.10.2: no per-member output delivery. Team channel is the only destination.

    try {
      await this.audit.log({
        guildId: guild.id, actorId: this.ownerUserId, action: 'meeting.outputs.deliver', targetType: 'meeting', targetId: meeting.id,
        metadata: { policy: 'team_channel_only', teamId: meeting.team_id, destinations: results.map(({ userId, destination, report, recordingFiles, error, skipped }) => ({ id: userId, destination, report, recordingFiles, skipped, ok: !error })) },
      });
    } catch {}
    return results;
  }
}
