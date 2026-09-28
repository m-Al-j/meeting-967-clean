const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

export class OutputReliabilityService {
  constructor({meetings,guilds,reports,recordings,outputs,reportService,recordingService,deliveryService,audit,logger,ownerUserId}){
    Object.assign(this,{meetings,guilds,reports,recordings,outputs,reportService,recordingService,deliveryService,audit,logger,ownerUserId:String(ownerUserId)});
    this.guild=null;this.client=null;this.timer=null;this.running=false;
  }

  start(guild){
    this.guild=guild;this.client=guild.client;
    if(this.timer)return;
    this.timer=setInterval(()=>this.tick().catch(e=>this.logger.error('output-reliability-tick-failed',{error:e?.stack??String(e)})),30_000);
    this.timer.unref?.();
    this.tick().catch(e=>this.logger.error('output-reliability-initial-failed',{error:e?.stack??String(e)}));
  }
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}

  async tick({force=false}={}){
    if(this.running||!this.guild)return false;
    this.running=true;
    try{
      const settings=await this.guilds.getSettings(this.guild.id);
      if(!settings.recording_enabled||!settings.recording_auto_start){
        await this.guilds.updateSettings(this.guild.id,{recording_enabled:true,recording_auto_start:true});
        await this.audit.log({guildId:this.guild.id,actorId:this.ownerUserId,action:'outputs.automatic_recording_enforced',targetType:'settings',newValue:{recording_enabled:true,recording_auto_start:true}}).catch(()=>{});
      }
      await this.#recoverOngoing();
      const ended=await this.meetings.outputCandidates(this.guild.id,{hours:force?720:168,limit:force?50:15});
      for(const meeting of ended){await this.#processEnded(meeting,{force});await sleep(100);}
      return true;
    }finally{this.running=false;}
  }

  async #recoverOngoing(){
    const ongoing=await this.meetings.ongoingForGuild(this.guild.id);
    for(const meeting of ongoing){
      if(this.recordingService.active.has(meeting.id)){
        await this.outputs.patch(meeting.id,{recording_status:'recording',last_error:null}).catch(()=>{});
        continue;
      }
      const state=await this.outputs.ensure(meeting.id);
      const last=state.last_attempt_at?new Date(state.last_attempt_at).getTime():0;
      if(Date.now()-last<60_000)continue;
      await this.outputs.patch(meeting.id,{last_attempt_at:new Date(),attempts:Number(state.attempts||0)+1});
      try{
        await this.recordingService.requestRecovery({meeting,guild:this.guild,actorId:this.client.user.id,recovery:true,trigger:'output-reliability-recovery'});
        await this.outputs.patch(meeting.id,{recording_status:'recording',last_error:null,next_retry_at:null});
        await this.audit.log({guildId:this.guild.id,actorId:this.client.user.id,action:'outputs.recording.recovered',targetType:'meeting',targetId:meeting.id}).catch(()=>{});
      }catch(error){
        const msg=String(error?.message??error).slice(0,1500);
        await this.outputs.patch(meeting.id,{recording_status:'failed',last_error:msg,next_retry_at:new Date(Date.now()+60_000)}).catch(()=>{});
        this.logger.warn('automatic recording recovery failed',{meetingId:meeting.id,error:msg});
      }
    }
  }

  async #processEnded(meeting,{force=false}={}){
    let state=await this.outputs.ensure(meeting.id);
    if(!force&&state.next_retry_at&&new Date(state.next_retry_at).getTime()>Date.now())return;
    state=await this.outputs.patch(meeting.id,{attempts:Number(state.attempts||0)+1,last_attempt_at:new Date(),last_error:null});
    const errors=[];

    let report=await this.reports.latest(meeting.id).catch(()=>null);
    if(!report){
      try{report=await this.reportService.generate({guildId:this.guild.id,meetingId:meeting.id,actorId:this.client.user.id,guild:this.guild});}
      catch(error){errors.push(`report: ${error?.message??error}`);}
    }
    await this.outputs.patch(meeting.id,{report_status:report?'ready':'failed'}).catch(()=>{});

    // legacy-v192-stop-signature-compat: stopByMeeting(meeting.id,{meetingTitle:meeting.name,meetingEndedAt:meeting.ended_at})
    let recording=null;
    try{
      // stopByMeeting is idempotent and also reconciles tracks across recovery rows.
      recording=await this.recordingService.stopByMeeting(meeting.id,{meetingTitle:meeting.name,meetingStartedAt:meeting.started_at,meetingEndedAt:meeting.ended_at});
      if(!recording)recording=await this.recordings.latestForMeeting(meeting.id);
    }catch(error){errors.push(`recording: ${error?.message??error}`);}
    // recording-integrity-output-v1.10.11
    // recording-integrity-output-hard-gate-v1.11.0
    // OutputReliability must use the exact same publication contract as DeliveryService.
    // No legacy recording, raw track, or manual-recovery file can become "ready".
    let recordingStatus='missing';
    let integrityBlocked=false;
    const integrityVersion=String(recording?.metadata?.integrityGuardVersion??'');
    const integrityStatus=String(recording?.metadata?.integrityStatus??'');
    const finals=Array.isArray(recording?.final_paths)?recording.final_paths.filter(Boolean):[];
    if(
      recording?.status==='completed' &&
      integrityVersion==='1.10.11' &&
      integrityStatus==='verified' &&
      finals.length===1
    ){
      recordingStatus='ready';
    }else if(recording){
      recordingStatus='needs_recovery';
      integrityBlocked=true;
      const reasons=Array.isArray(recording?.metadata?.integrityReasons)
        ? recording.metadata.integrityReasons.join(', ')
        : String(recording?.metadata?.integrityFailureReason??'integrity-not-verified');
      errors.push('recording integrity: '+reasons);
    }

    await this.outputs.patch(meeting.id,{recording_status:recordingStatus}).catch(()=>{});

    let delivery=[];
    try{
      delivery=await this.deliveryService.deliverMeetingOutputs({
        guild:this.guild,
        meeting,
        report,
        recording:integrityBlocked ? null : recording
      });
    }catch(error){errors.push(`delivery: ${error?.message??error}`);}
    const failed=delivery.filter(x=>x.error).length;

    let deliveryStatus;

    if (integrityBlocked) {
      deliveryStatus = 'partial';
      errors.push('recording delivery blocked by integrity guard');
    } else {
      deliveryStatus =
        delivery.length && failed === 0
          ? 'sent'
          : delivery.length
            ? 'partial'
            : 'failed';
    }

    if(failed)errors.push(`delivery: ${failed}/${delivery.length} failed`);

    const complete =
      Boolean(report) &&
      recordingStatus === 'ready' &&
      deliveryStatus === 'sent';

    state=await this.outputs.patch(meeting.id,{
      delivery_status:deliveryStatus,
      last_error:errors.length?errors.join(' | ').slice(0,3000):null,
      next_retry_at:complete
        ? null
        : new Date(
            Date.now() +
            Math.min(
              30*60_000,
              Math.max(
                60_000,
                Number(state.attempts||1)*60_000,
              ),
            ),
          ),
      completed_at:complete?new Date():null,
    });

    if((recordingStatus==='missing'||recordingStatus==='failed'||recordingStatus==='needs_recovery'||errors.length)&&!state.owner_alerted_at){
      await this.#notifyOwner(`⚠️ **مراقبة مخرجات Meeting 967**\nالفريق: **${meeting.team_name}**\nالاجتماع: **${meeting.name}**\n📄 التقرير: ${report?'جاهز':'فشل'}\n🎙️ التسجيل: ${recordingStatus==='ready'?'جاهز':recordingStatus==='needs_recovery'?'يحتاج استرجاع — لم يتم نشره':recordingStatus==='missing'?'غير موجود':'فشل'}\n📨 التسليم: ${deliveryStatus}\n${errors.length?`\nالسبب: ${errors.join(' | ').slice(0,1200)}`:''}`);
      await this.outputs.patch(meeting.id,{owner_alerted_at:new Date()}).catch(()=>{});
    }
  }

  async #notifyOwner(text){
    const user=await this.client.users.fetch(this.ownerUserId).catch(()=>null);
    if(user)await user.send(text).catch(()=>{});
  }
}
