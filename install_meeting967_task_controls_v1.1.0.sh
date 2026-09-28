#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
VERSION="1.1.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/task-controls-v${VERSION}-${STAMP}"
TMP="${PREFIX:-/data/data/com.termux/files/usr}/tmp/meeting967-task-controls-${STAMP}"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }
cleanup(){ rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

TASKS="$ROOT/src/interfaces/discord/interactions/tasks.js"
SERVICE="$ROOT/src/application/services/TaskService.js"
RELIABILITY="$ROOT/src/interfaces/discord/interactionReliability.js"

[ -d "$ROOT" ] || die "لم أجد المشروع: $ROOT"
for f in "$TASKS" "$SERVICE" "$RELIABILITY"; do
  [ -f "$f" ] || die "الملف غير موجود: $f"
done

mkdir -p "$BACKUP" "$TMP"
cp -a "$TASKS" "$BACKUP/tasks.js"
cp -a "$SERVICE" "$BACKUP/TaskService.js"
cp -a "$RELIABILITY" "$BACKUP/interactionReliability.js"

say "============================================================"
say " Meeting 967 — Task Controls v${VERSION}"
say " مهمة مستقلة + تبديل المكلّف + استبدال مجموعة/فريق"
say "============================================================"

cat > "$TMP/tasks-functions.js" <<'JS'
async function standaloneCanManage(a,s,teamId){
  if(a.permissionService.isOwner?.(s.userId)) return true;
  return Boolean(await a.permissionService.has(s,'tasks.manage',{teamId}));
}

async function standaloneTaskTeamPicker(i,a,s,page=0){
  const teams=(await a.teams.list(s.guildId)).filter(t=>!t.deleted_at);
  const allowed=[];
  for(const team of teams){
    if(await standaloneCanManage(a,s,team.id)) allowed.push(team);
  }
  if(!allowed.length) throw new AppError('NO_TASK_TEAMS','ليس لديك صلاحية إدارة المهام في أي فريق.');

  const pageSize=20;
  const pages=Math.max(1,Math.ceil(allowed.length/pageSize));
  const safePage=Math.max(0,Math.min(Number(page)||0,pages-1));
  const slice=allowed.slice(safePage*pageSize,(safePage+1)*pageSize);

  const components=[
    stringSelect(
      'task:standalone-team-select',
      'اختر الفريق',
      slice.map(t=>({
        label:String(t.name).slice(0,100),
        description:'مهمة مستقلة — بدون اجتماع',
        value:String(t.id),
      }))
    )
  ];

  const pager=[];
  if(safePage>0) pager.push(btn('task:standalone-team-page:'+String(safePage-1),'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safePage+1<pages) pager.push(btn('task:standalone-team-page:'+String(safePage+1),'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length) components.push(...rowsFromButtons(pager));

  return i.update({
    embeds:[e('📝 إضافة مهمة مستقلة',[
      'المهمة لا تحتاج إلى اجتماع.',
      'اختر الفريق، ثم اكتب التفاصيل وحدد المكلّف.',
      'الصلاحية المطلوبة: **tasks.manage** على الفريق.',
      'الصفحة **'+String(safePage+1)+'/'+String(pages)+'** — الفرق المتاحة: **'+String(allowed.length)+'**',
    ].join('\n'))],
    components:withNavigation(components,'admin:tasks'),
  });
}

async function standaloneTaskDetailsModal(i,a,s,teamId){
  if(!teamId) throw new AppError('TEAM_REQUIRED','اختر الفريق أولًا.');
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إضافة مهام لهذا الفريق.');
  const team=await a.teams.get(teamId);
  if(!team||String(team.guild_id)!==String(s.guildId)||team.deleted_at) throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');

  a.drafts.set('standalone-task:'+s.userId,{teamId});

  return i.showModal(
    new ModalBuilder()
      .setCustomId('task:standalone-details')
      .setTitle('إضافة مهمة مستقلة')
      .addComponents(
        input('title','عنوان المهمة'),
        input('due','الموعد النهائي YYYY-MM-DD HH:mm',TextInputStyle.Short,false),
        input('description','تفاصيل المهمة',TextInputStyle.Paragraph,false)
      )
  );
}

async function standaloneTaskDetailsSubmit(i,a,s){
  const d=a.drafts.get('standalone-task:'+s.userId);
  if(!d?.teamId) throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء المهمة. ابدأ من جديد.');
  if(!(await standaloneCanManage(a,s,d.teamId))) throw new AppError('FORBIDDEN','لم تعد لديك صلاحية إدارة المهام في هذا الفريق.');

  const settings=await a.guilds.getSettings(s.guildId);
  const raw=i.fields.getTextInputValue('due').trim();

  a.drafts.set('standalone-task:'+s.userId,{
    ...d,
    title:i.fields.getTextInputValue('title'),
    description:i.fields.getTextInputValue('description'),
    dueAt:raw?parseLocalDateTime(raw,settings.timezone):null,
  });

  await i.deferReply({ephemeral:Boolean(i.guildId)});
  return standaloneAssigneePicker(i,a,s,d.teamId,0,false);
}

async function standaloneAssigneePicker(i,a,s,teamId,page=0,update=false){
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إضافة مهام لهذا الفريق.');
  const team=await a.teams.get(teamId);
  if(!team||String(team.guild_id)!==String(s.guildId)||team.deleted_at) throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');

  const members=await a.teams.members(teamId);
  if(!members.length) throw new AppError('NO_MEMBERS','لا يوجد أعضاء في الفريق لإسناد هذه المهمة.');

  const guildOptions=await guildMemberOptions(s.guild,{includeBots:false});
  const byId=new Map(guildOptions.map(x=>[String(x.value),x]));
  const options=members.map(x=>byId.get(String(x.user_id))??{
    label:String(x.display_name??x.user_id).slice(0,100),
    description:'عضو في '+String(team.name).slice(0,80),
    value:String(x.user_id),
  });

  const p=pickerMenuPage(options,page);
  const components=[
    stringSelect('task:standalone-assignee-select:'+String(teamId),'اختر المكلّف',p.menuItems)
  ];
  const pager=[];
  if(p.page>0) pager.push(btn('task:standalone-assignee-page:'+String(teamId)+':'+String(p.page-1),'السابق',ButtonStyle.Secondary,'⬅️'));
  if(p.page+1<p.pages) pager.push(btn('task:standalone-assignee-page:'+String(teamId)+':'+String(p.page+1),'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length) components.push(...rowsFromButtons(pager));

  const payload={
    content:'اختر الشخص المسؤول عن المهمة المستقلة — صفحة '+String(p.page+1)+'/'+String(p.pages)+'.',
    embeds:[],
    components:withNavigation(components,'admin:tasks'),
  };
  return update?i.update(payload):i.editReply(payload);
}

async function standaloneAssigneeSubmit(i,a,s,teamId){
  const d=a.drafts.get('standalone-task:'+s.userId);
  if(!d||String(d.teamId)!==String(teamId)) throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء المهمة. ابدأ من جديد.');
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إضافة مهام لهذا الفريق.');

  const members=await a.teams.members(teamId);
  if(!members.some(x=>String(x.user_id)===String(i.values[0]))) throw new AppError('ASSIGNEE_TEAM','المكلّف يجب أن يكون عضوًا في الفريق المحدد.');

  const task=await a.taskService.create({
    guildId:s.guildId,teamId,meetingId:null,
    title:d.title,description:d.description,
    assigneeUserId:i.values[0],dueAt:d.dueAt,actorId:s.userId,guild:s.guild
  });

  a.drafts.delete('standalone-task:'+s.userId);
  const team=await a.teams.get(teamId);

  return i.update({
    content:'✅ تم إنشاء المهمة المستقلة **'+String(task.title)+'** وإسنادها إلى <@'+String(task.assignee_user_id)+'>.'
      +'\n📁 الفريق: **'+String(team?.name??'غير محدد')+'**'
      +(task.due_at?'\n⏳ الموعد النهائي: <t:'+String(Math.floor(new Date(task.due_at).getTime()/1000))+':F>':'')
      +'\n🗓️ غير مرتبطة بأي اجتماع.',
    embeds:[],
    components:withNavigation([],'admin:tasks'),
  });
}

/* ---------- Individual task: change person and/or team ---------- */
async function reassignTeamOptions(a,s){
  const teams=(await a.teams.list(s.guildId)).filter(t=>!t.deleted_at);
  const allowed=[];
  for(const team of teams){
    if(await standaloneCanManage(a,s,team.id)) allowed.push(team);
  }
  return allowed;
}

async function reassignMemberOptions(a,s,teamId){
  const team=await a.teams.get(teamId);
  if(!team||String(team.guild_id)!==String(s.guildId)||team.deleted_at) throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');
  const members=await a.teams.members(teamId);
  if(!members.length) throw new AppError('NO_MEMBERS','لا يوجد أعضاء في الفريق المحدد.');

  const guildOptions=await guildMemberOptions(s.guild,{includeBots:false});
  const byId=new Map(guildOptions.map(x=>[String(x.value),x]));
  return members.map(x=>byId.get(String(x.user_id))??{
    label:String(x.display_name??x.user_id).slice(0,100),
    description:'عضو في '+String(team.name).slice(0,80),
    value:String(x.user_id),
  }).slice(0,25);
}

async function reassignTaskTeamPicker(i,a,s,taskId,page=0){
  const task=await a.tasks.get(taskId);
  if(!task) throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');

  const canManage=await a.permissionService.has(s,'tasks.manage',{teamId:task.team_id,meetingId:task.meeting_id});
  if(!canManage&&!a.permissionService.isOwner?.(s.userId)) throw new AppError('FORBIDDEN','ليس لديك صلاحية تعديل هذا التكليف.');

  const teams=await reassignTeamOptions(a,s);
  if(!teams.length) throw new AppError('NO_TASK_TEAMS','لا توجد فرق يمكنك إدارة مهامها.');

  const pageSize=20, pages=Math.max(1,Math.ceil(teams.length/pageSize));
  const safe=Math.max(0,Math.min(Number(page)||0,pages-1));
  const slice=teams.slice(safe*pageSize,(safe+1)*pageSize);

  const components=[stringSelect(
    'task:reassign-team-select:'+String(taskId),
    'اختر الفريق الجديد',
    slice.map(t=>({
      label:String(t.name).slice(0,100),
      description:String(t.id)===String(task.team_id)?'نفس الفريق — تبديل الشخص فقط':'تغيير الفريق والمكلّف',
      value:String(t.id)
    }))
  )];

  const pager=[];
  if(safe>0) pager.push(btn('task:reassign-team-page:'+String(taskId)+':'+String(safe-1),'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safe+1<pages) pager.push(btn('task:reassign-team-page:'+String(taskId)+':'+String(safe+1),'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length) components.push(...rowsFromButtons(pager));

  return i.update({
    embeds:[e('🔄 تبديل المكلّف / الفريق',[
      '**المهمة:** '+String(task.title),
      '**المكلّف الحالي:** <@'+String(task.assignee_user_id)+'>',
      '**الفريق الحالي:** '+String(task.team_name??'غير محدد'),
      '',
      'اختر الفريق الجديد. تستطيع اختيار نفس الفريق لتبديل الشخص فقط.',
      task.meeting_id?'⚠️ نقل مهمة فردية لفريق مختلف يفصلها عن الاجتماع تلقائيًا.':'',
    ].filter(Boolean).join('\n'))],
    components:withNavigation(components,'task:view:'+String(taskId)),
  });
}

async function reassignTaskMemberPicker(i,a,s,taskId,teamId){
  const task=await a.tasks.get(taskId);
  if(!task) throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');

  const canManage=await a.permissionService.has(s,'tasks.manage',{teamId:task.team_id,meetingId:task.meeting_id});
  if(!canManage&&!a.permissionService.isOwner?.(s.userId)) throw new AppError('FORBIDDEN','ليس لديك صلاحية تعديل هذا التكليف.');

  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إدارة مهام الفريق الجديد.');

  const options=await reassignMemberOptions(a,s,teamId);
  const team=await a.teams.get(teamId);

  return i.update({
    embeds:[e('👤 المكلّف الجديد',[
      '**المهمة:** '+String(task.title),
      '**الفريق:** '+String(team?.name??'غير محدد'),
      task.meeting_id&&String(teamId)!==String(task.team_id)?'⚠️ سيتم إزالة ارتباطها بالاجتماع عند نقلها للفريق الجديد.':'',
    ].filter(Boolean).join('\n'))],
    components:withNavigation([
      stringSelect('task:reassign-member-select:'+String(taskId)+':'+String(teamId),'اختر المكلّف الجديد',options)
    ],'task:reassign:'+String(taskId)),
  });
}

async function reassignTaskMemberSubmit(i,a,s,taskId,teamId){
  const task=await a.tasks.get(taskId);
  if(!task) throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');
  const canManage=await a.permissionService.has(s,'tasks.manage',{teamId:task.team_id,meetingId:task.meeting_id});
  if(!canManage&&!a.permissionService.isOwner?.(s.userId)) throw new AppError('FORBIDDEN','ليس لديك صلاحية تعديل هذا التكليف.');

  await a.taskService.reassignTask({
    guildId:s.guildId,taskId,targetTeamId:teamId,
    targetAssigneeUserId:i.values[0],actorId:s.userId
  });
  return openTask(i,a,s,taskId);
}

/* ---------- Group task: replace multiple people and/or target team ---------- */
async function reassignGroupCanManage(a,s,group){
  if(a.permissionService.isOwner?.(s.userId)) return true;
  if(await a.permissionService.has(s,'tasks.manage',{teamId:group.origin_team_id,meetingId:group.meeting_id})) return true;
  return Boolean(await a.permissionService.has(s,'tasks.manage',{teamId:group.target_team_id,meetingId:group.meeting_id}));
}

async function reassignGroupTeamPicker(i,a,s,groupId,page=0){
  const group=await a.tasks.getGroup(groupId);
  if(!group) throw new AppError('TASK_GROUP_NOT_FOUND','مجموعة التكليف غير موجودة.');
  const tasks=await a.tasks.listGroupTasks(groupId);
  if(!tasks.length) throw new AppError('TASK_GROUP_EMPTY','لا توجد مهام في هذه المجموعة.');
  if(!await reassignGroupCanManage(a,s,group)) throw new AppError('FORBIDDEN','ليس لديك صلاحية تعديل مجموعة التكليف.');

  const teams=await reassignTeamOptions(a,s);
  if(!teams.length) throw new AppError('NO_TASK_TEAMS','لا توجد فرق يمكنك إدارة مهامها.');

  const pageSize=20, pages=Math.max(1,Math.ceil(teams.length/pageSize));
  const safe=Math.max(0,Math.min(Number(page)||0,pages-1));
  const slice=teams.slice(safe*pageSize,(safe+1)*pageSize);

  return i.update({
    embeds:[e('👥 تبديل مجموعة التكليف',[
      '**التكليف:** '+String(group.title),
      '**عدد المكلّفين الحاليين:** **'+String(tasks.length)+'**',
      '**الفريق الحالي:** '+String(group.target_team_name??'غير محدد'),
      '',
      'اختر الفريق الجديد ثم اختر نفس عدد المكلّفين حتى لا ننشئ مهامًا مكررة أو نفقد تكليفات.',
    ].join('\n'))],
    components:withNavigation([
      stringSelect('task:reassign-group-team-select:'+String(groupId),'اختر الفريق الجديد',slice.map(t=>({
        label:String(t.name).slice(0,100),
        description:String(t.id)===String(group.target_team_id)?'الفريق الحالي':'فريق جديد',
        value:String(t.id)
      })))
    ],'admin:tasks'),
  });
}

async function reassignGroupMembersPicker(i,a,s,groupId,teamId){
  const group=await a.tasks.getGroup(groupId);
  if(!group) throw new AppError('TASK_GROUP_NOT_FOUND','مجموعة التكليف غير موجودة.');
  const tasks=await a.tasks.listGroupTasks(groupId);
  if(!tasks.length) throw new AppError('TASK_GROUP_EMPTY','لا توجد مهام في هذه المجموعة.');
  if(!await reassignGroupCanManage(a,s,group)) throw new AppError('FORBIDDEN','ليس لديك صلاحية تعديل مجموعة التكليف.');
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إدارة مهام الفريق الجديد.');

  const options=await reassignMemberOptions(a,s,teamId);
  const needed=tasks.length;
  if(needed>25) throw new AppError('TASK_GROUP_TOO_LARGE','هذه المجموعة تحتوي أكثر من 25 تكليفًا ولا يمكن تبديلها دفعة واحدة.');
  if(options.length<needed) throw new AppError('TASK_GROUP_MEMBER_COUNT','الفريق الجديد لا يحتوي عددًا كافيًا من الأعضاء.');

  const team=await a.teams.get(teamId);
  return i.update({
    embeds:[e('👤 استبدال مكلّفي المجموعة',[
      '**التكليف:** '+String(group.title),
      '**الفريق الجديد:** '+String(team?.name??'غير محدد'),
      '**المطلوب:** اختر **'+String(needed)+'** أعضاء بالضبط.',
      'سيتم تبديل المكلّفين مع الحفاظ على نفس المهام وحالاتها.',
    ].join('\n'))],
    components:withNavigation([
      stringSelect('task:reassign-group-members:'+String(groupId)+':'+String(teamId),
        'اختر المكلّفين الجدد — المطلوب '+String(needed),
        options,needed,needed)
    ],'task:reassign-group:'+String(groupId)),
  });
}

async function reassignGroupMembersSubmit(i,a,s,groupId,teamId){
  const group=await a.tasks.getGroup(groupId);
  if(!group) throw new AppError('TASK_GROUP_NOT_FOUND','مجموعة التكليف غير موجودة.');
  const tasks=await a.tasks.listGroupTasks(groupId);
  await a.taskService.reassignTaskGroup({
    guildId:s.guildId,groupId,targetTeamId:teamId,
    targetAssigneeUserIds:i.values,actorId:s.userId
  });

  const fresh=await a.tasks.getGroup(groupId);
  return i.update({
    embeds:[e('✅ تمت إعادة إسناد المجموعة',[
      '**التكليف:** '+String(fresh?.title??group.title),
      '**الفريق الجديد:** '+String(fresh?.target_team_name??'غير محدد'),
      '**عدد المكلّفين:** **'+String(tasks.length)+'**',
      'تم استبدال المكلّفين مع بقاء المهام نفسها وحالاتها.',
    ].join('\n'))],
    components:withNavigation([],'admin:tasks'),
  });
}
JS

cat > "$TMP/service-functions.js" <<'JS'
async reassignTask({guildId,taskId,targetTeamId,targetAssigneeUserId,actorId}){
  const task=await this.tasks.get(taskId);
  if(!task || String(task.guild_id)!==String(guildId)) throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');

  const targetTeam=await this.teams.get(targetTeamId);
  if(!targetTeam || String(targetTeam.guild_id)!==String(guildId) || targetTeam.deleted_at){
    throw new AppError('TEAM_NOT_FOUND','الفريق الجديد غير موجود.');
  }

  const members=await this.teams.members(targetTeamId);
  if(!members.some(x=>String(x.user_id)===String(targetAssigneeUserId))){
    throw new AppError('ASSIGNEE_TEAM','المكلّف الجديد يجب أن يكون عضوًا في الفريق المحدد.');
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

  const row=await withTransaction(async c=>{
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
      oldValue:{
        teamId:task.team_id,
        assigneeUserId:task.assignee_user_id,
        meetingId:task.meeting_id
      },
      newValue:{
        teamId:targetTeamId,
        assigneeUserId:targetAssigneeUserId,
        meetingId,
        detachedFromMeeting
      }
    },c);

    return updated;
  });

  return row;
}

async reassignTaskGroup({guildId,groupId,targetTeamId,targetAssigneeUserIds,actorId}){
  const group=await this.tasks.getGroup(groupId);
  if(!group || String(group.guild_id)!==String(guildId)) throw new AppError('TASK_GROUP_NOT_FOUND','مجموعة التكليف غير موجودة.');

  const tasks=await this.tasks.listGroupTasks(groupId);
  if(!tasks.length) throw new AppError('TASK_GROUP_EMPTY','لا توجد مهام في هذه المجموعة.');

  const ids=[...new Set((targetAssigneeUserIds??[]).map(String))];
  if(ids.length!==tasks.length){
    throw new AppError('TASK_GROUP_MEMBER_COUNT','عدد المكلّفين الجدد يجب أن يساوي عدد مهام المجموعة.');
  }

  const targetTeam=await this.teams.get(targetTeamId);
  if(!targetTeam || String(targetTeam.guild_id)!==String(guildId) || targetTeam.deleted_at){
    throw new AppError('TEAM_NOT_FOUND','الفريق الجديد غير موجود.');
  }

  const members=await this.teams.members(targetTeamId);
  const memberIds=new Set(members.map(x=>String(x.user_id)));
  const invalid=ids.filter(id=>!memberIds.has(id));
  if(invalid.length) throw new AppError('ASSIGNEE_TEAM','كل المكلّفين الجدد يجب أن يكونوا أعضاء في الفريق الجديد.');

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
      oldValue:{
        targetTeamId:group.target_team_id,
        assignmentMode:group.assignment_mode,
        assignees:tasks.map(x=>String(x.assignee_user_id))
      },
      newValue:{
        targetTeamId,
        assignmentMode,
        assignees:ids
      }
    },c);

    return {group:updatedGroup,tasks:updatedTasks};
  });
}
JS

