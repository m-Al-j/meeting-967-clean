import { memberDmDeliveryEnabled, teamChannelDeliveryEnabled, operationalDmDeliveryEnabled } from './memberDeliveryControl.js';
import {z} from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import {withTransaction} from '../../infrastructure/db/pool.js';
import {AppError} from '../../core/errors/AppError.js';
import {assertTaskStatus,canAssigneeTransition,taskDisplayStatus} from '../../core/tasks/state.js';
// Operations 967 v1.10.12 — post-meeting task assignment.

const MAX_FILE_BYTES=15*1024*1024;
const safeName=(name='file')=>String(name).replace(/[^\p{L}\p{N}._ -]+/gu,'_').slice(0,120)||'file';
const isBlockedName=(name)=>/\.(exe|apk|bat|cmd|sh|ps1|msi|com|scr|jar)$/i.test(String(name));
const unix=(value)=>Math.floor(new Date(value).getTime()/1000);
const unique=(values)=>[...new Set((values??[]).map(String).filter(Boolean))];
const canSend=(channel)=>Boolean(channel&&typeof channel.send==='function');

const STATUS_LABELS={
  pending:'لم يبدأ',in_progress:'قيد التنفيذ',done:'مكتمل ومعتمد',cancelled:'ملغي',overdue:'متأخر',
  submitted:'بانتظار المراجعة',rejected:'أعيد للتعديل',
};
const STATUS_ICONS={pending:'⚪',in_progress:'🔵',done:'✅',cancelled:'⛔',overdue:'🔴',submitted:'🟡',rejected:'↩️'};

function progress(tasks){
  const counts={pending:0,in_progress:0,done:0,cancelled:0,overdue:0,submitted:0,rejected:0};
  for(const task of tasks){const status=taskDisplayStatus(task);counts[status]=(counts[status]??0)+1;}
  return {counts,total:tasks.length,done:counts.done};
}

function groupDescription(group,tasks){
  const p=progress(tasks);
  const lines=tasks.slice(0,40).map((task)=>{
    const status=taskDisplayStatus(task);
    return `${STATUS_ICONS[status]??'•'} <@${task.assignee_user_id}> — **${STATUS_LABELS[status]??status}**`;
  });
  if(tasks.length>40)lines.push(`… و${tasks.length-40} مكلّف/مكلّفين إضافيين.`);
  const mode=group.assignment_mode==='team'?'الفريق كامل':group.assignment_mode==='members'?'عدة أعضاء':'عضو واحد';
  const due=group.due_at?`<t:${unix(group.due_at)}:F> • <t:${unix(group.due_at)}:R>`:'غير محدد';
  return [
    `**الفريق المكلّف:** ${group.target_team_name}`,
    `**نوع الإسناد:** ${mode}`,
    `**الموعد النهائي:** ${due}`,
    `**التقدم:** ${p.done}/${p.total} مكتمل`,
    group.description?`\n**التعليمات:**\n${String(group.description).slice(0,1200)}`:'',
    `\n**حالة المكلّفين:**\n${lines.join('\n')||'لا يوجد مكلّفون.'}`,
  ].filter(Boolean).join('\n').slice(0,4000);
}

export class TaskService{
  constructor({tasks,teams,meetings,guilds,audit,logger,permissionService}){Object.assign(this,{tasks,teams,meetings,guilds,audit,logger,permissionService});}

  async create({guildId,teamId,meetingId=null,title,description='',assigneeUserId,dueAt=null,actorId,guild=null}){
    title=z.string().trim().min(2).max(180).parse(title);description=z.string().max(1800).parse(description??'');
    const team=await this.teams.get(teamId);if(!team||String(team.guild_id)!==String(guildId))throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');
    if(meetingId){const m=await this.meetings.get(meetingId);if(!m||String(m.team_id)!==String(teamId))throw new AppError('MEETING_SCOPE','الاجتماع لا يتبع هذا الفريق.');}
    const members=await this.teams.members(teamId);if(!members.some(x=>String(x.user_id)===String(assigneeUserId)))throw new AppError('ASSIGNEE_TEAM','المكلّف يجب أن يكون عضوًا في الفريق المحدد.');
    const task=await withTransaction(async c=>{const row=await this.tasks.create({guildId,teamId,meetingId,title,description,assigneeUserId,dueAt,actorId},c);await this.tasks.addHistory({taskId:row.id,actorUserId:actorId,eventType:'created',toStatus:row.status,metadata:{title:row.title}},c);await this.audit.log({guildId,actorId,action:'task.created',targetType:'task',targetId:row.id,newValue:row},c);return row;});
    if(guild)await this.notifyCreated(task,guild).catch(error=>this.logger?.warn?.('task-create-dm-failed',{taskId:task.id,error:error?.message??String(error)}));return task;
  }

