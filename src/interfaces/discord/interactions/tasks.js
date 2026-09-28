import fs from 'node:fs';
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonStyle,
  FileUploadBuilder,
  LabelBuilder,
} from 'discord.js';
import {e,btn,rowsFromButtons,stringSelect,userSelect,withNavigation} from '../ui.js';
import {subjectFromInteraction} from '../context.js';
import {guildMemberOptions,pickerMenuPage,pickerPageValue,pickerSearchValue} from '../guildPicker.js';
import {filterMemberOptions,getMemberSearch,setMemberSearch,clearMemberSearch,memberSearchModal,memberSearchRows,searchSummary} from '../memberSearch.js';
import {setSmartMemberContext,smartMemberHint} from '../smartMemberSearch.js';
import {parseLocalDateTime,formatDate} from '../../../utils/time.js';
import {taskDisplayStatus} from '../../../core/tasks/state.js';
import {AppError} from '../../../core/errors/AppError.js';

const input=(id,label,style=TextInputStyle.Short,required=true)=>new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required)
);
const statusAr={
  pending:'لم يبدأ',in_progress:'قيد التنفيذ',done:'مكتمل ومعتمد',cancelled:'ملغي',overdue:'متأخر',
  submitted:'بانتظار المراجعة',rejected:'أعيد للتعديل',
};
const periodAr={week:'أسبوعي',month:'شهري'};
// Operations 967 v1.10.12 — Task Center + Post-Meeting Assignments.

async function standaloneCanManage(a,s,teamId){
  if(a.permissionService.isOwner?.(s.userId)) return true;
  if(await a.permissionService.has(s,'tasks.manage',{teamId})) return true;

  // "مساند X" inherits operational task management from X.
  const team=await a.teams.get(teamId);
  if(!team) return false;
  const parentName=String(team.name??'').trim();
  const teams=await a.teams.list(s.guildId);
  for(const support of teams){
    const name=String(support.name??'').trim();
    if(/^\s*مساند\s+/u.test(name) && name.replace(/^\s*مساند\s+/u,'').trim()===parentName){
      if(await a.permissionService.has(s,'tasks.manage',{teamId:support.id})) return true;
    }
  }
  return false;
}

function isSupportTeam(team){
  return /^\s*مساند\s+/u.test(String(team?.name??'').trim());
}

function supportParentName(team){
  return String(team?.name??'').trim().replace(/^\s*مساند\s+/u,'').trim();
}

async function taskTeamDirectory(a,s){
  const teams=(await a.teams.list(s.guildId)).filter(t=>!t.deleted_at&&t.active!==false);
  return {teams,mains:teams.filter(t=>!isSupportTeam(t))};
}

async function taskTeamSupports(a,s,mainTeamId){
  const {teams}=await taskTeamDirectory(a,s);
  const main=teams.find(t=>String(t.id)===String(mainTeamId));
  if(!main) return [];
  const parent=String(main.name??'').trim();
  return teams.filter(t=>isSupportTeam(t)&&supportParentName(t)===parent);
}