cat > "$TMP/patch.mjs" <<'JS'
import fs from 'node:fs';

const [tasksPath,servicePath,reliabilityPath,tasksFnsPath,serviceFnsPath]=process.argv.slice(2);
let tasks=fs.readFileSync(tasksPath,'utf8');
let service=fs.readFileSync(servicePath,'utf8');
let reliability=fs.readFileSync(reliabilityPath,'utf8');
const tasksFns=fs.readFileSync(tasksFnsPath,'utf8');
const serviceFns=fs.readFileSync(serviceFnsPath,'utf8');

function need(ok,label){
  if(!ok) throw new Error('لم أجد نقطة الربط: '+label);
}
function insertOnce(source,needle,replacement,label){
  need(source.includes(needle),label);
  return source.replace(needle,replacement);
}

/* TaskService: append two methods before the class's final closing brace. */
if(!service.includes("async reassignTask({guildId,taskId,targetTeamId,targetAssigneeUserId,actorId}")){
  const classEnd=service.lastIndexOf('\n}');
  need(classEnd>=0,'نهاية TaskService');
  service=service.slice(0,classEnd)+'\n'+serviceFns+service.slice(classEnd);
}

/* Tasks UI: add standalone/reassignment helpers before handleTasks. */
if(!tasks.includes("async function standaloneTaskTeamPicker(")){
  const marker="export async function handleTasks(i,a){";
  tasks=insertOnce(tasks,marker,tasksFns+'\n'+marker,'handleTasks export');
}