  async createAssignmentGroup({guildId,meetingId,targetTeamId,assignmentMode,assigneeUserIds=[],title,description='',dueAt=null,actorId,guild}){
    if(!['member','members','team'].includes(String(assignmentMode)))throw new AppError('TASK_ASSIGNMENT_MODE','نوع إسناد المهمة غير صالح.');
    title=z.string().trim().min(2).max(180).parse(title);
    description=z.string().trim().max(1800).parse(description??'');
    const meeting=await this.meetings.get(meetingId);if(!meeting||String(meeting.guild_id)!==String(guildId))throw new AppError('NOT_FOUND','الاجتماع غير موجود.');
    if(!['ongoing','ended'].includes(meeting.status))throw new AppError('MEETING_TASK_WINDOW','يمكن إنشاء التكليف من اجتماع جارٍ أو مكتمل فقط.');
    const targetTeam=await this.teams.get(targetTeamId);if(!targetTeam||String(targetTeam.guild_id)!==String(guildId)||targetTeam.deleted_at)throw new AppError('TEAM_NOT_FOUND','الفريق المكلّف غير موجود.');
    const members=await this.teams.members(targetTeamId);const memberIds=new Set(members.map(x=>String(x.user_id)));
    let ids=assignmentMode==='team'?[...memberIds]:unique(assigneeUserIds);
    if(assignmentMode==='member'&&ids.length!==1)throw new AppError('TASK_ASSIGNEE_COUNT','اختر عضوًا واحدًا لهذا النوع من التكليف.');
    if(assignmentMode==='members'&&(ids.length<1||ids.length>25))throw new AppError('TASK_ASSIGNEE_COUNT','اختر من عضو واحد إلى 25 عضوًا، أو استخدم خيار الفريق كاملًا.');
    if(!ids.length)throw new AppError('NO_MEMBERS','لا يوجد أعضاء لإسناد هذه المهمة.');
    const invalid=ids.filter(id=>!memberIds.has(id));if(invalid.length)throw new AppError('ASSIGNEE_TEAM','كل الأشخاص المحددين يجب أن يكونوا أعضاء نشطين في الفريق المختار.');

    const result=await withTransaction(async c=>{
      const group=await this.tasks.createGroup({guildId,meetingId,originTeamId:meeting.team_id,targetTeamId,assignmentMode,title,description,dueAt,actorId,voiceChannelId:meeting.voice_channel_id},c);
      const created=[];
      for(const assigneeUserId of ids){
        const row=await this.tasks.create({guildId,teamId:targetTeamId,meetingId,title,description,assigneeUserId,dueAt,actorId,assignmentGroupId:group.id},c);
        await this.tasks.addHistory({taskId:row.id,actorUserId:actorId,eventType:'created',toStatus:row.status,metadata:{title:row.title,assignmentGroupId:group.id,assignmentMode}},c);
        created.push(row);
      }
      await this.audit.log({guildId,actorId,action:'meeting.task_group.created',targetType:'task_assignment_group',targetId:group.id,newValue:{meetingId,targetTeamId,assignmentMode,assignees:ids,title,dueAt}},c);
      return {group,tasks:created};
    });

    if(guild){
      await this.syncAssignmentGroup(result.group.id,guild,{announce:true}).catch(error=>this.logger?.warn?.('task-group-publish-failed',{groupId:result.group.id,error:error?.message??String(error)}));
      await this.notifyGroupAssignees(result.group.id,guild).catch(error=>this.logger?.warn?.('task-group-dm-failed',{groupId:result.group.id,error:error?.message??String(error)}));
      await this.refreshMeetingBoard(meetingId,guild).catch(()=>{});
    }
    return {...result,group:await this.tasks.getGroup(result.group.id)};
  }

