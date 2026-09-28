import { z } from 'zod';
import { withTransaction } from '../../infrastructure/db/pool.js';
import { assertMeetingTransition } from '../../core/meetings/state.js';
import { AppError } from '../../core/errors/AppError.js';

export class MeetingService{
  constructor({meetings,teams,guilds,audit,attendance,reportService=null,recordingService=null,deliveryService=null,taskService=null}){
    Object.assign(this,{meetings,teams,guilds,audit,attendance,reportService,recordingService,deliveryService,taskService});
  }
  async create(input){
    input.name=z.string().trim().min(2).max(120).parse(input.name);
    input.description=z.string().max(1500).parse(input.description??'');
    if(new Date(input.scheduledAt).getTime()<Date.now()-5*60_000)throw new AppError('PAST_MEETING','لا يمكن إنشاء اجتماع بموعد قديم.');
    return withTransaction(async c=>{
      const team=await this.teams.get(input.teamId);
      if(!team||String(team.guild_id)!==String(input.guildId))throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');
      const m=await this.meetings.create(input,c);
      await this.audit.log({guildId:input.guildId,actorId:input.actorId,action:'meeting.create',targetType:'meeting',targetId:m.id,newValue:m},c);
      return m;
    });
  }
  async readiness({meeting,guild,settings}){
    const issues=[];
    const voice=guild.channels.cache.get(String(meeting.voice_channel_id))??await guild.channels.fetch(String(meeting.voice_channel_id)).catch(()=>null);
    if(!voice||!voice.isVoiceBased())issues.push('القناة الصوتية غير موجودة أو ليست صوتية.');
    else{
      const me=guild.members.me;const perms=voice.permissionsFor(me);
      if(!perms?.has('ViewChannel'))issues.push('البوت لا يملك View Channel.');
      if(!perms?.has('Connect'))issues.push('البوت لا يملك Connect.');
    }
    const sameChannel=await this.meetings.ongoingByChannel?.(guild.id,meeting.voice_channel_id,meeting.id);
    if(sameChannel)issues.push(`هناك اجتماع جاري آخر يستخدم نفس القناة الصوتية: ${sameChannel.name}.`);
    const members=await this.teams.members(meeting.team_id);
    if(!members.length)issues.push('الفريق لا يحتوي أعضاء مرتبطين.');
    if(voice){const perms=voice.permissionsFor(guild.members.me);if(!perms?.has('Connect'))issues.push('التسجيل التلقائي إلزامي لكن البوت لا يستطيع دخول القناة.');}
    return {ok:issues.length===0,issues,memberCount:members.length,voiceChannel:voice};
  }
  async start({guildId,meetingId,actorId,guild,startMode='manual'}){
    const meeting=await this.meetings.get(meetingId);if(!meeting)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');
    assertMeetingTransition(meeting.status,'ongoing');
    const settings=await this.guilds.getSettings(guildId);
    const ready=await this.readiness({meeting,guild,settings});if(!ready.ok)throw new AppError('NOT_READY','الاجتماع غير جاهز للبدء.',ready.issues);
    // recording-integrity-meeting-start-v1.10.11
    // Recorder-first start: the official meeting timeline is not opened until a
    // Voice recorder has reached Ready and its Recording Session exists.
    let recordingAuto={attempted:false,started:false,error:null};
    let preRecording=null;
    if(this.recordingService){
      recordingAuto.attempted=true;
      try{
        preRecording=await this.recordingService.start({meeting,guild,actorId,recovery:startMode==='recovery'});
        recordingAuto.started=true;
      }catch(e){
        recordingAuto.error=e?.message??String(e);
        await this.audit.log({guildId,actorId,action:'recording.auto_start_failed',targetType:'meeting',targetId:meeting.id,metadata:{error:recordingAuto.error,code:e?.code??null,startMode,meetingBlocked:true}}).catch(()=>{});
        throw new AppError('RECORDING_NOT_READY','تعذر بدء التسجيل الصوتي؛ لم يبدأ الاجتماع حتى لا يتم فقد جزء من التسجيل.',[recordingAuto.error]);
      }
    }

    let started;
    try{
      // DB recording.started_at is created only after VoiceConnectionStatus.Ready.
      // Use it as the official meeting start so there is no hidden leading gap.
      const officialStartedAt=preRecording?.started_at?new Date(preRecording.started_at):new Date();
      started=await withTransaction(async c=>{
        const current=await this.meetings.lock(meeting.id,c);if(!current)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');assertMeetingTransition(current.status,'ongoing');
        await this.meetings.snapshotMembers(current.id,current.team_id,c);
        const row=await this.meetings.update(current.id,{status:'ongoing',started_at:officialStartedAt,start_mode:startMode},actorId,c);
        await this.audit.log({guildId,actorId,action:'meeting.start',targetType:'meeting',targetId:row.id,oldValue:{status:current.status},newValue:{status:'ongoing',startMode,recorderFirst:Boolean(preRecording)}},c);
        return {...row,team_name:current.team_name};
      });
    }catch(error){
      if(preRecording&&this.recordingService?.abortUncommittedStart){
        await this.recordingService.abortUncommittedStart(meeting.id,'meeting-start-transaction-failed').catch(()=>{});
      }
      throw error;
    }

    // Preserve the Live Task Leader board introduced in v1.9.6.x.
    // This block runs only after the recorder-first meeting transaction succeeds.
    const taskBoard={attempted:Boolean(this.taskService),sent:false,error:null};
    if(this.taskService){
      try{const message=await this.taskService.ensureMeetingBoard({meeting:started,guild});taskBoard.sent=Boolean(message);if(!message)taskBoard.error='تعذر إرسال لوحة المهام إلى دردشة القناة الصوتية.';}
      catch(e){taskBoard.error=e?.message??String(e);await this.audit.log({guildId,actorId,action:'meeting.task_board_start_failed',targetType:'meeting',targetId:started.id,metadata:{error:taskBoard.error}}).catch(()=>{});}
    }
        return {...started,recording_auto_status:recordingAuto,task_board_status:taskBoard};
  }
  async end({guildId,meetingId,actorId,guild,endReason=null}){
    const meeting=await this.meetings.get(meetingId);if(!meeting)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');
    assertMeetingTransition(meeting.status,'ended');
    const settings=await this.guilds.getSettings(guildId);const endedAt=new Date();
    const ended=await withTransaction(async c=>{
      const current=await this.meetings.lock(meeting.id,c);if(!current)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');assertMeetingTransition(current.status,'ended');
      await this.attendance.finalize(current,settings,endedAt,c);
      const m=await this.meetings.update(current.id,{status:'ended',ended_at:endedAt,end_reason:endReason},actorId,c);
      await this.audit.log({guildId,actorId,action:'meeting.end',targetType:'meeting',targetId:m.id,oldValue:{status:current.status},newValue:{status:'ended',endReason}},c);
      return {...m,team_name:current.team_name};
    });
    if(this.taskService)await this.taskService.finalizeMeetingBoard(meeting.id,guild).catch(()=>{});
    // recording-integrity-meeting-end-v1.10.11
    let recording=null;if(this.recordingService)recording=await this.recordingService.stopByMeeting(meeting.id,{meetingTitle:ended.name,meetingStartedAt:ended.started_at,meetingEndedAt:ended.ended_at}).catch(async e=>{await this.audit.log({guildId,actorId,action:'recording.stop_failed',targetType:'meeting',targetId:meeting.id,metadata:{error:e.message}}).catch(()=>{});return null;});
    let report=null;if(this.reportService)report=await this.reportService.generate({guildId,meetingId,actorId,guild}).catch(async e=>{await this.audit.log({guildId,actorId,action:'report.auto_generate_failed',targetType:'meeting',targetId:meeting.id,metadata:{error:e.message}}).catch(()=>{});return null;});
    let delivery=[];if(this.deliveryService)delivery=await this.deliveryService.deliverMeetingOutputs({guild,meeting:ended,report,recording}).catch(async e=>{await this.audit.log({guildId,actorId,action:'delivery.auto_failed',targetType:'meeting',targetId:meeting.id,metadata:{error:e.message}}).catch(()=>{});return [];});
    return {meeting:ended,report,recording,delivery};
  }
  async cancel({guildId,meetingId,actorId,reason}){const meeting=await this.meetings.get(meetingId);assertMeetingTransition(meeting.status,'canceled');return withTransaction(async c=>{const m=await this.meetings.update(meetingId,{status:'canceled',canceled_at:new Date(),cancel_reason:reason},actorId,c);await this.audit.log({guildId,actorId,action:'meeting.cancel',targetType:'meeting',targetId:meetingId,oldValue:{status:meeting.status},newValue:{status:'canceled',reason}},c);return m;});}
  async postpone({guildId,meetingId,actorId,newScheduledAt,note}){const meeting=await this.meetings.get(meetingId);if(!['upcoming','postponed'].includes(meeting.status))throw new AppError('INVALID_STATE','لا يمكن تأجيل هذا الاجتماع الآن.');return withTransaction(async c=>{const m=await this.meetings.update(meetingId,{status:'postponed',scheduled_at:newScheduledAt,postponed_at:new Date(),postpone_note:note},actorId,c);await this.audit.log({guildId,actorId,action:'meeting.postpone',targetType:'meeting',targetId:meetingId,oldValue:{scheduled_at:meeting.scheduled_at,status:meeting.status},newValue:{scheduled_at:newScheduledAt,status:'postponed',note}},c);return m;});}
  async resumePostponed({guildId,meetingId,actorId}){const meeting=await this.meetings.get(meetingId);assertMeetingTransition(meeting.status,'upcoming');return this.meetings.update(meetingId,{status:'upcoming'},actorId);}
}