/* Routes must run AFTER subjectFromInteraction creates s. */
if(!tasks.includes("if(id==='task:add-standalone')return standaloneTaskTeamPicker(i,a,s,0);")){
  const marker="  const s=await subjectFromInteraction(i,a.env);";
  const routes=`
  if(id==='task:add-standalone')return standaloneTaskTeamPicker(i,a,s,0);
  if(id.startsWith('task:standalone-team-page:'))return standaloneTaskTeamPicker(i,a,s,Number(id.split(':')[2]||0));
  if(id==='task:standalone-team-select')return standaloneTaskDetailsModal(i,a,s,i.values[0]);
  if(id==='task:standalone-details')return standaloneTaskDetailsSubmit(i,a,s);
  if(id.startsWith('task:standalone-assignee-page:')){const p=id.split(':');return standaloneAssigneePicker(i,a,s,p[2],Number(p[3]||0),true);}
  if(id.startsWith('task:standalone-assignee-select:'))return standaloneAssigneeSubmit(i,a,s,id.split(':')[3]);

  if(id.startsWith('task:reassign:'))return reassignTaskTeamPicker(i,a,s,id.split(':')[2],0);
  if(id.startsWith('task:reassign-team-page:')){const p=id.split(':');return reassignTaskTeamPicker(i,a,s,p[2],Number(p[3]||0));}
  if(id.startsWith('task:reassign-team-select:'))return reassignTaskMemberPicker(i,a,s,id.split(':')[2],i.values[0]);
  if(id.startsWith('task:reassign-member-select:')){const p=id.split(':');return reassignTaskMemberSubmit(i,a,s,p[2],p[3]);}

  if(id.startsWith('task:reassign-group:'))return reassignGroupTeamPicker(i,a,s,id.split(':')[2],0);
  if(id.startsWith('task:reassign-group-team-page:')){const p=id.split(':');return reassignGroupTeamPicker(i,a,s,p[2],Number(p[3]||0));}
  if(id.startsWith('task:reassign-group-team-select:'))return reassignGroupMembersPicker(i,a,s,id.split(':')[2],i.values[0]);
  if(id.startsWith('task:reassign-group-members:')){const p=id.split(':');return reassignGroupMembersSubmit(i,a,s,p[2],p[3]);}
`;
  tasks=insertOnce(tasks,marker,marker+routes,'subjectFromInteraction in handleTasks');
}