  async notifyCreated(task,guild){
    if(!await operationalDmDeliveryEnabled(this.tasks,guild?.id))return false;
    const user=await guild.client.users.fetch(String(task.assignee_user_id));const due=task.due_at?`\nالموعد النهائي: <t:${unix(task.due_at)}:F>`:'';
    await user.send(`📌 **تكليف جديد — Meeting 967**\n${task.title}${due}\nافتح /panel ← تكليفاتي لمتابعته وتسليمه للمراجعة.`);return true;
  }

  async notifyGroupAssignees(groupId,guild){
    if(!await operationalDmDeliveryEnabled(this.tasks,guild?.id))return false;
    const group=await this.tasks.getGroup(groupId);if(!group)return false;
    const rows=await this.tasks.listGroupTasks(groupId);
    const due=group.due_at?`\n⏳ الموعد النهائي: <t:${unix(group.due_at)}:F> (<t:${unix(group.due_at)}:R>)`:'';
    const details=group.description?`\n\n**التعليمات:**\n${String(group.description).slice(0,1000)}`:'';
    for(const task of rows){
      const user=await guild.client.users.fetch(String(task.assignee_user_id)).catch(()=>null);if(!user)continue;
      await user.send(`📌 **تكليف من اجتماع — Meeting 967**\n**${group.title}**\nالفريق: **${group.target_team_name}**${due}${details}\n\nافتح /panel ← **تكليفاتي**، وعند الإنجاز سلّم المهمة للمراجعة.`).catch(()=>{});
    }
    return true;
  }