async function taskOperationalMemberRows(a,s,teamId){
  const base=await a.teams.members(teamId);
  const supports=await taskTeamSupports(a,s,teamId);
  const extra=[];
  for(const support of supports) extra.push(...await a.teams.members(support.id));
  const seen=new Set();
  return [...base,...extra].filter(x=>{
    const id=String(x.user_id);
    if(seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function standaloneTaskTeamPicker(i,a,s,page=0){
  const {mains}=await taskTeamDirectory(a,s);
  const allowed=[];
  for(const team of mains){
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
      'الصلاحية المطلوبة: **tasks.manage** على الفريق أو فريقه المساند.',
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

  // Modal submissions are already acknowledged by interactionReliability.
  // Render the next picker using editReply through the safe interaction.
  return standaloneAssigneePicker(i,a,s,d.teamId,0,false);
}

async function standaloneAssigneePicker(i,a,s,teamId,page=0,update=false){
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إضافة مهام لهذا الفريق.');
  const team=await a.teams.get(teamId);
  if(!team||String(team.guild_id)!==String(s.guildId)||team.deleted_at) throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');

  const members=await taskOperationalMemberRows(a,s,teamId);
  if(!members.length) throw new AppError('NO_MEMBERS','لا يوجد أعضاء في الفريق أو الفريق المساند له لإسناد هذه المهمة.');

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

  const members=await taskOperationalMemberRows(a,s,teamId);
  if(!members.some(x=>String(x.user_id)===String(i.values[0]))) throw new AppError('ASSIGNEE_TEAM','المكلّف يجب أن يكون عضوًا في الفريق أو في الفريق المساند له.');

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
  const {mains}=await taskTeamDirectory(a,s);
  const allowed=[];
  for(const team of mains){
    if(await standaloneCanManage(a,s,team.id)) allowed.push(team);
  }
  return allowed;
}

async function reassignMemberOptions(a,s,teamId){
  const team=await a.teams.get(teamId);
  if(!team||String(team.guild_id)!==String(s.guildId)||team.deleted_at) throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');
  const members=await taskOperationalMemberRows(a,s,teamId);
  if(!members.length) throw new AppError('NO_MEMBERS','لا يوجد أعضاء في الفريق أو الفريق المساند له.');

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
  if(!canManage&&!await standaloneCanManage(a,s,task.team_id)) throw new AppError('FORBIDDEN','ليس لديك صلاحية تعديل هذا التكليف.');

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

  if(!await standaloneCanManage(a,s,task.team_id)) throw new AppError('FORBIDDEN','ليس لديك صلاحية تعديل هذا التكليف.');
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
  if(!await standaloneCanManage(a,s,task.team_id)) throw new AppError('FORBIDDEN','ليس لديك صلاحية تعديل هذا التكليف.');

  await a.taskService.reassignTask({
    guildId:s.guildId,taskId,targetTeamId:teamId,
    targetAssigneeUserId:i.values[0],actorId:s.userId
  });
  return openTask(i,a,s,taskId);
}

/* ---------- Group task: replace multiple people and/or target team ---------- */
async function reassignGroupCanManage(a,s,group){
  if(a.permissionService.isOwner?.(s.userId)) return true;
  if(await standaloneCanManage(a,s,group.origin_team_id)) return true;
  return Boolean(await standaloneCanManage(a,s,group.target_team_id));
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

  const pager=[];
  if(safe>0) pager.push(btn('task:reassign-group-team-page:'+String(groupId)+':'+String(safe-1),'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safe+1<pages) pager.push(btn('task:reassign-group-team-page:'+String(groupId)+':'+String(safe+1),'التالي',ButtonStyle.Secondary,'➡️'));

  const components=[stringSelect('task:reassign-group-team-select:'+String(groupId),'اختر الفريق الجديد',slice.map(t=>({
    label:String(t.name).slice(0,100),
    description:String(t.id)===String(group.target_team_id)?'الفريق الحالي':'فريق جديد',
    value:String(t.id)
  })))];
  if(pager.length) components.push(...rowsFromButtons(pager));

  return i.update({
    embeds:[e('👥 تبديل مجموعة التكليف',[
      '**التكليف:** '+String(group.title),
      '**عدد المكلّفين الحاليين:** **'+String(tasks.length)+'**',
      '**الفريق الحالي:** '+String(group.target_team_name??'غير محدد'),
      '',
      'اختر الفريق الجديد ثم اختر نفس عدد المكلّفين.',
    ].join('\n'))],
    components:withNavigation(components,'admin:tasks'),
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
      stringSelect(
        'task:reassign-group-members:'+String(groupId)+':'+String(teamId),
        'اختر المكلّفين الجدد — المطلوب '+String(needed),
        options,needed,needed
      )
    ],'task:reassign-group:'+String(groupId)),
  });
}

async function reassignGroupMembersSubmit(i,a,s,groupId,teamId){
  const group=await a.tasks.getGroup(groupId);
  if(!group) throw new AppError('TASK_GROUP_NOT_FOUND','مجموعة التكليف غير موجودة.');
  if(!await reassignGroupCanManage(a,s,group)) throw new AppError('FORBIDDEN','ليس لديك صلاحية تعديل مجموعة التكليف.');

  await a.taskService.reassignTaskGroup({
    guildId:s.guildId,groupId,targetTeamId:teamId,
    targetAssigneeUserIds:i.values,actorId:s.userId
  });

  const fresh=await a.tasks.getGroup(groupId);
  return i.update({
    embeds:[e('✅ تمت إعادة إسناد المجموعة',[
      '**التكليف:** '+String(fresh?.title??group.title),
      '**الفريق الجديد:** '+String(fresh?.target_team_name??'غير محدد'),
      'تم استبدال المكلّفين مع بقاء المهام نفسها وحالاتها.',
    ].join('\n'))],
    components:withNavigation([],'admin:tasks'),
  });
}

export async function handleTasks(i,a){
  const id=i.customId??'';

  // Search selections must open a modal before the automatic interaction defer.
  if(i.isAnySelectMenu?.()&&pickerSearchValue(i.values?.[0])&&id.startsWith('task:assign-submit:')){
    const meetingId=id.split(':')[2];
    const current=getMemberSearch(a,i.user.id,`task:assign:${meetingId}`);
    return i.showModal(memberSearchModal(`task:member-search-submit:assign:${meetingId}`,current,'بحث عن المكلّف'));
  }
  if(i.isAnySelectMenu?.()&&pickerSearchValue(i.values?.[0])&&id.startsWith('task:perf-submit:')){
    const period=id.split(':')[2];
    const current=getMemberSearch(a,i.user.id,`task:perf:${period}`);
    return i.showModal(memberSearchModal(`task:member-search-submit:perf:${period}`,current,'بحث عن عضو للتقييم'));
  }
  if(id.startsWith('task:member-search:')){
    const parts=id.split(':');
    const mode=parts[2];
    const key=parts[3];
    const context=mode==='perf'?`task:perf:${key}`:`task:assign:${key}`;
    const title=mode==='perf'?'بحث عن عضو للتقييم':'بحث عن المكلّف';
    const current=getMemberSearch(a,i.user.id,context);
    return i.showModal(memberSearchModal(`task:member-search-submit:${mode}:${key}`,current,title));
  }

  // These buttons open modals and are intentionally handled before subjectFromInteraction's normal flow.
  if(id.startsWith('task:submit:')&&!id.startsWith('task:submit-save:')) return submissionModal(i,id.split(':')[2]);
  if(id.startsWith('task:reject:')&&!id.startsWith('task:reject-save:')) return rejectionModal(i,id.split(':')[2]);
  if(id.startsWith('task:live-details:')&&!id.startsWith('task:live-details-save:')) return liveDetailsModal(i,a,id.split(':')[2]);

  const s=await subjectFromInteraction(i,a.env);
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


  if(id.startsWith('task:member-search-submit:')){
    const parts=id.split(':'); const mode=parts[3], key=parts[4];
    const context=mode==='perf'?`task:perf:${key}`:`task:assign:${key}`;
    setMemberSearch(a,s.userId,context,i.fields.getTextInputValue('query').trim());
    return mode==='perf'?performancePicker(i,a,s,key,0,true):assigneePicker(i,a,s,key,0,true);
  }
  if(id.startsWith('task:member-search-clear:')){
    const parts=id.split(':'); const mode=parts[3], key=parts[4];
    const context=mode==='perf'?`task:perf:${key}`:`task:assign:${key}`;
    clearMemberSearch(a,s.userId,context);
    return mode==='perf'?performancePicker(i,a,s,key,0,true):assigneePicker(i,a,s,key,0,true);
  }

  if(id.startsWith('task:live-add:'))return liveTaskStart(i,a,s,id.split(':')[2]);
  if(id.startsWith('task:live-refresh:'))return liveTaskRefresh(i,a,s,id.split(':')[2]);
  if(id.startsWith('task:live-mode:')){const p=id.split(':');return liveTaskMode(i,a,s,p[2],p[3]);}
  if(id.startsWith('task:live-target:'))return liveTaskTarget(i,a,s,id.split(':')[2]);
  if(id.startsWith('task:live-details-save:'))return liveTaskDetailsSave(i,a,s,id.split(':')[2]);
  if(id.startsWith('task:live-assignees:'))return liveTaskAssignees(i,a,s,id.split(':')[2]);

  // Operations 967 v1.10.12 — task center / post-meeting assignments.
  if(id==='task:add-meeting')return meetingTaskPicker(i,a,s,0);
  if(id.startsWith('task:add-meeting-page:'))return meetingTaskPicker(i,a,s,Number(id.split(':')[2]||0));
  if(id==='task:add-meeting-select')return liveTaskStart(i,a,s,i.values[0]);
  if(id.startsWith('task:all-page:'))return allTasksView(i,a,s,Number(id.split(':')[2]||0));
  if(id.startsWith('task:assignees-page:'))return assigneesView(i,a,s,Number(id.split(':')[2]||0));
  if(id==='task:assignee-select')return assigneeTasksView(i,a,s,i.values[0],0);
  if(id.startsWith('task:assignee-page:')){const p=id.split(':');return assigneeTasksView(i,a,s,p[2],Number(p[3]||0));}
  if(id==='task:filter')return adminTasks(i,a,s,i.values[0]);

  if(id==='admin:tasks')return adminTasks(i,a,s);
  if(id==='member:tasks')return memberTasks(i,a,s);
  if(id==='task:review-queue')return reviewQueue(i,a,s);
  if(id.startsWith('task:performance:self:'))return generateSelfPerformance(i,a,s,id.split(':')[3]);
  if(id.startsWith('task:perf-pick:'))return performancePicker(i,a,s,id.split(':')[2],0,true);
  if(id.startsWith('task:perf-page:')){const p=id.split(':');return performancePicker(i,a,s,p[2],Number(p[3]||0),true);}
  if(id.startsWith('task:perf-submit:')){
    const period=id.split(':')[2];const page=pickerPageValue(i.values?.[0]);
    if(page!==null)return performancePicker(i,a,s,period,page,true);
    return generatePerformanceFor(i,a,s,period,i.values[0]);
  }

  if(id.startsWith('meeting:task:')&&!id.startsWith('meeting:task-submit:'))return taskModal(i,a,s,id.split(':')[2]);
  if(id.startsWith('meeting:task-submit:'))return taskModalSubmit(i,a,s,id.split(':')[2]);
  if(id.startsWith('task:assign-page:')){const p=id.split(':');return assigneePicker(i,a,s,p[2],Number(p[3]||0),true);}
  if(id.startsWith('task:assign-submit:')){const meetingId=id.split(':')[2];const page=pickerPageValue(i.values?.[0]);if(page!==null)return assigneePicker(i,a,s,meetingId,page,true);return assigneeSubmit(i,a,s,meetingId);}
  if(id==='task:open')return openTask(i,a,s,i.values[0]);
  if(id.startsWith('task:view:'))return openTask(i,a,s,id.split(':')[2]);
  if(id.startsWith('task:status:')){const p=id.split(':');return setStatus(i,a,s,p[2],p[3]);}
  if(id.startsWith('task:submit-save:'))return submitTask(i,a,s,id.split(':')[3]);
  if(id.startsWith('task:approve:'))return approveTask(i,a,s,id.split(':')[2]);
  if(id.startsWith('task:reject-save:'))return rejectTask(i,a,s,id.split(':')[3]);
  if(id.startsWith('task:files:'))return sendSubmissionFiles(i,a,s,id.split(':')[2]);
  return false;
}


// Operations 967 v1.10.12 — task-center-post-meeting.
const taskUiStatus=(task)=>{
  if(task?.review_status==='submitted')return 'submitted';
  if(task?.review_status==='rejected')return 'rejected';
  return taskDisplayStatus(task);
};

async function canAuthorMeetingTask(a,s,meeting){
  if(!meeting)return false;
  if(a.permissionService.isOwner?.(s.userId))return true;
  return Boolean(
    await a.permissionService.has(s,'tasks.manage',{teamId:meeting.team_id,meetingId:meeting.id})
    || await a.permissionService.has(s,'tasks.review',{teamId:meeting.team_id,meetingId:meeting.id})
    || await a.permissionService.has(s,'meetings.lead',{teamId:meeting.team_id,meetingId:meeting.id})
  );
}

async function assertMeetingLeader(a,s,meeting){
  if(!meeting)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');
  if(!await canAuthorMeetingTask(a,s,meeting)){
    throw new AppError('FORBIDDEN','إضافة المهام متاحة للمالك، أو من لديه إدارة/مراجعة المهام، أو قائد الاجتماع ضمن نطاق هذا الاجتماع.');
  }
  return true;
}

function assertMeetingTaskWindow(meeting){
  if(!['ongoing','ended'].includes(String(meeting?.status??''))){
    throw new AppError('MEETING_TASK_WINDOW','يمكن إضافة التكليف أثناء الاجتماع الجاري أو بعد انتهائه فقط.');
  }
}

async function visibleAdminTasks(a,s){
  const isOwner=Boolean(a.permissionService.isOwner?.(s.userId));
  const canView=isOwner||await a.permissionService.hasPotential(s,'tasks.view');
  const canManage=isOwner||await a.permissionService.hasPotential(s,'tasks.manage');
  const canReview=isOwner||await a.permissionService.hasPotential(s,'tasks.review');
  const canPerf=isOwner||await a.permissionService.hasPotential(s,'performance.view');
  const canLead=isOwner||await a.permissionService.hasPotential(s,'meetings.lead');
  if(!canView&&!canManage&&!canReview&&!canPerf&&!canLead){
    throw new AppError('FORBIDDEN','ليس لديك صلاحية للوصول إلى المهام والتقييم.');
  }

  const all=await a.tasks.listForGuild(s.guildId,{limit:isOwner?1000:250});
  if(isOwner)return {isOwner,canView,canManage,canReview,canPerf,canLead,tasks:all};

  const tasks=[];
  for(const t of all){
    if((canView&&await a.permissionService.has(s,'tasks.view',{teamId:t.team_id,meetingId:t.meeting_id}))
      ||(canManage&&await a.permissionService.has(s,'tasks.manage',{teamId:t.team_id,meetingId:t.meeting_id}))
      ||(canReview&&await a.permissionService.has(s,'tasks.review',{teamId:t.team_id,meetingId:t.meeting_id}))
      ||(canLead&&t.meeting_id&&await a.permissionService.has(s,'meetings.lead',{teamId:t.meeting_team_id??t.team_id,meetingId:t.meeting_id}))){
      tasks.push(t);
    }
  }
  return {isOwner,canView,canManage,canReview,canPerf,canLead,tasks};
}

async function meetingTaskPicker(i,a,s,page=0){
  const isOwner=Boolean(a.permissionService.isOwner?.(s.userId));
  const all=await a.meetings.listForGuild(s.guildId,{statuses:['ongoing','ended'],limit:isOwner?250:100});
  const allowed=[];
  for(const meeting of all){
    if(await canAuthorMeetingTask(a,s,meeting))allowed.push(meeting);
  }
  if(!allowed.length)throw new AppError('NO_MEETINGS','لا توجد اجتماعات جارية أو منتهية يمكنك إضافة مهام مرتبطة بها.');

  const pageSize=20;
  const pages=Math.max(1,Math.ceil(allowed.length/pageSize));
  const safePage=Math.max(0,Math.min(Number(page)||0,pages-1));
  const slice=allowed.slice(safePage*pageSize,(safePage+1)*pageSize);
  const components=[
    stringSelect('task:add-meeting-select','اختر الاجتماع الذي خرجت منه المهمة',slice.map(m=>({
      label:String(m.name??'اجتماع').slice(0,100),
      description:`${m.team_name??'الفريق'} • ${m.status==='ended'?'منتهي':'جاري'}`.slice(0,100),
      value:String(m.id),
    }))),
  ];
  const pager=[];
  if(safePage>0)pager.push(btn(`task:add-meeting-page:${safePage-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safePage+1<pages)pager.push(btn(`task:add-meeting-page:${safePage+1}`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length)components.push(...rowsFromButtons(pager));

  return i.update({
    embeds:[e('➕ إضافة مهمة مرتبطة باجتماع',[
      'اختر الاجتماع أولًا، حتى تُحفظ المهمة داخله وتظهر مع اسمه في المتابعة والأرشيف.',
      '',
      'يمكن استخدام اجتماع **جارٍ** أو اجتماع **منتهي** إذا نُسيت المهمة وقت الاجتماع.',
      `الصفحة **${safePage+1}/${pages}** — الاجتماعات المتاحة: **${allowed.length}**`,
    ].join('\n'))],
    components:withNavigation(components,'admin:tasks'),
  });
}

async function allTasksView(i,a,s,page=0){
  const access=await visibleAdminTasks(a,s);
  const tasks=access.tasks;
  const pageSize=15;
  const pages=Math.max(1,Math.ceil(tasks.length/pageSize));
  const safePage=Math.max(0,Math.min(Number(page)||0,pages-1));
  const slice=tasks.slice(safePage*pageSize,(safePage+1)*pageSize);
  const settings=await a.guilds.getSettings(s.guildId);
  const lines=slice.map(t=>[
    `• **${t.title}**`,
    `  👤 <@${t.assignee_user_id}> • 🏢 ${t.team_name}`,
    `  🗓️ ${t.meeting_name??'غير مرتبط باجتماع'} • **${statusAr[taskUiStatus(t)]??taskUiStatus(t)}**${t.due_at?` • ${formatDate(t.due_at,settings.timezone)}`:''}`,
  ].join('\n'));

  const components=[];
  if(slice.length)components.push(stringSelect('task:open','فتح مهمة من هذه الصفحة',slice.map(t=>({
    label:String(t.title).slice(0,100),
    description:`${t.assignee_name??t.assignee_user_id} • ${t.team_name}`.slice(0,100),
    value:String(t.id),
  }))));
  const pager=[];
  if(safePage>0)pager.push(btn(`task:all-page:${safePage-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safePage+1<pages)pager.push(btn(`task:all-page:${safePage+1}`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length)components.push(...rowsFromButtons(pager));

  return i.update({
    embeds:[e('📋 جميع المهام',`${lines.join('\n\n')||'لا توجد مهام ضمن نطاقك.'}\n\nالصفحة **${safePage+1}/${pages}** • الإجمالي: **${tasks.length}**`)],
    components:withNavigation(components,'admin:tasks'),
  });
}

async function assigneesView(i,a,s,page=0){
  const {tasks}=await visibleAdminTasks(a,s);
  const grouped=new Map();
  for(const task of tasks){
    const id=String(task.assignee_user_id);
    const row=grouped.get(id)??{id,name:task.assignee_name??id,total:0,open:0,review:0,overdue:0,done:0,meetings:new Set()};
    row.total+=1;
    if(['pending','in_progress'].includes(task.status))row.open+=1;
    if(task.review_status==='submitted')row.review+=1;
    if(taskDisplayStatus(task)==='overdue')row.overdue+=1;
    if(task.status==='done')row.done+=1;
    if(task.meeting_id)row.meetings.add(String(task.meeting_id));
    grouped.set(id,row);
  }
  const members=[...grouped.values()].sort((x,y)=>y.open-x.open||y.review-x.review||y.total-x.total||String(x.name).localeCompare(String(y.name),'ar'));
  const pageSize=20;
  const pages=Math.max(1,Math.ceil(members.length/pageSize));
  const safePage=Math.max(0,Math.min(Number(page)||0,pages-1));
  const slice=members.slice(safePage*pageSize,(safePage+1)*pageSize);
  const lines=slice.map(x=>`• <@${x.id}> — **${x.total}** مهام | مفتوحة ${x.open} | مراجعة ${x.review} | متأخرة ${x.overdue} | اجتماعات ${x.meetings.size}`);
  const components=[];
  if(slice.length)components.push(stringSelect('task:assignee-select','اختر عضوًا لعرض جميع مهامه',slice.map(x=>({
    label:String(x.name).slice(0,100),
    description:`${x.total} مهام • مفتوحة ${x.open} • متأخرة ${x.overdue}`.slice(0,100),
    value:x.id,
  }))));
  const pager=[];
  if(safePage>0)pager.push(btn(`task:assignees-page:${safePage-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safePage+1<pages)pager.push(btn(`task:assignees-page:${safePage+1}`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length)components.push(...rowsFromButtons(pager));

  return i.update({
    embeds:[e('👥 الأعضاء الذين لديهم مهام',`${lines.join('\n')||'لا يوجد أعضاء عليهم مهام ضمن نطاقك.'}\n\nالصفحة **${safePage+1}/${pages}** • الأعضاء المكلّفون: **${members.length}**`)],
    components:withNavigation(components,'admin:tasks'),
  });
}

async function assigneeTasksView(i,a,s,userId,page=0){
  const {tasks}=await visibleAdminTasks(a,s);
  const mine=tasks.filter(t=>String(t.assignee_user_id)===String(userId));
  const name=mine[0]?.assignee_name??String(userId);
  const pageSize=15;
  const pages=Math.max(1,Math.ceil(mine.length/pageSize));
  const safePage=Math.max(0,Math.min(Number(page)||0,pages-1));
  const slice=mine.slice(safePage*pageSize,(safePage+1)*pageSize);
  const settings=await a.guilds.getSettings(s.guildId);
  const lines=slice.map(t=>`• **${t.title}** — ${t.team_name}\n  🗓️ **${t.meeting_name??'غير مرتبط باجتماع'}** • ${statusAr[taskUiStatus(t)]??taskUiStatus(t)}${t.due_at?` • ${formatDate(t.due_at,settings.timezone)}`:''}`);
  const components=[];
  if(slice.length)components.push(stringSelect('task:open','فتح مهمة',slice.map(t=>({
    label:String(t.title).slice(0,100),
    description:`${t.team_name} • ${t.meeting_name??'بدون اجتماع'}`.slice(0,100),
    value:String(t.id),
  }))));
  const pager=[];
  if(safePage>0)pager.push(btn(`task:assignee-page:${userId}:${safePage-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safePage+1<pages)pager.push(btn(`task:assignee-page:${userId}:${safePage+1}`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length)components.push(...rowsFromButtons(pager));
  components.push(...rowsFromButtons([btn('task:assignees-page:0','كل الأعضاء',ButtonStyle.Secondary,'👥')]));

  return i.update({
    embeds:[e(`👤 مهام ${String(name).slice(0,180)}`,`${lines.join('\n\n')||'لا توجد مهام لهذا العضو ضمن نطاقك.'}\n\nالإجمالي: **${mine.length}** • الصفحة **${safePage+1}/${pages}**`)],
    components:withNavigation(components,'admin:tasks'),
  });
}

const liveDraftKey=(userId,meetingId)=>`task-live:${userId}:${meetingId}`;

async function liveTaskStart(i,a,s,meetingId){
  const meeting=await a.meetings.get(meetingId);await assertMeetingLeader(a,s,meeting);
  assertMeetingTaskWindow(meeting);
  a.drafts.set(liveDraftKey(s.userId,meetingId),{meetingId,originTeamId:meeting.team_id});
  const sourceText=meeting.status==='ended'?'📌 **إضافة تكليف لاحق لاجتماع منتهي**\nسيبقى التكليف مرتبطًا بهذا الاجتماع في المتابعة والأرشيف.':'📌 **إنشاء تكليف من الاجتماع الجاري**';
  return i.editReply({content:`${sourceText}\nاختر طريقة الإسناد:`,embeds:[],components:rowsFromButtons([
    btn(`task:live-mode:${meetingId}:member`,'عضو واحد',ButtonStyle.Primary,'👤'),
    btn(`task:live-mode:${meetingId}:members`,'عدة أعضاء',ButtonStyle.Secondary,'👥'),
    btn(`task:live-mode:${meetingId}:team`,'فريق كامل',ButtonStyle.Secondary,'🏢'),
  ])});
}

async function liveTaskMode(i,a,s,meetingId,mode){
  if(!['member','members','team'].includes(mode))throw new AppError('TASK_ASSIGNMENT_MODE','نوع الإسناد غير صالح.');
  const meeting=await a.meetings.get(meetingId);await assertMeetingLeader(a,s,meeting);
  assertMeetingTaskWindow(meeting);
  const teams=await a.teams.list(s.guildId);if(!teams.length)throw new AppError('NO_TEAMS','لا توجد فرق نشطة.');
  a.drafts.set(liveDraftKey(s.userId,meetingId),{meetingId,originTeamId:meeting.team_id,mode});
  return i.editReply({content:`اختر **الفريق الذي ستُسند إليه المهمة**. يمكن أن يكون فريق الاجتماع نفسه أو فريقًا آخر:`,embeds:[],components:[
    stringSelect(`task:live-target:${meetingId}`,'الفريق المكلّف',teams.map(t=>({label:t.name.slice(0,100),value:String(t.id)}))),
  ]});
}

async function liveTaskTarget(i,a,s,meetingId){
  const meeting=await a.meetings.get(meetingId);await assertMeetingLeader(a,s,meeting);
  const key=liveDraftKey(s.userId,meetingId);const draft=a.drafts.get(key);if(!draft?.mode)throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء التكليف. ابدأ من لوحة الاجتماع من جديد.');
  const targetTeam=await a.teams.get(i.values[0]);if(!targetTeam||String(targetTeam.guild_id)!==String(s.guildId))throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');
  a.drafts.set(key,{...draft,targetTeamId:targetTeam.id,targetTeamName:targetTeam.name});
  const modeText=draft.mode==='team'?'فريق كامل':draft.mode==='members'?'عدة أعضاء':'عضو واحد';
  return i.editReply({content:`✅ الفريق: **${targetTeam.name}**\nنوع الإسناد: **${modeText}**\n\nالآن أدخل عنوان المهمة وتعليماتها وموعدها.`,embeds:[],components:rowsFromButtons([btn(`task:live-details:${meetingId}`,'إدخال تفاصيل المهمة',ButtonStyle.Primary,'📝')])});
}

function liveDetailsModal(i,a,meetingId){
  const draft=a.drafts.get(liveDraftKey(i.user.id,meetingId));if(!draft?.targetTeamId)throw new AppError('DRAFT_EXPIRED','ابدأ إنشاء التكليف من لوحة مهام الاجتماع أولًا.');
  const modal=new ModalBuilder().setCustomId(`task:live-details-save:${meetingId}`).setTitle('تكليف من قائد الاجتماع').addComponents(
    input('title','عنوان المهمة'),
    input('description','التعليمات والتفاصيل',TextInputStyle.Paragraph,true),
    input('due','موعد الانتهاء YYYY-MM-DD HH:mm',TextInputStyle.Short,false),
  );
  return i.showModal(modal);
}

async function liveTaskDetailsSave(i,a,s,meetingId){
  const meeting=await a.meetings.get(meetingId);await assertMeetingLeader(a,s,meeting);
  assertMeetingTaskWindow(meeting);
  const key=liveDraftKey(s.userId,meetingId);const draft=a.drafts.get(key);if(!draft?.targetTeamId||!draft?.mode)throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء التكليف. ابدأ من جديد.');
  const settings=await a.guilds.getSettings(s.guildId);const rawDue=i.fields.getTextInputValue('due').trim();
  const dueAt=rawDue?parseLocalDateTime(rawDue,settings.timezone):null;
  const updated={...draft,title:i.fields.getTextInputValue('title').trim(),description:i.fields.getTextInputValue('description').trim(),dueAt};
  a.drafts.set(key,updated);
  if(updated.mode==='team'){
    const result=await a.taskService.createAssignmentGroup({guildId:s.guildId,meetingId,targetTeamId:updated.targetTeamId,assignmentMode:'team',title:updated.title,description:updated.description,dueAt:updated.dueAt,actorId:s.userId,guild:s.guild});
    a.drafts.delete(key);
    const endedNote=meeting.status==='ended'?'\n🗓️ تم ربط المهمة بالاجتماع السابق. إذا كان التقرير الرسمي قد وُلد قبل هذه الإضافة فأعد توليده ليظهر التكليف الجديد.':'';
    return i.editReply({content:`✅ تم إنشاء **${result.group.title}** وتكليف فريق **${result.group.target_team_name}** كاملًا (${result.tasks.length} عضو/أعضاء).\nتم نشر بطاقة المتابعة في دردشة القناة الصوتية وقناة الفريق، وإرسال الخاص حسب إعدادات التسليم.${endedNote}`,embeds:[],components:[]});
  }
  const max=updated.mode==='members'?25:1;
  return i.editReply({content:`اختر ${updated.mode==='members'?'الأعضاء المكلّفين (حتى 25 عضوًا)':'العضو المكلّف'} من **${updated.targetTeamName}**.\nسيتم التحقق تلقائيًا أن كل شخص تختاره عضو في الفريق.`,embeds:[],components:[userSelect(`task:live-assignees:${meetingId}`,updated.mode==='members'?'اختر الأعضاء المكلّفين':'اختر العضو المكلّف',1,max)]});
}

async function liveTaskAssignees(i,a,s,meetingId){
  const meeting=await a.meetings.get(meetingId);await assertMeetingLeader(a,s,meeting);
  assertMeetingTaskWindow(meeting);
  const key=liveDraftKey(s.userId,meetingId);const draft=a.drafts.get(key);if(!draft?.targetTeamId||!draft?.title||!['member','members'].includes(draft.mode))throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء التكليف. ابدأ من جديد.');
  const result=await a.taskService.createAssignmentGroup({guildId:s.guildId,meetingId,targetTeamId:draft.targetTeamId,assignmentMode:draft.mode,assigneeUserIds:i.values,title:draft.title,description:draft.description,dueAt:draft.dueAt,actorId:s.userId,guild:s.guild});
  a.drafts.delete(key);
  const endedNote=meeting.status==='ended'?'\n🗓️ تم ربط المهمة بالاجتماع السابق. إذا كان التقرير الرسمي قد وُلد قبل هذه الإضافة فأعد توليده ليظهر التكليف الجديد.':'';
  return i.editReply({content:`✅ تم إنشاء **${result.group.title}** وإسنادها إلى **${result.tasks.length}** مكلّف/مكلّفين في **${result.group.target_team_name}**.\nبطاقة المتابعة ستتحدث تلقائيًا مع: لم يبدأ / قيد التنفيذ / بانتظار المراجعة / مكتمل.${endedNote}`,embeds:[],components:[]});
}

async function liveTaskRefresh(i,a,s,meetingId){
  const meeting=await a.meetings.get(meetingId);if(!meeting)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');
  const canView=await a.permissionService.has(s,'meetings.view',{teamId:meeting.team_id,meetingId:meeting.id});
  const canLead=await a.permissionService.has(s,'meetings.lead',{teamId:meeting.team_id,meetingId:meeting.id});
  const canManage=await a.permissionService.has(s,'tasks.manage',{teamId:meeting.team_id,meetingId:meeting.id});
  if(!canView&&!canLead&&!canManage)throw new AppError('FORBIDDEN','ليس لديك صلاحية عرض هذا الاجتماع.');
  await a.taskService.refreshMeetingBoard(meetingId,s.guild);
  return i.editReply({content:'✅ تم تحديث لوحة مهام الاجتماع في دردشة القناة الصوتية.',embeds:[],components:[]});
}

async function adminTasks(i,a,s,filter='all'){
  const access=await visibleAdminTasks(a,s);
  const settings=await a.guilds.getSettings(s.guildId);
  const visible=access.tasks;
  const open=visible.filter(t=>['pending','in_progress'].includes(t.status));
  const overdue=open.filter(t=>taskDisplayStatus(t)==='overdue').length;
  const waiting=visible.filter(t=>t.review_status==='submitted').length;
  const done=visible.filter(t=>t.status==='done').length;
  const assignees=new Set(visible.map(t=>String(t.assignee_user_id))).size;
  const shown=filter==='all'?visible:visible.filter(t=>taskUiStatus(t)===filter);
  const lines=shown.slice(0,10).map(t=>`• **${t.title}** — <@${t.assignee_user_id}> — **${statusAr[taskUiStatus(t)]??taskUiStatus(t)}**\n  🏢 ${t.team_name} • 🗓️ ${t.meeting_name??'غير مرتبط باجتماع'}${t.due_at?` • ${formatDate(t.due_at,settings.timezone)}`:''}`);

  const decisionsAll=(access.canView||access.canManage||access.isOwner)?await a.meetings.listDecisionsForGuild(s.guildId,{limit:30}):[];
  const decisions=[];
  if(access.isOwner)decisions.push(...decisionsAll);
  else{
    for(const d of decisionsAll){
      if((access.canView&&await a.permissionService.has(s,'tasks.view',{teamId:d.team_id,meetingId:d.meeting_id}))
        ||(access.canManage&&await a.permissionService.has(s,'tasks.manage',{teamId:d.team_id,meetingId:d.meeting_id})))decisions.push(d);
    }
  }
  const decisionLines=decisions.slice(0,4).map(d=>`• ${d.decision_text} — **${d.team_name}** / ${d.meeting_name}`);

  const components=[];
  const buttons=[
    btn('task:all-page:0',`جميع المهام (${visible.length})`,ButtonStyle.Secondary,'📋'),
    btn('task:assignees-page:0',`الأعضاء المكلفون (${assignees})`,ButtonStyle.Secondary,'👥'),
  ];
  if(access.isOwner||access.canManage||access.canReview||access.canLead){
    buttons.unshift(btn('task:add-standalone','إضافة مهمة مستقلة',ButtonStyle.Success,'📝'));
    buttons.unshift(btn('task:add-meeting','إضافة مهمة من اجتماع',ButtonStyle.Success,'➕'));
    buttons.push(btn('task:review-queue',`مراجعة التسليمات (${waiting})`,ButtonStyle.Primary,'📥'));
  }
  if(access.canPerf){
    buttons.push(btn('task:perf-pick:week','تقييم أسبوعي',ButtonStyle.Secondary,'📊'));
    buttons.push(btn('task:perf-pick:month','تقييم شهري',ButtonStyle.Secondary,'📈'));
  }
  components.push(...rowsFromButtons(buttons));
  components.push(stringSelect('task:filter','فلترة عرض المهام',[
    {label:'جميع المهام',value:'all'},
    {label:'لم تبدأ',value:'pending'},
    {label:'قيد التنفيذ',value:'in_progress'},
    {label:'بانتظار المراجعة',value:'submitted'},
    {label:'مكتملة ومعتمدة',value:'done'},
    {label:'متأخرة',value:'overdue'},
    {label:'معادة للتعديل',value:'rejected'},
    {label:'ملغاة',value:'cancelled'},
  ].map(x=>({...x,default:x.value===filter}))));
  if(shown.length)components.push(stringSelect('task:open','فتح مهمة',shown.slice(0,25).map(t=>({
    label:String(t.title).slice(0,100),
    description:`${t.assignee_name??t.assignee_user_id} • ${t.team_name} • ${statusAr[taskUiStatus(t)]??taskUiStatus(t)}`.slice(0,100),
    value:String(t.id),
  }))));

  const description=[
    `**الإجمالي:** **${visible.length}** مهمة • **الأعضاء المكلّفون:** **${assignees}**`,
    `**المفتوحة:** **${open.length}** • **بانتظار المراجعة:** **${waiting}** • **المتأخرة:** **${overdue}** • **المكتملة:** **${done}**`,
    '',
    `**المهام ضمن العرض الحالي**`,
    lines.join('\n')||'لا توجد مهام ضمن الفلتر والنطاق الحالي.',
    '',
    '**آخر القرارات الرسمية**',
    decisionLines.join('\n')||'لا توجد قرارات مسجلة ضمن نطاقك.',
    '',
    '> يمكنك إضافة مهمة مرتبطة باجتماع جارٍ أو منتهي. المهمة المضافة بعد الاجتماع تبقى مرتبطة باسمه وتظهر ضمن قائمة العضو والمتابعة.',
  ].join('\n');

  return i.update({embeds:[e('📋 المهام والتقييم',description.slice(0,3900))],components:withNavigation(components)});
}

async function memberTasks(i,a,s){
  const settings=await a.guilds.getSettings(s.guildId);const tasks=await a.tasks.listForUser(s.guildId,s.userId,{limit:25});
  const lines=tasks.map(t=>`• **${t.title}** — ${t.team_name} — **${statusAr[taskDisplayStatus(t)]??taskDisplayStatus(t)}**${t.due_at?` — ${formatDate(t.due_at,settings.timezone)}`:''}`);
  const components=[...rowsFromButtons([
    btn('task:performance:self:week','تقييمي الأسبوعي',ButtonStyle.Secondary,'📊'),
    btn('task:performance:self:month','تقييمي الشهري',ButtonStyle.Secondary,'📈'),
  ])];
  if(tasks.length)components.push(stringSelect('task:open','فتح تكليف',tasks.map(t=>({label:t.title.slice(0,100),description:`${t.team_name} • ${statusAr[taskDisplayStatus(t)]??taskDisplayStatus(t)}`.slice(0,100),value:t.id}))));
    const points=await a.pointsService.profile(s.guildId,s.userId);
  const achievementLabels=points.achievements.map(row=>points.achievementDefinitions.find(x=>x.key===row.achievement_key)?.label).filter(Boolean);
  const pointsBlock=[
    `⭐ **النقاط:** ${points.balance.toLocaleString('en-US')}`,
    `🏅 **المستوى:** ${points.level.label}`,
    `📈 **هذا الأسبوع:** ${points.weeklyPoints>0?'+':''}${points.weeklyPoints} • **هذا الشهر:** ${points.monthlyPoints>0?'+':''}${points.monthlyPoints}`,
    `✅ **المهام المعتمدة:** ${points.completedTasks} • **الحضور:** ${points.attendedMeetings}`,
    achievementLabels.length?`🎖️ **الإنجازات:** ${achievementLabels.slice(0,4).join(' • ')}`:'🎖️ **الإنجازات:** لا توجد إنجازات مكتسبة بعد',
  ].join('\n');
return i.update({content:pointsBlock,embeds:[e('📌 تكليفاتي وتقييمي',`${lines.join('\n')||'لا توجد تكليفات مسندة إليك.'}\n\n> عند إنهاء المهمة افتحها ثم اختر **تسليم للمراجعة**. تستطيع إرفاق ملفات الإنجاز أو كتابة ملاحظة.`)],components:withNavigation(components)});
}

async function taskModal(i,a,s,meetingId){
  const m=await a.meetings.get(meetingId);if(!m)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');await a.permissionService.assert(s,'tasks.manage',{teamId:m.team_id,meetingId});
  const modal=new ModalBuilder().setCustomId(`meeting:task-submit:${meetingId}`).setTitle('إضافة تكليف').addComponents(input('title','عنوان التكليف'),input('due','الموعد النهائي YYYY-MM-DD HH:mm',TextInputStyle.Short,false),input('description','تفاصيل التكليف',TextInputStyle.Paragraph,false));return i.showModal(modal);
}
async function taskModalSubmit(i,a,s,meetingId){
  const m=await a.meetings.get(meetingId);if(!m)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');await a.permissionService.assert(s,'tasks.manage',{teamId:m.team_id,meetingId});const settings=await a.guilds.getSettings(s.guildId);const raw=i.fields.getTextInputValue('due').trim();
  a.drafts.set(`task-create:${s.userId}`,{meetingId,teamId:m.team_id,title:i.fields.getTextInputValue('title'),description:i.fields.getTextInputValue('description'),dueAt:raw?parseLocalDateTime(raw,settings.timezone):null});
  await i.deferReply({ephemeral:Boolean(i.guildId)});return assigneePicker(i,a,s,meetingId,0,false);
}
async function assigneePicker(i,a,s,meetingId,page=0,update=false){
  const m=await a.meetings.get(meetingId);if(!m)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');await a.permissionService.assert(s,'tasks.manage',{teamId:m.team_id,meetingId});const members=await a.teams.members(m.team_id);if(!members.length)throw new AppError('NO_MEMBERS','لا يوجد أعضاء في الفريق لإسناد التكليف.');
  const guildOptions=await guildMemberOptions(s.guild,{includeBots:false});const byId=new Map(guildOptions.map(x=>[String(x.value),x]));const allOptions=members.map(x=>byId.get(String(x.user_id))??{label:String(x.display_name).slice(0,100),description:`عضو في ${m.team_name}`.slice(0,100),value:String(x.user_id)});
  setSmartMemberContext(a,s.userId,{customId:`task:assign-submit:${meetingId}`,options:allOptions,title:'إسناد التكليف',context:`task:assign:${meetingId}`});
  const context=`task:assign:${meetingId}`;const query=getMemberSearch(a,s.userId,context);const options=filterMemberOptions(allOptions,query);const searchRows=memberSearchRows({openId:`task:member-search:assign:${meetingId}`,clearId:`task:member-search-clear:assign:${meetingId}`,query});
  if(!options.length){const payload={content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,embeds:[],components:withNavigation(searchRows,`meeting:view:${meetingId}`)};return update?i.update(payload):i.editReply(payload);}
  const p=pickerMenuPage(options,page);const components=[...searchRows,stringSelect(`task:assign-submit:${meetingId}`,`اختر المكلّف — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];const pager=[];if(p.page>0)pager.push(btn(`task:assign-page:${meetingId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`task:assign-page:${meetingId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)components.push(...rowsFromButtons(pager));const payload={content:`اختر الشخص المسؤول عن التكليف — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}\n🔎 البحث بالاسم أو اليوزر متاح.${smartMemberHint()}`,embeds:[],components:withNavigation(components,`meeting:view:${meetingId}`)};return update?i.update(payload):i.editReply(payload);
}
async function assigneeSubmit(i,a,s,meetingId){
  const d=a.drafts.get(`task-create:${s.userId}`);if(!d||d.meetingId!==meetingId)throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء التكليف. ابدأ من جديد.');const m=await a.meetings.get(meetingId);await a.permissionService.assert(s,'tasks.manage',{teamId:m.team_id,meetingId});const task=await a.taskService.create({guildId:s.guildId,teamId:d.teamId,meetingId,title:d.title,description:d.description,assigneeUserId:i.values[0],dueAt:d.dueAt,actorId:s.userId,guild:s.guild});a.drafts.delete(`task-create:${s.userId}`);return i.update({content:`✅ تم إنشاء التكليف **${task.title}** وإسناده إلى <@${task.assignee_user_id}>.${task.due_at?`\n⏳ الموعد النهائي: <t:${Math.floor(new Date(task.due_at).getTime()/1000)}:F>`:''}`,embeds:[],components:withNavigation([],`meeting:view:${meetingId}`)});
}

async function taskAccess(a,s,task){
  const isAssignee=String(task.assignee_user_id)===String(s.userId);
  const canLead=Boolean(task.meeting_id)&&await a.permissionService.has(s,'meetings.lead',{teamId:task.meeting_team_id??task.team_id,meetingId:task.meeting_id});
  const canView=(await a.permissionService.has(s,'tasks.view',{teamId:task.team_id,meetingId:task.meeting_id}))||canLead;
  const canManage=(await a.permissionService.has(s,'tasks.manage',{teamId:task.team_id,meetingId:task.meeting_id}))||canLead;
  const canReview=(await a.permissionService.has(s,'tasks.review',{teamId:task.team_id,meetingId:task.meeting_id}))||canManage;
  return {isAssignee,canView,canManage,canReview,canLead};
}
async function openTask(i,a,s,taskId){
  const task=await a.tasks.get(taskId);if(!task)throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');const access=await taskAccess(a,s,task);if(!access.isAssignee&&!access.canView&&!access.canManage&&!access.canReview)throw new AppError('FORBIDDEN','ليس لديك صلاحية لعرض هذا التكليف.');const settings=await a.guilds.getSettings(s.guildId);const display=taskDisplayStatus(task);const submission=await a.tasks.latestSubmission(task.id);const attachments=Array.isArray(submission?.attachments)?submission.attachments:[];
  const reviewText=task.review_status==='submitted'?'بانتظار اعتماد المراجع':task.review_status==='approved'?'تم اعتماد الإنجاز':task.review_status==='rejected'?'أعيدت للتعديل':'لم يُسلّم بعد';
  let groupProgressText='';
  if(task.assignment_group_id){const rows=await a.tasks.listGroupTasks(task.assignment_group_id);const done=rows.filter(x=>x.status==='done').length;const active=rows.filter(x=>x.status==='in_progress'&&x.review_status!=='submitted').length;const waiting=rows.filter(x=>x.review_status==='submitted').length;groupProgressText=`\n**متابعة التكليف الجماعي:** ✅ ${done}/${rows.length} مكتمل${active?` • 🔵 ${active} قيد التنفيذ`:''}${waiting?` • 🟡 ${waiting} بانتظار المراجعة`:''}`;}
  const desc=`الفريق: **${task.team_name}**\nالمكلّف: <@${task.assignee_user_id}>\nالحالة: **${statusAr[display]??display}**\nحالة المراجعة: **${reviewText}**\nالموعد النهائي: **${task.due_at?formatDate(task.due_at,settings.timezone):'غير محدد'}**\nالاجتماع: **${task.meeting_name??'غير مرتبط'}**${groupProgressText}\n\n${task.description||'لا توجد تفاصيل إضافية.'}${submission?`\n\n**آخر تسليم**\n${submission.note||'بدون ملاحظة نصية.'}\nالملفات: **${attachments.length}**`:''}${task.review_note?`\n\n**ملاحظة المراجع:** ${task.review_note}`:''}`;
  const buttons=[];
  if(access.isAssignee&&['pending','in_progress'].includes(task.status)&&task.review_status!=='submitted'){
    if(task.status==='pending')buttons.push(btn(`task:status:${task.id}:in_progress`,'بدء التنفيذ',ButtonStyle.Primary,'▶️'));
    buttons.push(btn(`task:submit:${task.id}`,task.review_status==='rejected'?'إعادة التسليم للمراجعة':'تسليم للمراجعة',ButtonStyle.Success,'📤'));
    if(task.status==='in_progress'&&task.review_status!=='rejected')buttons.push(btn(`task:status:${task.id}:pending`,'إرجاع: لم يبدأ',ButtonStyle.Secondary,'↩️'));
  }
  if(access.canReview&&task.review_status==='submitted'&&!access.isAssignee){
    buttons.push(btn(`task:approve:${task.id}`,'اعتماد الإنجاز',ButtonStyle.Success,'✅'));
    buttons.push(btn(`task:reject:${task.id}`,'إعادة للتعديل',ButtonStyle.Danger,'↩️'));
    if(attachments.length)buttons.push(btn(`task:files:${task.id}`,'ملفات التسليم',ButtonStyle.Secondary,'📎'));
  }
  if(access.canManage){
    buttons.push(btn(`task:reassign:${task.id}`,'تبديل المكلّف / الفريق',ButtonStyle.Secondary,'🔄'));
    if(task.assignment_group_id){
      buttons.push(btn(`task:reassign-group:${task.assignment_group_id}`,'تبديل مجموعة التكليف',ButtonStyle.Secondary,'👥'));
    }

    if(task.status==='done'||task.status==='cancelled')buttons.push(btn(`task:status:${task.id}:pending`,'إعادة فتح',ButtonStyle.Secondary,'🔁'));
    if(task.status!=='cancelled'&&task.status!=='done')buttons.push(btn(`task:status:${task.id}:cancelled`,'إلغاء التكليف',ButtonStyle.Danger,'🛑'));
  }
  return i.update({embeds:[e(`✅ ${task.title}`,desc.slice(0,3900))],components:withNavigation(rowsFromButtons(buttons),access.isAssignee?'member:tasks':'admin:tasks')});
}
async function setStatus(i,a,s,taskId,status){
  const task=await a.tasks.get(taskId);if(!task)throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');const access=await taskAccess(a,s,task);if(!access.isAssignee&&!access.canManage)throw new AppError('FORBIDDEN','ليس لديك صلاحية لتغيير حالة هذا التكليف.');if(status==='done')throw new AppError('TASK_REVIEW_REQUIRED','لا يتم إكمال المهمة مباشرة؛ يجب أن يسلمها المكلّف ثم يعتمدها المراجع.');await a.taskService.setStatus({taskId,status,actorId:s.userId,guildId:s.guildId,allowAssignee:access.isAssignee&&!access.canManage,guild:s.guild});return openTask(i,a,s,taskId);
}

function submissionModal(i,taskId){
  const upload=new FileUploadBuilder().setCustomId('evidence').setMinValues(0).setMaxValues(3).setRequired(false);
  const label=new LabelBuilder().setLabel('ملفات الإنجاز (اختياري)').setDescription('حتى 3 ملفات، وبحد أقصى 15MB لكل ملف.').setFileUploadComponent(upload);
  const modal=new ModalBuilder().setCustomId(`task:submit-save:${taskId}`).setTitle('تسليم المهمة للمراجعة');
  modal.spliceComponents(0,0,input('note','ملخص ما تم إنجازه',TextInputStyle.Paragraph,false),label);
  return i.showModal(modal);
}
function rejectionModal(i,taskId){
  return i.showModal(new ModalBuilder().setCustomId(`task:reject-save:${taskId}`).setTitle('إعادة المهمة للتعديل').addComponents(input('note','سبب الإعادة / المطلوب تعديله',TextInputStyle.Paragraph,true)));
}
async function submitTask(i,a,s,taskId){
  const uploaded=i.fields.getUploadedFiles?.('evidence',false);const files=uploaded?[...uploaded.values()]:[];const note=i.fields.getTextInputValue('note').trim();
  await a.taskService.submit({taskId,actorId:s.userId,guildId:s.guildId,note,attachments:files,guild:s.guild});
  return i.editReply({content:'✅ تم تسليم المهمة للمراجعة. لن تُحتسب مكتملة حتى يعتمدها المراجع.',embeds:[],components:[]});
}
async function approveTask(i,a,s,taskId){
  const task=await a.tasks.get(taskId);if(!task)throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');const access=await taskAccess(a,s,task);if(!access.canReview)throw new AppError('FORBIDDEN','ليس لديك صلاحية مراجعة المهام.');
  await a.taskService.review({taskId,approved:true,reviewerUserId:s.userId,guildId:s.guildId,note:'',guild:s.guild});return openTask(i,a,s,taskId);
}
async function rejectTask(i,a,s,taskId){
  const task=await a.tasks.get(taskId);if(!task)throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');const access=await taskAccess(a,s,task);if(!access.canReview)throw new AppError('FORBIDDEN','ليس لديك صلاحية مراجعة المهام.');const note=i.fields.getTextInputValue('note').trim();
  await a.taskService.review({taskId,approved:false,reviewerUserId:s.userId,guildId:s.guildId,note,guild:s.guild});return i.editReply({content:'↩️ تمت إعادة المهمة للمكلّف مع ملاحظة المراجعة.',embeds:[],components:[]});
}
async function sendSubmissionFiles(i,a,s,taskId){
  const task=await a.tasks.get(taskId);if(!task)throw new AppError('TASK_NOT_FOUND','التكليف غير موجود.');const access=await taskAccess(a,s,task);if(!access.canReview&&!access.canManage)throw new AppError('FORBIDDEN','ليس لديك صلاحية عرض ملفات التسليم.');const sub=await a.tasks.latestSubmission(taskId);const attachments=(Array.isArray(sub?.attachments)?sub.attachments:[]).filter(x=>x?.localPath&&fs.existsSync(x.localPath)).slice(0,3);if(!attachments.length)throw new AppError('NO_FILES','لا توجد ملفات محفوظة في آخر تسليم.');return i.followUp({content:`📎 ملفات آخر تسليم لمهمة **${task.title}**`,files:attachments.map(x=>({attachment:x.localPath,name:x.name})),ephemeral:Boolean(i.guildId)});
}

async function reviewQueue(i,a,s){
  const canReview=await a.permissionService.hasPotential(s,'tasks.review');const canManage=await a.permissionService.hasPotential(s,'tasks.manage');const canLead=await a.permissionService.hasPotential(s,'meetings.lead');if(!canReview&&!canManage&&!canLead)throw new AppError('FORBIDDEN','ليس لديك صلاحية مراجعة المهام.');const all=await a.tasks.listSubmittedForGuild(s.guildId,{limit:50});const visible=[];
  for(const t of all){if((canReview&&await a.permissionService.has(s,'tasks.review',{teamId:t.team_id,meetingId:t.meeting_id}))||(canManage&&await a.permissionService.has(s,'tasks.manage',{teamId:t.team_id,meetingId:t.meeting_id}))||(canLead&&t.meeting_id&&await a.permissionService.has(s,'meetings.lead',{teamId:t.meeting_team_id??t.team_id,meetingId:t.meeting_id})))visible.push(t);}
  const lines=visible.slice(0,20).map(t=>`• **${t.title}** — ${t.team_name} — <@${t.assignee_user_id}>`);const components=[];if(visible.length)components.push(stringSelect('task:open','فتح تسليم للمراجعة',visible.slice(0,25).map(t=>({label:t.title.slice(0,100),description:`${t.team_name} • ${t.assignee_name??t.assignee_user_id}`.slice(0,100),value:t.id}))));return i.update({embeds:[e('📥 تسليمات بانتظار المراجعة',lines.join('\n')||'لا توجد تسليمات تنتظر المراجعة ضمن نطاقك.')],components:withNavigation(components,'admin:tasks')});
}

async function performanceCandidates(a,s){
  const {rows}=await a.db.query(`SELECT tm.user_id,COALESCE(u.display_name,u.username,tm.user_id::text) AS display_name,COALESCE(u.username,'') AS username,array_agg(DISTINCT t.id::text) AS team_ids,string_agg(DISTINCT t.name,'، ' ORDER BY t.name) AS team_names FROM team_members tm JOIN teams t ON t.id=tm.team_id LEFT JOIN users u ON u.id=tm.user_id WHERE tm.guild_id=$1 AND tm.active=true AND t.deleted_at IS NULL GROUP BY tm.user_id,u.display_name,u.username ORDER BY COALESCE(u.display_name,u.username,tm.user_id::text)`,[s.guildId]);
  const out=[];for(const r of rows){const allowed=[];for(const teamId of r.team_ids??[]){if(await a.permissionService.has(s,'performance.view',{teamId}))allowed.push(String(teamId));}if(allowed.length)out.push({...r,allowedTeamIds:allowed});}return out;
}
async function performancePicker(i,a,s,period,page=0,update=true){
  if(!['week','month'].includes(period))throw new AppError('BAD_PERIOD','فترة التقييم غير صحيحة.');await a.permissionService.assertPotential(s,'performance.view');const candidates=await performanceCandidates(a,s);if(!candidates.length)throw new AppError('NO_MEMBERS','لا يوجد أعضاء ضمن نطاق تقييمك.');const guildOptions=await guildMemberOptions(s.guild,{includeBots:false});const byId=new Map(guildOptions.map(x=>[String(x.value),x]));const allOptions=candidates.map(x=>{const base=byId.get(String(x.user_id));return {label:(base?.label??x.display_name).slice(0,100),description:`${x.team_names||'عضو'}${base?.description?` • ${base.description}`:''}`.slice(0,100),value:String(x.user_id)};});
  setSmartMemberContext(a,s.userId,{customId:`task:perf-submit:${period}`,options:allOptions,title:`تقييم ${periodAr[period]} للعضو`,context:`task:perf:${period}`});const context=`task:perf:${period}`;const query=getMemberSearch(a,s.userId,context);const options=filterMemberOptions(allOptions,query);const searchRows=memberSearchRows({openId:`task:member-search:perf:${period}`,clearId:`task:member-search-clear:perf:${period}`,query});if(!options.length)return i.update({content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,embeds:[],components:withNavigation(searchRows,'admin:tasks')});const p=pickerMenuPage(options,page);const components=[...searchRows,stringSelect(`task:perf-submit:${period}`,`اختر العضو — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];const pager=[];if(p.page>0)pager.push(btn(`task:perf-page:${period}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`task:perf-page:${period}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)components.push(...rowsFromButtons(pager));return i.update({content:`📊 اختر العضو لإنشاء تقرير تقييم **${periodAr[period]}**.${searchSummary(query,options.length,allOptions.length)}\nالتقرير يقتصر على الفرق الواقعة ضمن صلاحيتك.${smartMemberHint()}`,embeds:[],components:withNavigation(components,'admin:tasks')});
}
async function allowedPerformanceTeams(a,s,userId){
  const {rows}=await a.db.query('SELECT team_id FROM team_members WHERE guild_id=$1 AND user_id=$2 AND active=true',[s.guildId,userId]);const allowed=[];for(const r of rows){if(await a.permissionService.has(s,'performance.view',{teamId:r.team_id}))allowed.push(String(r.team_id));}return allowed;
}
async function generatePerformanceFor(i,a,s,period,userId){
  await a.permissionService.assertPotential(s,'performance.view');const teamIds=await allowedPerformanceTeams(a,s,userId);if(!teamIds.length)throw new AppError('FORBIDDEN','هذا العضو خارج نطاق صلاحية التقييم لديك.');const {file,metrics}=await a.memberPerformanceService.generate({guildId:s.guildId,userId,period,actorId:s.userId,teamIds});const score=metrics.score===null?'بدون درجة لعدم كفاية البيانات':`${metrics.score}/100 — ${metrics.label}`;return i.followUp({content:`📊 تم إنشاء التقييم ${periodAr[period]} لـ **${metrics.user.display_name}**\n${score}${metrics.provisional?'\n⚠️ مؤشر أولي لأن حجم البيانات قليل.':''}`,files:[file],ephemeral:Boolean(i.guildId)});
}
async function generateSelfPerformance(i,a,s,period){
  if(!['week','month'].includes(period))throw new AppError('BAD_PERIOD','فترة التقييم غير صحيحة.');const {file,metrics}=await a.memberPerformanceService.generate({guildId:s.guildId,userId:s.userId,period,actorId:s.userId});const score=metrics.score===null?'لا توجد بيانات كافية لدرجة رقمية':`${metrics.score}/100 — ${metrics.label}`;return i.followUp({content:`📊 **تقييمك ${periodAr[period]}**\n${score}${metrics.provisional?'\n⚠️ هذا مؤشر أولي لأن البيانات في الفترة قليلة.':''}`,files:[file],ephemeral:Boolean(i.guildId)});
}