/* Add the standalone button beside the existing meeting-based task button INSIDE tasks.js. */
if(!tasks.includes("task:add-standalone")){
  const fnStart=tasks.indexOf("async function adminTasks(");
  need(fnStart>=0,'adminTasks داخل tasks.js');
  const fnEnd=tasks.indexOf("\nasync function ",fnStart+25);
  const end=fnEnd>=0?fnEnd:tasks.length;
  let fn=tasks.slice(fnStart,end);

  const exact="buttons.unshift(btn('task:add-meeting','إضافة مهمة من اجتماع',ButtonStyle.Success,'➕'));";
  need(fn.includes(exact),'زر إضافة مهمة من اجتماع داخل adminTasks');

  fn=fn.replace(
    exact,
    "buttons.unshift(btn('task:add-standalone','إضافة مهمة مستقلة',ButtonStyle.Success,'📝'));\n    "+exact
  );
  tasks=tasks.slice(0,fnStart)+fn+tasks.slice(end);
}

/* Add reassignment controls to openTask, not to unrelated canManage blocks. */
if(!tasks.includes("task:reassign:${task.id}")){
  const fnStart=tasks.indexOf("async function openTask(");
  need(fnStart>=0,'openTask داخل tasks.js');
  const fnEnd=tasks.indexOf("\nasync function ",fnStart+20);
  const end=fnEnd>=0?fnEnd:tasks.length;
  let fn=tasks.slice(fnStart,end);

  const marker="  if(canManage){";
  need(fn.includes(marker),'openTask canManage block');

  const injection=`  if(canManage){
    buttons.push(btn(\`task:reassign:\${task.id}\`,'تبديل المكلّف / الفريق',ButtonStyle.Secondary,'🔄'));
    if(task.assignment_group_id){
      buttons.push(btn(\`task:reassign-group:\${task.assignment_group_id}\`,'تبديل مجموعة التكليف',ButtonStyle.Secondary,'👥'));
    }
`;
  fn=fn.replace(marker,injection);
  tasks=tasks.slice(0,fnStart)+fn+tasks.slice(end);
}