  async #messageChannel(guild,channelId){
    if(!channelId)return null;
    return guild.channels.cache.get(String(channelId))??await guild.channels.fetch(String(channelId)).catch(()=>null);
  }

  #groupPayload(group,tasks){
    return {embeds:[{title:`📌 ${group.title}`,description:groupDescription(group,tasks),color:0xC59A45,timestamp:new Date().toISOString()}],allowedMentions:{parse:[]}};
  }

  async syncAssignmentGroup(groupId,guild,{announce=false}={}){
    const group=await this.tasks.getGroup(groupId);if(!group)return null;
    const rows=await this.tasks.listGroupTasks(groupId);const payload=this.#groupPayload(group,rows);const patch={};

    const voice=await this.#messageChannel(guild,group.voice_channel_id);
    if(canSend(voice)){
      let message=null;
      if(group.voice_message_id)message=await voice.messages?.fetch?.(String(group.voice_message_id)).catch(()=>null);
      if(message)await message.edit(payload).catch(()=>{});
      else if(announce||!group.voice_message_id){message=await voice.send(payload).catch(()=>null);if(message?.id)patch.voice_message_id=String(message.id);}
    }

    if(await teamChannelDeliveryEnabled(this.tasks,guild?.id)){
      const team=await this.teams.get(group.target_team_id);
      const teamChannel=await this.#messageChannel(guild,team?.notification_channel_id);
      if(canSend(teamChannel)){
        let message=null;
        if(group.team_message_id&&String(group.team_channel_id)===String(teamChannel.id))message=await teamChannel.messages?.fetch?.(String(group.team_message_id)).catch(()=>null);
        if(message)await message.edit(payload).catch(()=>{});
        else if(announce||!group.team_message_id){message=await teamChannel.send(payload).catch(()=>null);if(message?.id){patch.team_channel_id=String(teamChannel.id);patch.team_message_id=String(message.id);}}
      }
    }

    if(Object.keys(patch).length)await this.tasks.updateGroupMessages(groupId,patch);
    return {group,rows};
  }

  async ensureMeetingBoard({meeting,guild}){
    if(!meeting?.id||!meeting?.voice_channel_id||!guild)return null;
    await this.tasks.upsertBoard({meetingId:meeting.id,guildId:guild.id,voiceChannelId:meeting.voice_channel_id});
    return this.refreshMeetingBoard(meeting.id,guild);
  }

  async refreshMeetingBoard(meetingId,guild){
    const meeting=await this.meetings.get(meetingId);if(!meeting)return null;
    let board=await this.tasks.getBoard(meetingId);
    if(!board)board=await this.tasks.upsertBoard({meetingId,guildId:guild.id,voiceChannelId:meeting.voice_channel_id});
    const groups=await this.tasks.listGroupsForMeeting(meetingId);const summaries=[];
    for(const group of groups){
      const rows=await this.tasks.listGroupTasks(group.id);const p=progress(rows);
      const open=p.total-p.done-p.counts.cancelled;
      summaries.push(`• **${group.title}** — ${group.target_team_name} — ✅ ${p.done}/${p.total}${open?` • قيد المتابعة ${open}`:''}`);
    }
    const ended=meeting.status==='ended'||Boolean(board.finalized_at);
    const desc=[
      `**الاجتماع:** ${meeting.name}`,
      `**القناة:** <#${meeting.voice_channel_id}>`,
      ended?'⏹️ **انتهى الاجتماع، وتستمر متابعة التكليفات من هذه اللوحة.**':'🟢 **الاجتماع جارٍ الآن.**',
      '',
      '**التكليفات الصادرة من هذا الاجتماع:**',
      summaries.join('\n')||'لا توجد تكليفات حتى الآن.',
      '',
      ended?'يمكن متابعة حالات الإنجاز هنا بعد الاجتماع.':'قائد الاجتماع يستطيع إنشاء مهمة لعضو واحد، عدة أعضاء، أو فريق كامل.',
    ].join('\n').slice(0,4000);
    const payload={
      embeds:[{title:'📋 لوحة مهام الاجتماع',description:desc,color:0xC59A45,timestamp:new Date().toISOString()}],
      components:ended?[]:[{type:1,components:[
        {type:2,style:1,custom_id:`task:live-add:${meeting.id}`,label:'إضافة مهمة / تكليف',emoji:{name:'➕'}},
        {type:2,style:2,custom_id:`task:live-refresh:${meeting.id}`,label:'تحديث اللوحة',emoji:{name:'🔄'}},
      ]}],
      allowedMentions:{parse:[]},
    };
    const voice=await this.#messageChannel(guild,meeting.voice_channel_id);if(!canSend(voice)){this.logger?.warn?.('meeting-task-board-channel-not-sendable',{meetingId,channelId:meeting.voice_channel_id});return null;}
    let message=board.message_id?await voice.messages?.fetch?.(String(board.message_id)).catch(()=>null):null;
    if(message)await message.edit(payload);
    else{message=await voice.send(payload);await this.tasks.setBoardMessage(meetingId,String(message.id));}
    return message;
  }

  async finalizeMeetingBoard(meetingId,guild){
    await this.tasks.finalizeBoard(meetingId).catch(()=>{});
    return this.refreshMeetingBoard(meetingId,guild).catch(error=>{this.logger?.warn?.('meeting-task-board-finalize-failed',{meetingId,error:error?.message??String(error)});return null;});
  }

  async #refreshTaskSurfaces(task,guild){
    if(!guild||!task?.assignment_group_id)return;
    await this.syncAssignmentGroup(task.assignment_group_id,guild).catch(()=>{});
    if(task.meeting_id)await this.refreshMeetingBoard(task.meeting_id,guild).catch(()=>{});
  }

  async setStatus({taskId,status,actorId,guildId,allowAssignee=false,guild=null}){
    assertTaskStatus(status);const task=await this.tasks.get(taskId);if(!task)throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');if(String(task.guild_id)!==String(guildId))throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');if(allowAssignee&&String(actorId)===String(task.assignee_user_id)&&!canAssigneeTransition(task.status,status))throw new AppError('TASK_TRANSITION','العضو يستطيع بدء التنفيذ أو إرجاعه إلى لم يبدأ فقط؛ الإنجاز النهائي يحتاج تسليمًا ومراجعة.');
    const updated=await withTransaction(async c=>{const x=await this.tasks.updateStatus(taskId,status,c);await this.tasks.addHistory({taskId,actorUserId:actorId,eventType:'status_changed',fromStatus:task.status,toStatus:status},c);await this.audit.log({guildId,actorId,action:'task.status_changed',targetType:'task',targetId:taskId,oldValue:{status:task.status},newValue:{status}},c);return x;});
    await this.#refreshTaskSurfaces(task,guild);return updated;
  }

  async saveAttachments(taskId,attachments=[]){const root=path.resolve(process.env.STORAGE_DIR||'storage','task-submissions',String(taskId));await fs.mkdir(root,{recursive:true});const saved=[];for(const attachment of attachments.slice(0,3)){if(!attachment?.url)continue;if(Number(attachment.size||0)>MAX_FILE_BYTES)throw new AppError('TASK_FILE_TOO_LARGE','حجم الملف يتجاوز 15MB.');if(isBlockedName(attachment.name))throw new AppError('TASK_FILE_TYPE','هذا النوع من الملفات التنفيذية غير مسموح كإثبات مهمة.');const name=`${Date.now()}-${safeName(attachment.name)}`;const localPath=path.join(root,name);const res=await fetch(attachment.url);if(!res.ok)throw new AppError('TASK_FILE_DOWNLOAD','تعذر حفظ الملف المرفق.');const ab=await res.arrayBuffer();if(ab.byteLength>MAX_FILE_BYTES)throw new AppError('TASK_FILE_TOO_LARGE','حجم الملف يتجاوز 15MB.');await fs.writeFile(localPath,Buffer.from(ab));saved.push({name:attachment.name,url:attachment.url,size:ab.byteLength,contentType:attachment.contentType||null,localPath});}return saved;}

  async submit({taskId,actorId,guildId,note='',attachments=[],guild=null}){const task=await this.tasks.get(taskId);if(!task||String(task.guild_id)!==String(guildId))throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');if(String(task.assignee_user_id)!==String(actorId))throw new AppError('FORBIDDEN','فقط الشخص المكلّف بهذه المهمة يستطيع تسليمها.');if(task.status==='cancelled'||task.status==='done')throw new AppError('TASK_CLOSED','هذه المهمة مغلقة ولا تقبل تسليمًا جديدًا.');note=z.string().trim().max(1800).parse(note??'');const saved=await this.saveAttachments(taskId,attachments);if(!note&&!saved.length)throw new AppError('TASK_SUBMISSION_EMPTY','اكتب ملاحظة عن الإنجاز أو أرفق ملفًا واحدًا على الأقل.');const submission=await withTransaction(async c=>{const row=await this.tasks.addSubmission({taskId,submitterUserId:actorId,note,attachments:saved},c);await this.tasks.addHistory({taskId,actorUserId:actorId,eventType:'submitted',fromStatus:task.status,toStatus:'in_progress',note,metadata:{submissionId:row.id,files:saved.map(x=>x.name)}},c);await this.audit.log({guildId,actorId,action:'task.submitted',targetType:'task',targetId:taskId,newValue:{submissionId:row.id,files:saved.map(x=>x.name),note}},c);return row;});if(guild){await this.notifyReviewers(task,guild).catch(()=>{});await this.#refreshTaskSurfaces(task,guild);}return submission;}

  async notifyReviewers(task,guild){// operations967-production-personal-dm-v1.10.7
    // production-dm:reviewers
    if(!await operationalDmDeliveryEnabled(this.tasks,guild?.id))return false;const ids=new Set([String(task.created_by||''),String(process.env.OWNER_USER_ID||'')].filter(Boolean));for(const id of ids){if(id===String(task.assignee_user_id))continue;const u=await guild.client.users.fetch(id).catch(()=>null);if(u)await u.send(`📥 **تسليم مهمة بانتظار المراجعة**\n${task.title}\nالمكلّف: <@${task.assignee_user_id}>\nافتح /panel ← القرارات والتكليفات لمراجعة الملف واعتماد الإنجاز.`).catch(()=>{});}}

  async review({taskId,approved,reviewerUserId,guildId,note='',guild=null}){const task=await this.tasks.get(taskId);if(!task||String(task.guild_id)!==String(guildId))throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');if(task.review_status!=='submitted')throw new AppError('TASK_NOT_SUBMITTED','لا يوجد تسليم حالي بانتظار المراجعة.');if(String(task.assignee_user_id)===String(reviewerUserId)&&String(reviewerUserId)!==String(process.env.OWNER_USER_ID||''))throw new AppError('SELF_REVIEW','لا يمكن للمكلّف اعتماد مهمته بنفسه.');note=z.string().trim().max(1500).parse(note??'');const updated=await withTransaction(async c=>{const row=await this.tasks.review(taskId,{approved,reviewerUserId,note},c);await this.tasks.addHistory({taskId,actorUserId:reviewerUserId,eventType:approved?'approved':'returned',fromStatus:task.status,toStatus:row.status,note,metadata:{reviewStatus:row.review_status}},c);await this.audit.log({guildId,actorId:reviewerUserId,action:approved?'task.approved':'task.returned',targetType:'task',targetId:taskId,oldValue:{reviewStatus:task.review_status},newValue:{reviewStatus:row.review_status,note}},c);return row;});if(guild){
      // production-dm:review-result
      const operationalDm=await operationalDmDeliveryEnabled(this.tasks,guild?.id);
      if(operationalDm){
      const message=`${approved?'✅ **تم اعتماد إنجاز المهمة**':'↩️ **تمت إعادة المهمة للتعديل**'}\n${task.title}\nالمكلّف: <@${task.assignee_user_id}>${note?`\nملاحظة المراجع: ${note}`:''}`;
      const ids=new Set([String(task.assignee_user_id),String(task.created_by||''),String(process.env.OWNER_USER_ID||'')].filter(Boolean));
      for(const id of ids){const u=await guild.client.users.fetch(id).catch(()=>null);if(u)await u.send(message).catch(()=>{});}
      }
      await this.#refreshTaskSurfaces(task,guild);
    }return updated;}
