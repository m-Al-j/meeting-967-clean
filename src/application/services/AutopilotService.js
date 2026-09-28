// operations967-production-personal-dm-v1.10.7
// operations967-personal-meeting-notices-v2
import { memberDmDeliveryEnabled, teamChannelDeliveryEnabled, operationalDmDeliveryEnabled } from './memberDeliveryControl.js';
import { autopilotWindow, autoEndDecision } from '../../core/autopilot/policy.js';
import { pool as notificationDb } from '../../infrastructure/db/pool.js';

const unix=(d)=>Math.floor(new Date(d).getTime()/1000);
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

export class AutopilotService {
  constructor({ meetings, guilds, teams, tasks, automation, attendance, meetingService, recordingService, taskService=null, audit, logger, ownerUserId, permissionService }) {
    Object.assign(this,{meetings,guilds,teams,tasks,automation,attendance,meetingService,recordingService,taskService,audit,logger,ownerUserId,permissionService});
    this.timer=null;
    this.running=false;
    this.guild=null;
    this.client=null;
    // meeting967-personal-dm-reminders-v1.7.8
    this.notificationEventsDone=new Set();
    // meeting967-reminders-excuses-v1.7.7
  }

  start(guild) {
    this.guild=guild;
    this.client=guild.client;
    if(this.timer)return;
    this.timer=setInterval(()=>this.tick().catch((error)=>this.logger.error('autopilot-tick-failed',{error:error?.stack??String(error)})),15_000);
    this.timer.unref?.();
    this.tick().catch((error)=>this.logger.error('autopilot-initial-tick-failed',{error:error?.stack??String(error)}));
  }

  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}

  async tick(){
    if(this.running||!this.guild)return;
    this.running=true;
    try{
      const settings=await this.guilds.getSettings(this.guild.id);
      if(settings?.autopilot_enabled)await this.#meetings(settings);
      if(settings?.task_reminders_enabled)await this.#taskReminders();
    }finally{this.running=false;}
  }

  async #meetings(settings){
    const now=new Date();
    const upcoming=await this.meetings.autopilotCandidates(this.guild.id,{
      horizonMinutes:Math.max(60,settings.autopilot_readiness_minutes,settings.autopilot_reminder_minutes),
      graceMinutes:settings.autopilot_start_grace_minutes,
    });

    for(const meeting of upcoming){
      const state=await this.automation.ensure(meeting.id);
      const window=autopilotWindow({
        scheduledAt:meeting.scheduled_at,
        now,
        readinessMinutes:settings.autopilot_readiness_minutes,
        reminderMinutes:settings.autopilot_reminder_minutes,
        startGraceMinutes:settings.autopilot_start_grace_minutes,
      });

      if(window.dueReadiness&&!state.readiness_checked_at){
        const readiness=await this.meetingService.readiness({meeting,guild:this.guild,settings}).catch((error)=>({ok:false,issues:[error.message],memberCount:0}));
        await this.automation.patch(meeting.id,{
          readiness_checked_at:new Date(),
          readiness_ok:readiness.ok,
          readiness_issues:JSON.stringify(readiness.issues??[]),
        });
        if(!readiness.ok){
          await this.#notifyOwner(`⚠️ **فحص جاهزية Meeting 967**\nاجتماع **${meeting.name}** — ${meeting.team_name} غير جاهز:\n- ${(readiness.issues??[]).join('\n- ')}`);
        }
      }

      await this.#notificationCycle(meeting,settings,state);

      if(window.dueStart)await this.#autoStart(meeting,state);
    }

    const ongoing=await this.meetings.ongoingForGuild(this.guild.id);
    for(const meeting of ongoing)await this.#maintainOngoing(meeting,settings);
  }

  #notificationEventId(meetingId,key){
    return `${meetingId}:${key}`;
  }

  #friendlyName(member,user){
    const raw=String(member?.display_name??user?.globalName??user?.username??'صديقي').trim();
    const clean=raw.replace(/^@+/,'').replace(/\s+/g,' ');
    const first=clean.split(' ')[0];
    return first||'صديقي';
  }

  #dayGreeting(settings){
    try{
      const zone=settings?.timezone||'Asia/Riyadh';
      const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(new Date()));
      return Number.isFinite(hour)&&hour<12?'صباح الخير':'مساء الخير';
    }catch{
      return 'هلا';
    }
  }

  async #notificationMembers(meeting){
    const {rows:modeRows}=await notificationDb.query(
      `SELECT mode FROM meeting_reminder_recipient_settings WHERE meeting_id=$1`,
      [meeting.id],
    ).catch(()=>({rows:[]}));
    const mode=modeRows[0]?.mode??'team';

    if(mode==='custom'){
      const {rows}=await notificationDb.query(
        `SELECT rr.user_id,
                COALESCE(NULLIF(rr.display_name,''),u.display_name,u.username,rr.user_id::text) AS display_name
           FROM meeting_reminder_recipients rr
           LEFT JOIN users u ON u.id=rr.user_id
          WHERE rr.meeting_id=$1
          ORDER BY COALESCE(NULLIF(rr.display_name,''),u.display_name,u.username,rr.user_id::text)`,
        [meeting.id],
      );
      return rows;
    }

    const {rows}=await notificationDb.query(
      `SELECT s.user_id,s.display_name
         FROM meeting_member_snapshots s
        WHERE s.meeting_id=$1
        ORDER BY s.display_name`,
      [meeting.id],
    );
    if(rows.length)return rows;
    return this.teams.members(meeting.team_id);
  }

  async #notificationReceipts(meetingId,key){
    const {rows}=await notificationDb.query(
      `SELECT user_id,status FROM meeting_notification_receipts
        WHERE meeting_id=$1 AND event_key=$2`,
      [meetingId,key],
    );
    return new Map(rows.map(row=>[String(row.user_id),row.status]));
  }

  async #markNotificationReceipt(meetingId,userId,key,status,error=null){
    await notificationDb.query(
      `INSERT INTO meeting_notification_receipts(meeting_id,user_id,event_key,status,error,attempted_at,sent_at)
       VALUES($1,$2,$3,$4,$5,now(),CASE WHEN $4='sent' THEN now() ELSE NULL END)
       ON CONFLICT(meeting_id,user_id,event_key)
       DO UPDATE SET status=EXCLUDED.status,error=EXCLUDED.error,attempted_at=now(),
                     sent_at=CASE WHEN EXCLUDED.status='sent' THEN now() ELSE meeting_notification_receipts.sent_at END`,
      [meetingId,userId,key,status,error?String(error).slice(0,1000):null],
    );
  }

  async #eventAlreadyCompleted(meetingId,key){
    return this.notificationEventsDone.has(this.#notificationEventId(meetingId,key));
  }

  #markEventCompleted(meetingId,key){
    this.notificationEventsDone.add(this.#notificationEventId(meetingId,key));
  }

  #personalNoticeText({meeting,settings,key,name,remainingMinutes}){
    const team=meeting.team_name||'الفريق';
    const title=meeting.name||`اجتماع ${team}`;
    const channel=`<#${meeting.voice_channel_id}>`;
    const meetingAt=`<t:${unix(meeting.scheduled_at)}:F>`;
    const scheduledMs=new Date(meeting.scheduled_at).getTime();
    const cutoff=Math.max(0,Number(settings?.excuse_cutoff_minutes??30));
    const cutoffAt=Math.floor((scheduledMs-cutoff*60_000)/1000);
    const mins=Math.max(1,Math.ceil(remainingMinutes));


    if(key==='meeting-scheduled'){
      return `${this.#dayGreeting(settings)} يا **${name}** 👋

📅 **تم جدولة اجتماع جديد لك**

الفريق: **${team}**
الاجتماع: **${title}**
🕘 الموعد: ${meetingAt}
📍 قناة الاجتماع: ${channel}

تنبيهات هذا الاجتماع ستصلك هنا في الخاص بشكل منفصل، ولن تُنشر كتذكيرات جماعية في قناة الفريق.

إذا عندك ظرف، تقدر تقدم اعتذارك عن طريق البوت قبل إغلاق الاعتذارات.

⚠️ لا تبدأ الاجتماع يدويًا؛ البوت سيتولى البداية والتسجيل تلقائيًا في الوقت المحدد.`;
    }

    if(key==='meeting-60'){
      return `${this.#dayGreeting(settings)} يا **${name}**، عساك بخير ✨

⏰ **تذكير بسيط بموعد اجتماعك**

عندك **${title}** اليوم، وباقي تقريبًا **${mins} دقيقة** على البداية.

📍 القناة: ${channel}
🕘 الموعد: ${meetingAt}

إذا عندك ظرف وما بتقدر تحضر، قدامك وقت تقدم اعتذارك عن طريق **البوت** قبل <t:${cutoffAt}:t>.

⚠️ **ملاحظة مهمة:** لا تبدأ الاجتماع بنفسك ولا تطلب من أحد يبدأه؛ **البوت بيتولى بدء الاجتماع والتسجيل تلقائيًا في الوقت المحدد بالضبط.**

نشوفك على خير في الاجتماع 🤝`;
    }

    if(key==='excuse-warning-15'){
      return `يا **${name}**، تنبيه صغير قبل ما يفوت الوقت 👀

📨 **باقي 15 دقيقة على إغلاق الاعتذارات**

إذا عارف إنك ما بتقدر تحضر **${title}**، قدم اعتذارك الحين عن طريق **البوت**.

🔒 إغلاق الاعتذارات: <t:${cutoffAt}:t>
⏰ موعد الاجتماع: ${meetingAt}

بعد ما تقفل المهلة، ما عاد بيقبل البوت اعتذارات جديدة لهذا الاجتماع.`;
    }

    if(key==='excuse-closed'){
      return `يا **${name}**، للتنبيه فقط:

🔒 **انتهت مهلة الاعتذار عن ${title}.**

ما عاد يمكن تقديم اعتذار جديد لهذا الاجتماع.

⏰ الموعد: ${meetingAt}

جهز أمورك وخلك قريب من القناة الصوتية، ونشوفك في الموعد إن شاء الله.`;
    }

    if(key==='meeting-15'){
      return `قرب الموعد يا **${name}** 👀

⏰ **باقي 15 دقيقة على ${title}**

إذا أنت مشغول بشي، هذا الوقت المناسب تخلصه وتجهز نفسك للدخول.

📍 القناة: ${channel}
🕘 البداية: ${meetingAt}

ولا تشيل هم تشغيل الاجتماع؛ **لا تبدأه يدويًا**، البوت بيتولى البداية والتسجيل تلقائيًا وقت الموعد.`;
    }

    return `يا **${name}**، خلاص قربنا 😄

⏳ **باقي 5 دقائق فقط على ${title}**

جهز نفسك وخلك قريب من القناة الصوتية، والبوت بيتولى الباقي.

📍 القناة: ${channel}
🕘 البداية: ${meetingAt}

⚠️ **مهم:** لا تبدأ الاجتماع بنفسك حتى لو دخلت القناة بدري.
ادخل عادي وانتظر، والبوت بيبدأ الاجتماع والتسجيل تلقائيًا في الموعد المحدد بالضبط.

نشوفك بعد شوي 🤝`;
  }

  async #deliverPersonalMeetingNotice(meeting,settings,key,remainingMinutes){
    // delivery-mode:personal-notice
    if(!await operationalDmDeliveryEnabled(this.meetings,this.guild?.id))return;
    if(await this.#eventAlreadyCompleted(meeting.id,key))return;

    const members=await this.#notificationMembers(meeting);
    const receipts=await this.#notificationReceipts(meeting.id,key);
    const failures=[];

    for(const member of members){
      const userId=String(member.user_id);
      if(receipts.has(userId))continue;

      const user=await this.client.users.fetch(userId).catch(()=>null);
      if(!user||user.bot){
        await this.#markNotificationReceipt(meeting.id,userId,key,'failed',user?'BOT_ACCOUNT':'USER_FETCH_FAILED').catch(()=>{});
        if(!user)failures.push(`${member.display_name??userId} — تعذر جلب الحساب`);
        continue;
      }

      const name=this.#friendlyName(member,user);
      const text=this.#personalNoticeText({meeting,settings,key,name,remainingMinutes});
      try{
        await user.send(text);
        await this.#markNotificationReceipt(meeting.id,userId,key,'sent');
      }catch(error){
        const reason=String(error?.message??error).slice(0,300);
        await this.#markNotificationReceipt(meeting.id,userId,key,'failed',reason).catch(()=>{});
        failures.push(`${member.display_name??user.globalName??user.username??userId} — تعذر إرسال الخاص`);
      }
      await sleep(120);
    }

    this.#markEventCompleted(meeting.id,key);

    if(failures.length){
      const summary=failures.slice(0,20).map(x=>`• ${x}`).join('\n');
      await this.#notifyOwner(`⚠️ **تنبيهات اجتماع — تعذر إرسال بعض الرسائل الخاصة**
الفريق: **${meeting.team_name}**
الاجتماع: **${meeting.name}**
التنبيه: **${key}**
تعذر الإرسال إلى **${failures.length}** عضو/أعضاء:
${summary}${failures.length>20?`\n• ... و${failures.length-20} آخرين`:''}

باقي المستلمين استمر الإرسال لهم بشكل طبيعي.`);
    }
  }


  async notifyMeetingScheduled(meeting,settings=null){
    if(!meeting?.id)return false;
    if(!this.guild||!this.client)return false;
    const resolvedSettings=settings??await this.guilds.getSettings(this.guild.id);
    const remaining=(new Date(meeting.scheduled_at).getTime()-Date.now())/60_000;
    await this.#deliverPersonalMeetingNotice(
      meeting,resolvedSettings,'meeting-scheduled',
      Number.isFinite(remaining)?remaining:0,
    );
    return true;
  }

  async #notificationCycle(meeting,settings,state=null){
    // delivery-mode:notification-cycle
    if(!await operationalDmDeliveryEnabled(this.meetings,this.guild?.id))return;
    const scheduled=new Date(meeting.scheduled_at).getTime();
    const remaining=(scheduled-Date.now())/60_000;
    if(!Number.isFinite(remaining)||remaining<=0)return;

    const cutoff=Math.max(0,Number(settings?.excuse_cutoff_minutes??30));

    // Compatibility with the previous reminder system:
    // if the old 60-minute reminder was already sent, never send it again.
    if(remaining>45&&remaining<=60&&!state?.reminder_sent_at){
      await this.#deliverPersonalMeetingNotice(meeting,settings,'meeting-60',remaining);
      await this.automation.patch(meeting.id,{reminder_sent_at:new Date()}).catch(()=>{});
    }
    if(remaining>cutoff&&remaining<=cutoff+15){
      await this.#deliverPersonalMeetingNotice(meeting,settings,'excuse-warning-15',remaining);
    }
    if(remaining>15&&remaining<=cutoff){
      await this.#deliverPersonalMeetingNotice(meeting,settings,'excuse-closed',remaining);
    }
    if(remaining>5&&remaining<=15){
      await this.#deliverPersonalMeetingNotice(meeting,settings,'meeting-15',remaining);
    }
    if(remaining>0&&remaining<=5){
      await this.#deliverPersonalMeetingNotice(meeting,settings,'meeting-5',remaining);
    }
  }

  async #autoStart(meeting,state){
    const lastAttempt=state.start_attempted_at?new Date(state.start_attempted_at).getTime():0;
    if(Date.now()-lastAttempt<45_000)return;
    await this.automation.patch(meeting.id,{
      start_attempted_at:new Date(),
      start_attempts:Number(state.start_attempts||0)+1,
      start_error:null,
    });

    try{
      const started=await this.meetingService.start({
        guildId:this.guild.id,
        meetingId:meeting.id,
        actorId:this.client.user.id,
        guild:this.guild,
        startMode:'autopilot',
      });
      await this.automation.patch(meeting.id,{start_error:null});

      const team=await this.teams.get(meeting.team_id);
      const rec=started.recording_auto_status;
      const board=started.task_board_status;
      if(board?.attempted&&!board?.sent)await this.#notifyOwner(`⚠️ **تعذر نشر لوحة مهام الاجتماع**\n${meeting.team_name} — **${meeting.name}**\n${board.error??'سبب غير معروف'}`);
      const openTasks=await this.tasks.listOpenForTeam(meeting.team_id,{limit:8});
      const previousDecisions=await this.meetings.recentDecisionsForTeam(meeting.team_id,{excludeMeetingId:meeting.id,limit:5});
      const followTasks=openTasks.length
        ? `\n\n✅ **متابعة تكليفات مفتوحة:**\n${openTasks.map((t)=>`• ${t.title} — <@${t.assignee_user_id}>${t.due_at?` — <t:${unix(t.due_at)}:R>`:''}`).join('\n')}`
        : '';
      const followDecisions=previousDecisions.length
        ? `\n\n📌 **آخر قرارات الفريق:**\n${previousDecisions.map((d)=>`• ${d.decision_text}`).join('\n')}`
        : '';
      // v2: meeting start notifications are not posted to the team channel.
      await this.audit.log({guildId:this.guild.id,actorId:this.client.user.id,action:'autopilot.meeting.started',targetType:'meeting',targetId:meeting.id,newValue:{recordingStarted:Boolean(rec?.started)}});
    }catch(error){
      // إذا سبق المستخدم Autopilot وبدأ الاجتماع يدويًا في نفس اللحظة، فهذا نجاح وليس فشلًا.
      const latest=await this.meetings.get(meeting.id).catch(()=>null);
      if(latest?.status==='ongoing'){
        await this.automation.patch(meeting.id,{start_error:null});
        return;
      }
      await this.automation.patch(meeting.id,{start_error:String(error?.message??error).slice(0,1000)});
      await this.audit.log({guildId:this.guild.id,actorId:this.client.user.id,action:'autopilot.meeting.start_failed',targetType:'meeting',targetId:meeting.id,metadata:{error:error?.message??String(error)}}).catch(()=>{});
      if(!state.start_error){
        await this.#notifyOwner(`⚠️ **Autopilot لم يستطع بدء اجتماع**\n${meeting.team_name} — **${meeting.name}**\n${error?.userMessage??error?.message??error}\nسيعيد المحاولة تلقائيًا خلال مهلة البدء.`);
      }
    }
  }

  async #maintainOngoing(meeting,settings){
    let state=await this.automation.ensure(meeting.id);

    // Recovery: إذا عاد البوت بعد انقطاع/إعادة تشغيل، يعيد إنشاء جلسة تسجيل جديدة
    // ويعلّم أي Recording قديم كان عالقًا كـ failed بدل تركه "recording" للأبد.
    if(!this.recordingService.active.has(meeting.id)){
      const lastRecovery=state.last_recovery_at?new Date(state.last_recovery_at).getTime():0;
      if(Date.now()-lastRecovery>60_000){
        await this.automation.patch(meeting.id,{last_recovery_at:new Date()});
        try{
          await this.recordingService.requestRecovery({meeting,guild:this.guild,actorId:this.client.user.id,recovery:true,trigger:'autopilot-recovery'});
          await this.audit.log({guildId:this.guild.id,actorId:this.client.user.id,action:'autopilot.recording.recovered',targetType:'meeting',targetId:meeting.id});
        }catch(error){
          this.logger.warn('autopilot recording recovery failed',{meetingId:meeting.id,error:error?.message??String(error)});
        }
      }
    }

    const channel=await this.guild.channels.fetch(String(meeting.voice_channel_id)).catch(()=>null);
    if(!channel?.isVoiceBased())return;
    const humans=[...channel.members.values()].filter((member)=>!member.user?.bot);

    let hadHuman=Boolean(state.had_human);
    if(!hadHuman&&humans.length===0&&this.attendance?.rows){
      const rows=await this.attendance.rows(meeting.id).catch(()=>[]);
      hadHuman=rows.some((row)=>Boolean(row.first_join_at));
      if(hadHuman)state=await this.automation.patch(meeting.id,{had_human:true});
    }

    const decision=autoEndDecision({
      startedAt:meeting.started_at,
      now:new Date(),
      humanCount:humans.length,
      hadHuman,
      emptySince:state.empty_since,
      emptyEndMinutes:settings.autopilot_empty_end_minutes,
      noShowEndMinutes:settings.autopilot_no_show_end_minutes,
    });

    const statePatch={};
    if(decision.nextHadHuman!==Boolean(state.had_human))statePatch.had_human=decision.nextHadHuman;
    const oldEmpty=state.empty_since?new Date(state.empty_since).getTime():null;
    const nextEmpty=decision.nextEmptySince?new Date(decision.nextEmptySince).getTime():null;
    if(oldEmpty!==nextEmpty)statePatch.empty_since=decision.nextEmptySince;
    if(Object.keys(statePatch).length)state=await this.automation.patch(meeting.id,statePatch);

    if(decision.shouldEnd&&!state.ended_automatically_at){
      const reason=decision.reason==='no_show'?'لم يدخل أي عضو خلال مهلة الانتظار':'غادر جميع الأعضاء وانتهت مهلة الخلو';
      let output;
      try{
        output=await this.meetingService.end({
          guildId:this.guild.id,
          meetingId:meeting.id,
          actorId:this.client.user.id,
          guild:this.guild,
          endReason:`إنهاء تلقائي: ${reason}`,
        });
      }catch(error){
        const latest=await this.meetings.get(meeting.id).catch(()=>null);
        if(latest?.status==='ended'){
          await this.automation.patch(meeting.id,{ended_automatically_at:new Date(),empty_since:null});
          return;
        }
        throw error;
      }
      await this.automation.patch(meeting.id,{ended_automatically_at:new Date(),empty_since:null});
      const team=await this.teams.get(meeting.team_id);
      // v2: meeting end announcement is not posted to the team channel.
    }
  }

  async #taskReminders(){
    // delivery-mode:task-reminders
    // تحديث بطاقات التكليف الجماعي مستقل عن نجاح الخاص؛ بهذا تظهر حالة
    // "متأخر" في دردشة الاجتماع وقناة الفريق عند حلول الموعد النهائي.
    const dmDelivery=await operationalDmDeliveryEnabled(this.meetings,this.guild?.id);
    const dueTasks=await this.tasks.dueForReminder(this.guild.id,new Date());
    const refreshGroups=new Set();
    const refreshMeetings=new Set();
    for(const task of dueTasks){
      const overdue=new Date(task.due_at).getTime()<Date.now();
      const key=overdue?'overdue':'due_24h';
      if(task.assignment_group_id&&overdue){
        refreshGroups.add(String(task.assignment_group_id));
        if(task.meeting_id)refreshMeetings.add(String(task.meeting_id));
      }
      if(await this.tasks.reminderSent(task.id,key))continue;

      const dmAllowed=dmDelivery;
      let delivered=false;
      if(dmAllowed){
        const user=await this.client.users.fetch(String(task.assignee_user_id)).catch(()=>null);
        if(user){
          const text=overdue
            ? `⚠️ **تكليف متأخر — Meeting 967**\n${task.title}\nكان الموعد: <t:${unix(task.due_at)}:F>\nافتح /panel ← تكليفاتي وحدّث الحالة.`
            : `⏳ **تذكير بتكليف — Meeting 967**\n${task.title}\nالموعد النهائي: <t:${unix(task.due_at)}:F> (<t:${unix(task.due_at)}:R>)`;
          delivered=await user.send(text).then(()=>true).catch(()=>false);
        }
      }
      // نسجل المحاولة حتى لا نحاول فتح DM غير مسموح به كل 15 ثانية.
      await this.tasks.markReminder(task.id,key);
      if(dmAllowed&&!delivered)this.logger.warn('task reminder dm failed',{taskId:task.id,userId:String(task.assignee_user_id)});
    }
    if(this.taskService){
      for(const groupId of refreshGroups)await this.taskService.syncAssignmentGroup(groupId,this.guild).catch(()=>{});
      for(const meetingId of refreshMeetings)await this.taskService.refreshMeetingBoard(meetingId,this.guild).catch(()=>{});
    }
  }

  async #teamChannel(team,text){
    // delivery-mode:team-channel
    if(!await teamChannelDeliveryEnabled(this.meetings,this.guild?.id))return false;
    if(!team?.notification_channel_id)return false;
    const channel=await this.guild.channels.fetch(String(team.notification_channel_id)).catch(()=>null);
    if(!channel?.isTextBased())return false;
    return channel.send({content:text}).then(()=>true).catch(()=>false);
  }

  async #notifyOwner(text){
    const user=await this.client.users.fetch(String(this.ownerUserId)).catch(()=>null);
    if(user)await user.send(text).catch(()=>{});
  }
}