/* The standalone opener is a Modal opener; other task controls use normal updates/selects. */
if(!reliability.includes("id => id === 'task:add-standalone'")){
  const marker="  id => id.startsWith('meeting:task:') && !id.startsWith('meeting:task-submit:'),";
  need(reliability.includes(marker),'Modal opener list');
  reliability=reliability.replace(marker,"  id => id === 'task:add-standalone',\n"+marker);
}

for(const x of [
  "task:add-standalone",
  "task:standalone-team-select",
  "task:standalone-details",
  "task:standalone-assignee-select:",
  "task:reassign:",
  "task:reassign-group:",
  "task:reassign-group-members:",
  "taskService.reassignTask",
  "taskService.reassignTaskGroup"
]) need(tasks.includes(x),'tasks marker '+x);

need(service.includes("async reassignTask("),'TaskService.reassignTask');
need(service.includes("async reassignTaskGroup("),'TaskService.reassignTaskGroup');
need(reliability.includes("id => id === 'task:add-standalone'"),'reliability standalone opener');

fs.writeFileSync(tasksPath,tasks);
fs.writeFileSync(servicePath,service);
fs.writeFileSync(reliabilityPath,reliability);

console.log('✅ Patch applied successfully');
JS

say "🧪 فحص Patch source..."
node --check "$TMP/tasks-functions.js"
node --check "$TMP/patch.mjs"