async reassignTask({guildId,taskId,targetTeamId,targetAssigneeUserId,actorId}){
  const task=await this.tasks.get(taskId);
  if(!task || String(task.guild_id)!==String(guildId)) throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');

  const targetTeam=await this.teams.get(targetTeamId);
  if(!targetTeam || String(targetTeam.guild_id)!==String(guildId) || targetTeam.deleted_at){
    throw new AppError('TEAM_NOT_FOUND','الفريق الجديد غير موجود.');
  }

  let operationalMembers=await this.teams.members(targetTeamId);
  try{
    const allTeams=await this.teams.list(guildId);
    const targetName=String(targetTeam.name??'').trim();
    const supports=allTeams.filter(t=>!t.deleted_at&&t.active!==false&&/^\s*مساند\s+/u.test(String(t.name??'').trim())&&String(t.name??'').trim().replace(/^\s*مساند\s+/u,'').trim()===targetName);
    for(const support of supports) operationalMembers=[...operationalMembers,...await this.teams.members(support.id)];
  }catch(_error){}
  const operationalIds=new Set(operationalMembers.map(x=>String(x.user_id)));
  if(!operationalIds.has(String(targetAssigneeUserId))){
    throw new AppError('ASSIGNEE_TEAM','المكلّف الجديد يجب أن يكون عضوًا في الفريق أو في الفريق المساند له.');
  }

  let meetingId=task.meeting_id??null;
  let detachedFromMeeting=false;
  if(meetingId){
    const meeting=await this.meetings.get(meetingId);
    if(!meeting) meetingId=null;
    else if(String(meeting.team_id)!==String(targetTeamId)){
      meetingId=null;
      detachedFromMeeting=true;
    }
  }

  return withTransaction(async c=>{
    const result=await c.query(
      `UPDATE meeting_tasks
       SET team_id=$2, meeting_id=$3, assignee_user_id=$4, updated_at=now()
       WHERE id=$1 AND guild_id=$5
       RETURNING *`,
      [taskId,targetTeamId,meetingId,targetAssigneeUserId,guildId]
    );
    const updated=result.rows[0];
    if(!updated) throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');

    await this.tasks.addHistory({
      taskId:updated.id,
      actorUserId:actorId,
      eventType:'reassigned',
      metadata:{
        previousTeamId:task.team_id,
        previousAssigneeUserId:task.assignee_user_id,
        previousMeetingId:task.meeting_id,
        newTeamId:targetTeamId,
        newAssigneeUserId:targetAssigneeUserId,
        newMeetingId:meetingId,
        detachedFromMeeting
      }
    },c);

    await this.audit.log({
      guildId,actorId,action:'task.reassigned',
      targetType:'task',targetId:updated.id,
      oldValue:{teamId:task.team_id,assigneeUserId:task.assignee_user_id,meetingId:task.meeting_id},
      newValue:{teamId:targetTeamId,assigneeUserId:targetAssigneeUserId,meetingId,detachedFromMeeting}
    },c);

    return updated;
  });
}