# Validate service method snippets as class methods.
{
  printf 'class X {\n' > "$TMP/service-verify.mjs"
  cat "$TMP/service-functions.js" >> "$TMP/service-verify.mjs"
  printf '\n}\n' >> "$TMP/service-verify.mjs"
  node --check "$TMP/service-verify.mjs"
}

say "🧩 تطبيق التعديل..."
node "$TMP/patch.mjs" "$TASKS" "$SERVICE" "$RELIABILITY" "$TMP/tasks-functions.js" "$TMP/service-functions.js"

say "🧪 فحص JavaScript بعد التطبيق..."
node --check "$TASKS"
node --check "$SERVICE"
node --check "$RELIABILITY"

say "🔎 فحص الخصائص..."
grep -q "task:add-standalone" "$TASKS"
grep -q "task:reassign:" "$TASKS"
grep -q "task:reassign-group:" "$TASKS"
grep -q "async reassignTask(" "$SERVICE"
grep -q "async reassignTaskGroup(" "$SERVICE"
grep -q "id => id === 'task:add-standalone'" "$RELIABILITY"

say "✅ Task Controls v${VERSION} installed بنجاح."
say "📌 الآن توجد مهمة مستقلة لا تحتاج اجتماعًا."
say "📌 يمكنك تبديل شخص واحد داخل المهمة."
say "📌 يمكنك تغيير فريق المهمة الفردية؛ وعند اختلاف الفريق عن الاجتماع تُفصل عن الاجتماع تلقائيًا."
say "📌 يمكنك استبدال مجموعة المكلّفين دفعة واحدة ونقلها لفريق آخر."
say "📌 نفس المهمة وحالتها تبقى محفوظة عند إعادة الإسناد."
say "🛟 Backup: $BACKUP"
say "الخطوة التالية: ./ops/botctl.sh restart ثم node scripts/deploy.js"