async reassignTaskGroup({guildId,groupId,targetTeamId,targetAssigneeUserIds,actorId}){
  const group=await this.tasks.getGroup(groupId);
  if(!group || String(group.guild_id)!==String(guildId)) throw new AppError('TASK_GROUP_NOT_FOUND','مجموعة التكليف غير موجودة.');

  const tasks=await this.tasks.listGroupTasks(groupId);
  if(!tasks.length) throw new AppError('TASK_GROUP_EMPTY','لا توجد مهام في هذه المجموعة.');

  const ids=[...new Set((targetAssigneeUserIds??[]).map(String))];
  if(ids.length!==tasks.length) throw new AppError('TASK_GROUP_MEMBER_COUNT','عدد المكلّفين الجدد يجب أن يساوي عدد مهام المجموعة.');

  const targetTeam=await this.teams.get(targetTeamId);
  if(!targetTeam || String(targetTeam.guild_id)!==String(guildId) || targetTeam.deleted_at){
    throw new AppError('TEAM_NOT_FOUND','الفريق الجديد غير موجود.');
  }

  let operationalMembers=await this.teams.members(targetTeamId);
  try{
    const allTeams=await this.teams.list(guildId);
    const targetName=String(targetTeam.name??'').trim();
    const supports=allTeams.filter(t=>!t.deleted_at&&t.active!==false&&/^\s*مساند\s+/u.test(String(t.name??'').trim())&&String(t.name??'').trim().replace(/^\s*مساند\s+/u,'').trim()===targetName);
    for(const support of supports) operationalMembers=[...operationalMembers,...await this.teams.members(support.id)];
  }catch(_error){}

  const memberIds=new Set(operationalMembers.map(x=>String(x.user_id)));
  const invalid=ids.filter(id=>!memberIds.has(id));
  if(invalid.length) throw new AppError('ASSIGNEE_TEAM','كل المكلّفين الجدد يجب أن يكونوا أعضاء في الفريق أو الفريق المساند له.');

  const assignmentMode=ids.length===memberIds.size?'team':'members';

  return withTransaction(async c=>{
    const groupResult=await c.query(
      `UPDATE task_assignment_groups
       SET target_team_id=$2, assignment_mode=$3, updated_at=now()
       WHERE id=$1 AND guild_id=$4
       RETURNING *`,
      [groupId,targetTeamId,assignmentMode,guildId]
    );
    const updatedGroup=groupResult.rows[0];
    if(!updatedGroup) throw new AppError('TASK_GROUP_NOT_FOUND','مجموعة التكليف غير موجودة.');

    const updatedTasks=[];
    for(let index=0;index<tasks.length;index++){
      const oldTask=tasks[index];
      const resultTask=await c.query(
        `UPDATE meeting_tasks
         SET team_id=$2, assignee_user_id=$3, updated_at=now()
         WHERE id=$1 AND guild_id=$4
         RETURNING *`,
        [oldTask.id,targetTeamId,ids[index],guildId]
      );
      const updated=resultTask.rows[0];
      if(!updated) throw new AppError('TASK_NOT_FOUND','تعذر تحديث أحد تكليفات المجموعة.');

      await this.tasks.addHistory({
        taskId:updated.id,
        actorUserId:actorId,
        eventType:'reassigned',
        metadata:{
          previousTeamId:oldTask.team_id,
          previousAssigneeUserId:oldTask.assignee_user_id,
          newTeamId:targetTeamId,
          newAssigneeUserId:ids[index],
          assignmentGroupId:groupId
        }
      },c);

      updatedTasks.push(updated);
    }

    await this.audit.log({
      guildId,actorId,
      action:'task.assignment_group.reassigned',
      targetType:'task_assignment_group',
      targetId:groupId,
      oldValue:{targetTeamId:group.target_team_id,assignmentMode:group.assignment_mode,assignees:tasks.map(x=>String(x.assignee_user_id))},
      newValue:{targetTeamId,assignmentMode,assignees:ids}
    },c);

    return {group:updatedGroup,tasks:updatedTasks};
  });
}

}
