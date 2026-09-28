import {ActionRowBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,ButtonStyle,ChannelType,PermissionFlagsBits} from 'discord.js';
import {e,btn,rowsFromButtons,stringSelect,voiceSelect,withNavigation} from '../ui.js';
import {subjectFromInteraction} from '../context.js';
import {parseLocalDateTime,formatDate} from '../../../utils/time.js';
import {AppError} from '../../../core/errors/AppError.js';
const arStatus={upcoming:'قادم',ongoing:'جاري',ended:'منتهي',canceled:'ملغي',postponed:'مؤجل'};

const input=(id,label,style=TextInputStyle.Short,required=true)=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required));

/*
 * 967 Meeting Voice Channel Picker
 * لا نعتمد على ChannelSelectMenuBuilder هنا لأن Discord يتحكم
 * في القنوات التي يعرضها للمستخدم بشكل مستقل عن منطق الاجتماعات.
 * هذه القائمة تبني الخيارات من قنوات السيرفر التي يراها المستخدم
 * ويمكنه الاتصال بها.
 */
async function meetingVoiceSelect(i,a,s,customId,teamId=''){
  const channels=await s.guild.channels.fetch();
  const generalId=String(process.env.GENERAL_VOICE_CHANNEL_ID??'').trim();
  const team=teamId ? await a.teams.get(teamId).catch(()=>null) : null;
  const teamDefaultId=String(team?.default_voice_channel_id??'').trim();

  const voices=[];

  for(const ch of channels.values()){
    if(!ch) continue;
    if(ch.type!==ChannelType.GuildVoice && ch.type!==ChannelType.GuildStageVoice) continue;

    const perms=ch.permissionsFor(s.userId);
    if(!perms?.has(PermissionFlagsBits.ViewChannel)) continue;
    if(!perms?.has(PermissionFlagsBits.Connect)) continue;

    const isTeamDefault=String(ch.id)===teamDefaultId;
    const isGeneral=String(ch.id)===generalId;

    voices.push({
      ch,
      priority:isTeamDefault?0:isGeneral?1:2
    });
  }

  voices.sort((a,b)=>{
    if(a.priority!==b.priority) return a.priority-b.priority;

    const ap=String(a.ch.parent?.name??'');
    const bp=String(b.ch.parent?.name??'');
    const parentCompare=ap.localeCompare(bp,'ar');

    if(parentCompare!==0) return parentCompare;

    return String(a.ch.name).localeCompare(String(b.ch.name),'ar');
  });

  const options=voices.slice(0,25).map(({ch})=>{
    const isGeneral=String(ch.id)===generalId;
    const isTeamDefault=String(ch.id)===teamDefaultId;

    let prefix='';
    if(isTeamDefault) prefix='⭐ ';
    else if(isGeneral) prefix='🌐 ';

    const parent=ch.parent?.name ? ` • ${ch.parent.name}` : '';

    return {
      label:`${prefix}${String(ch.name).slice(0,95)}`,
      description:`${isTeamDefault?'القناة الافتراضية للفريق':isGeneral?'القناة الصوتية العامة':'قناة صوتية'}${parent}`.slice(0,100),
      value:String(ch.id)
    };
  });

  if(!options.length){
    throw new AppError(
      'NO_VOICE_CHANNELS',
      'لا توجد قنوات صوتية متاحة لك لإنشاء الاجتماع.'
    );
  }

  return stringSelect(
    customId,
    'اختر القناة الصوتية',
    options
  );
}

export async function handleMeetings(interaction,app){
  const id=interaction.customId??''; const subject=await subjectFromInteraction(interaction,app.env);
  if(id==='admin:meetings') return adminList(interaction,app,subject);
  if(id==='member:meetings') return memberList(interaction,app,subject);
  if(id==='member:past-meetings') return memberPast(interaction,app,subject);
  if(id==='meeting:create') return createChooseTeam(interaction,app,subject);
  if(id==='meeting:create:team') return createDetailsModal(interaction,app,subject);
  if(id==='meeting:create:details') return createDetailsSubmit(interaction,app,subject);
  if(id==='meeting:create:voice') return createVoiceSubmit(interaction,app,subject);
  if(id==='meeting:create:default-voice') return createDefaultVoice(interaction,app,subject);
  if(id==='meeting:open') return openMeeting(interaction,app,subject,interaction.values[0]);
  if(id.startsWith('meeting:view:')) return openMeeting(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:readiness:')) return readiness(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:start:')) return startMeeting(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:end:')) return endMeeting(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:cancel:')) return cancelModal(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:cancel-submit:')) return cancelSubmit(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:reschedule:')) return rescheduleModal(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:reschedule-submit:')) return rescheduleSubmit(interaction,app,subject,id.split(':')[3]);
  if(id.startsWith('meeting:voice:')) return voiceChange(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:voice-submit:')) return voiceChangeSubmit(interaction,app,subject,id.split(':')[3]);
  if(id.startsWith('meeting:postpone:')) return postponeModal(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:postpone-submit:')) return postponeSubmit(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:edit:')) return editModal(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:edit-submit:')) return editSubmit(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:decision:')) return decisionModal(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:decision-submit:')) return decisionSubmit(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:record-start:')) return recordStart(interaction,app,subject,id.split(':')[2]);
  if(id.startsWith('meeting:record-stop:')) return recordStop(interaction,app,subject,id.split(':')[2]);
  return false;
}
async function adminList(i,a,s){const canView=await a.permissionService.hasPotential(s,'meetings.view');const canCreate=await a.permissionService.hasPotential(s,'meetings.create');if(!canView&&!canCreate)throw new AppError('FORBIDDEN','ليس لديك صلاحية للوصول إلى إدارة الاجتماعات.');const all=await a.meetings.listForGuild(s.guildId,{statuses:['upcoming','postponed','ongoing'],limit:25});const items=[];if(canView)for(const m of all)if(await a.permissionService.has(s,'meetings.view',{teamId:m.team_id,meetingId:m.id}))items.push(m);const comps=[];if(items.length)comps.push(stringSelect('meeting:open','اختر اجتماعًا',items.map(m=>({label:m.name.slice(0,100),description:`${m.team_name} • ${arStatus[m.status]}`.slice(0,100),value:m.id}))));if(canCreate)comps.push(...rowsFromButtons([btn('meeting:create','إنشاء اجتماع',ButtonStyle.Primary,'➕')]));return i.update({embeds:[e('🗓️ إدارة الاجتماعات',items.length||canCreate?'تظهر هنا الاجتماعات الواقعة ضمن نطاق صلاحياتك.':'لا توجد اجتماعات متاحة ضمن نطاقك.')],components:withNavigation(comps)});}
async function memberList(i,a,s){const items=await a.meetings.listForUser(s.guildId,s.userId,{future:true});const settings=await a.guilds.getSettings(s.guildId);const text=items.length?items.map(m=>`• **${m.name}** — ${m.team_name} — ${formatDate(m.scheduled_at,settings.timezone)} — ${arStatus[m.status]}`).join('\n'):'لا توجد اجتماعات قادمة لفريقك.';return i.update({embeds:[e('📅 اجتماعاتي القادمة',text)],components:withNavigation(rowsFromButtons([btn('member:excuse','تقديم اعتذار',2,'📝'),btn('member:past-meetings','اجتماعاتي السابقة',2,'🗂️')]))});}
async function memberPast(i,a,s){const items=await a.meetings.listForUser(s.guildId,s.userId,{future:false});const settings=await a.guilds.getSettings(s.guildId);const text=items.length?items.map(m=>`• **${m.name}** — ${formatDate(m.scheduled_at,settings.timezone)} — ${arStatus[m.status]}`).join('\n'):'لا توجد اجتماعات سابقة.';return i.update({embeds:[e('🗂️ اجتماعاتي السابقة',text)],components:withNavigation([],'member:meetings')});}
async function createChooseTeam(i,a,s){await a.permissionService.assertPotential(s,'meetings.create');const teams=await a.teams.list(s.guildId);const allowed=[];for(const t of teams)if(await a.permissionService.has(s,'meetings.create',{teamId:t.id}))allowed.push(t);if(!allowed.length)throw new AppError('NO_TEAM_SCOPE','لا توجد فرق ضمن نطاق صلاحيتك لإنشاء اجتماع.');const comps=[stringSelect('meeting:create:team','الفريق',allowed.map(t=>({label:t.name,value:t.id})))];return i.update({embeds:[e('إنشاء اجتماع','اختر الفريق أولًا.')],components:withNavigation(comps,'admin:meetings')});}
async function createDetailsModal(i,a,s){const teamId=i.values[0];await a.permissionService.assert(s,'meetings.create',{teamId});a.drafts.set(`meeting-create:${s.userId}`,{teamId});const modal=new ModalBuilder().setCustomId('meeting:create:details').setTitle('بيانات الاجتماع');modal.addComponents(input('name','اسم الاجتماع'),input('datetime','الموعد: YYYY-MM-DD HH:mm'),input('description','الوصف / الملاحظات',TextInputStyle.Paragraph,false));return i.showModal(modal);}
async function createDetailsSubmit(i,a,s){const draft=a.drafts.get(`meeting-create:${s.userId}`);if(!draft)throw new AppError('DRAFT_EXPIRED','انتهت جلسة الإنشاء. ابدأ من جديد.');await a.permissionService.assert(s,'meetings.create',{teamId:draft.teamId});const settings=await a.guilds.getSettings(s.guildId);const team=await a.teams.get(draft.teamId);const data={...draft,name:i.fields.getTextInputValue('name'),scheduledAt:parseLocalDateTime(i.fields.getTextInputValue('datetime'),settings.timezone),description:i.fields.getTextInputValue('description')};a.drafts.set(`meeting-create:${s.userId}`,data);const parts=[];if(team?.default_voice_channel_id)parts.push(...rowsFromButtons([btn('meeting:create:default-voice','استخدام قناة الفريق',ButtonStyle.Primary,'🔊')]));parts.push(await meetingVoiceSelect(i,a,s,'meeting:create:voice',draft.teamId));return i.reply({embeds:[e('القناة الصوتية',team?.default_voice_channel_id?`القناة الافتراضية للفريق: <#${team.default_voice_channel_id}>. استخدمها أو اختر قناة أخرى.`:'اختر قناة الاجتماع الصوتية.')],components:withNavigation(parts,'admin:meetings'),ephemeral:Boolean(i.guildId)});}
// operations967-no-team-meeting-announcements-v2
async function finishCreate(i,a,s,d,voiceChannelId){
  await a.permissionService.assert(s,'meetings.create',{teamId:d.teamId});
  const created=await a.meetingService.create({
    guildId:s.guildId,teamId:d.teamId,name:d.name,description:d.description,
    scheduledAt:d.scheduledAt,voiceChannelId,actorId:s.userId
  });
  a.drafts.delete(`meeting-create:${s.userId}`);
  const team=await a.teams.get(d.teamId);
  const settings=await a.guilds.getSettings(s.guildId);

  await a.autopilotService?.notifyMeetingScheduled?.(
    {...created,team_name:team?.name??created.team_name},
    settings,
  ).catch(error=>a.logger?.warn?.('meeting scheduled personal notification failed',{
    meetingId:created.id,error:error?.message??String(error)
  }));

  return i.update({
    embeds:[e('✅ تم إنشاء الاجتماع',`**${created.name}**
الفريق: **${team?.name??''}**
القناة: <#${voiceChannelId}>
المعرف: \`${created.id}\`

📨 إشعار الجدولة والتذكيرات تُرسل لكل عضو بشكل منفصل في الخاص.
🚫 لن ينشر البوت تذكيرات الاجتماع في قناة الإعلانات.`)],
    components:withNavigation([],'admin:meetings')
  });
}
async function createVoiceSubmit(i,a,s){const d=a.drafts.get(`meeting-create:${s.userId}`);if(!d)throw new AppError('DRAFT_EXPIRED','انتهت جلسة الإنشاء.');return finishCreate(i,a,s,d,i.values[0]);}
async function createDefaultVoice(i,a,s){const d=a.drafts.get(`meeting-create:${s.userId}`);if(!d)throw new AppError('DRAFT_EXPIRED','انتهت جلسة الإنشاء.');const team=await a.teams.get(d.teamId);if(!team?.default_voice_channel_id)throw new AppError('NO_DEFAULT_VOICE','لا توجد قناة صوتية افتراضية مرتبطة بهذا الفريق.');const ch=await s.guild.channels.fetch(String(team.default_voice_channel_id)).catch(()=>null);if(!ch?.isVoiceBased())throw new AppError('BAD_DEFAULT_VOICE','قناة الفريق الافتراضية غير موجودة أو ليست صوتية.');return finishCreate(i,a,s,d,String(team.default_voice_channel_id));}
async function openMeeting(i,a,s,meetingId){const m=await a.meetings.get(meetingId);if(!m)throw new AppError('NOT_FOUND','الاجتماع غير موجود.');await a.permissionService.assert(s,'meetings.view',{teamId:m.team_id,meetingId:m.id});const settings=await a.guilds.getSettings(s.guildId);const buttons=[];if(await a.permissionService.has(s,'meetings.edit',{teamId:m.team_id,meetingId:m.id}))buttons.push(btn(`meeting:edit:${m.id}`,'تعديل',2,'✏️'),btn(`meeting:reschedule:${m.id}`,'تغيير الموعد',2,'🕒'),btn(`meeting:voice:${m.id}`,'تغيير القناة',2,'🔊'),btn(`meeting:postpone:${m.id}`,'تأجيل',2,'⏰'));if(await a.permissionService.has(s,'meetings.cancel',{teamId:m.team_id,meetingId:m.id})&&['upcoming','postponed'].includes(m.status))buttons.push(btn(`meeting:cancel:${m.id}`,'إلغاء',ButtonStyle.Danger,'🛑'));if(await a.permissionService.has(s,'meetings.start',{teamId:m.team_id,meetingId:m.id})&&['upcoming','postponed'].includes(m.status))buttons.push(btn(`meeting:readiness:${m.id}`,'فحص الجاهزية',2,'🩺'),btn(`meeting:start:${m.id}`,'بدء',ButtonStyle.Success,'▶️'));if(await a.permissionService.has(s,'meetings.end',{teamId:m.team_id,meetingId:m.id})&&m.status==='ongoing')buttons.push(btn(`meeting:end:${m.id}`,'إنهاء',ButtonStyle.Danger,'⏹️'));if(await a.permissionService.has(s,'meetings.edit',{teamId:m.team_id,meetingId:m.id}))buttons.push(btn(`meeting:decision:${m.id}`,'إضافة قرار',2,'📌'));if((await a.permissionService.has(s,'tasks.manage',{teamId:m.team_id,meetingId:m.id}))||(await a.permissionService.has(s,'meetings.lead',{teamId:m.team_id,meetingId:m.id})))buttons.push(btn(`task:live-add:${m.id}`,'تكليف حي',2,'📌'));if(await a.permissionService.has(s,'recordings.manage',{teamId:m.team_id,meetingId:m.id})&&m.status==='ongoing')buttons.push(btn(`meeting:record-start:${m.id}`,'بدء تسجيل',2,'🎙️'),btn(`meeting:record-stop:${m.id}`,'إيقاف تسجيل',2,'⏹️'));if(await a.permissionService.has(s,'reports.generate',{teamId:m.team_id,meetingId:m.id})&&m.status==='ended')buttons.push(btn(`report:generate:${m.id}`,'توليد تقرير',2,'📄'));
  const desc=`الفريق: **${m.team_name}**\nالحالة: **${arStatus[m.status]}**\nالموعد: **${formatDate(m.scheduled_at,settings.timezone)}**\nالقناة: <#${m.voice_channel_id}>\n🤖 Autopilot: **${settings.autopilot_enabled?'مفعّل':'معطّل'}**\nطريقة البدء: **${m.start_mode==='autopilot'?'تلقائي':m.start_mode==='recovery'?'استرداد تلقائي':'يدوي'}**\n${m.description||''}`;return i.update({embeds:[e(`📋 ${m.name}`,desc)],components:withNavigation(rowsFromButtons(buttons),'admin:meetings')});}
async function readiness(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.start',{teamId:m.team_id,meetingId:id});const settings=await a.guilds.getSettings(s.guildId);const r=await a.meetingService.readiness({meeting:m,guild:s.guild,settings});return i.reply({content:r.ok?`✅ الاجتماع جاهز. أعضاء Snapshot المتوقعون: ${r.memberCount}`:`❌ غير جاهز:\n- ${r.issues.join('\n- ')}`,ephemeral:Boolean(i.guildId)});}
async function startMeeting(i,a,s,id){
  const m=await a.meetings.get(id);
  await a.permissionService.assert(s,'meetings.start',{teamId:m.team_id,meetingId:id});
  await i.deferReply({ephemeral:Boolean(i.guildId)});
  const started=await a.meetingService.start({guildId:s.guildId,meetingId:id,actorId:s.userId,guild:s.guild,startMode:'manual'});
  const [team,openTasks,previousDecisions]=await Promise.all([
    a.teams.get(started.team_id),
    a.tasks.listOpenForTeam(started.team_id,{limit:8}),
    a.meetings.recentDecisionsForTeam(started.team_id,{excludeMeetingId:id,limit:5})
  ]);
  const rec=started.recording_auto_status;
  const recText=rec?.started?'\n🎙️ بدأ التسجيل الصوتي تلقائيًا.':rec?.attempted?`\n⚠️ بدأ الاجتماع لكن التسجيل التلقائي لم يبدأ: ${rec.error}`:'';
  const board=started.task_board_status;
  const boardText=board?.sent?'\n📋 تم نشر لوحة المهام في دردشة القناة الصوتية.':board?.attempted?`\n⚠️ تعذر نشر لوحة المهام: ${board.error??'سبب غير معروف'}`:'';
  const followTasks=openTasks.length?`\n\n📌 **متابعة التكليفات المفتوحة:**\n${openTasks.map(t=>`• ${t.title} — <@${t.assignee_user_id}>${t.due_at?` — <t:${Math.floor(new Date(t.due_at).getTime()/1000)}:R>`:''}`).join('\n')}`:'';
  const followDecisions=previousDecisions.length?`\n\n📌 **آخر قرارات الفريق:**\n${previousDecisions.map(d=>`• ${d.decision_text}`).join('\n')}`:'';
  // v2: no group start announcement.
  return i.editReply({content:`✅ بدأ الاجتماع **${started.name}** وتم تجميد قائمة الأعضاء.${recText}${boardText}${followTasks}${followDecisions}`,components:withNavigation([],`meeting:view:${id}`)});
}
async function endMeeting(i,a,s,id){
  const meeting=await a.meetings.get(id);
  await a.permissionService.assert(s,'meetings.end',{teamId:meeting.team_id,meetingId:id});
  await i.deferReply({ephemeral:Boolean(i.guildId)});
  const out=await a.meetingService.end({
    guildId:s.guildId,meetingId:id,actorId:s.userId,guild:s.guild
  });
  return i.editReply({
    content:`✅ انتهى الاجتماع.${out.report?' تم إنشاء تقرير Word.':''}${out.recording?' وتم حفظ التسجيل.':''}
📄🎙️ التقرير والتسجيل يُرسلان مباشرة بعد التجهيز إلى **قناة شات الفريق** الموجودة بجانب قناة الاجتماع، وليس قناة الإعلانات.`,
    components:withNavigation([],'admin:meetings')
  });
}
async function cancelModal(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.cancel',{teamId:m.team_id,meetingId:id});const modal=new ModalBuilder().setCustomId(`meeting:cancel-submit:${id}`).setTitle('إلغاء الاجتماع').addComponents(input('reason','سبب الإلغاء',TextInputStyle.Paragraph));return i.showModal(modal);}
async function cancelSubmit(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.cancel',{teamId:m.team_id,meetingId:id});await a.meetingService.cancel({guildId:s.guildId,meetingId:id,actorId:s.userId,reason:i.fields.getTextInputValue('reason')});return i.reply({content:'✅ تم إلغاء الاجتماع وتسجيل العملية في Audit Log.',components:withNavigation([],'admin:meetings'),ephemeral:Boolean(i.guildId)});}
async function rescheduleModal(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});const settings=await a.guilds.getSettings(s.guildId);const modal=new ModalBuilder().setCustomId(`meeting:reschedule-submit:${id}`).setTitle('تغيير موعد الاجتماع').addComponents(input('datetime','الموعد الجديد YYYY-MM-DD HH:mm'));modal.components[0].components[0].setValue(formatDate(m.scheduled_at,settings.timezone));return i.showModal(modal);}
async function rescheduleSubmit(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});if(!['upcoming','postponed'].includes(m.status))throw new AppError('INVALID_STATE','لا يمكن تغيير موعد اجتماع بدأ أو انتهى.');const settings=await a.guilds.getSettings(s.guildId);const dt=parseLocalDateTime(i.fields.getTextInputValue('datetime'),settings.timezone);const updated=await a.meetings.update(id,{scheduled_at:dt,status:'upcoming'},s.userId);await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'meeting.reschedule',targetType:'meeting',targetId:id,oldValue:{scheduled_at:m.scheduled_at,status:m.status},newValue:{scheduled_at:updated.scheduled_at,status:updated.status}});return i.reply({content:'✅ تم تغيير الموعد.',components:withNavigation([],`meeting:view:${id}`),ephemeral:Boolean(i.guildId)});}
async function voiceChange(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});if(!['upcoming','postponed'].includes(m.status))throw new AppError('INVALID_STATE','لا يمكن تغيير قناة اجتماع بدأ أو انتهى.');return i.reply({content:'اختر القناة الصوتية الجديدة:',components:withNavigation([await meetingVoiceSelect(i,a,s,`meeting:voice-submit:${id}`,m.team_id)],`meeting:view:${id}`),ephemeral:Boolean(i.guildId)});}
async function voiceChangeSubmit(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});const channelId=i.values[0];await a.meetings.update(id,{voice_channel_id:channelId},s.userId);await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'meeting.voice_channel.change',targetType:'meeting',targetId:id,oldValue:{voice_channel_id:m.voice_channel_id},newValue:{voice_channel_id:channelId}});return i.update({content:'✅ تم تغيير القناة الصوتية.',components:withNavigation([],`meeting:view:${id}`)});}
async function postponeModal(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});const modal=new ModalBuilder().setCustomId(`meeting:postpone-submit:${id}`).setTitle('تأجيل الاجتماع').addComponents(input('datetime','الموعد الجديد YYYY-MM-DD HH:mm'),input('note','ملاحظة التأجيل',TextInputStyle.Paragraph,false));return i.showModal(modal);}
async function postponeSubmit(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});const settings=await a.guilds.getSettings(s.guildId);const dt=parseLocalDateTime(i.fields.getTextInputValue('datetime'),settings.timezone);await a.meetingService.postpone({guildId:s.guildId,meetingId:id,actorId:s.userId,newScheduledAt:dt,note:i.fields.getTextInputValue('note')});return i.reply({content:'✅ تم تأجيل الاجتماع.',components:withNavigation([],`meeting:view:${id}`),ephemeral:Boolean(i.guildId)});}
async function editModal(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});const modal=new ModalBuilder().setCustomId(`meeting:edit-submit:${id}`).setTitle('تعديل الاجتماع').addComponents(input('name','اسم الاجتماع'),input('description','الوصف',TextInputStyle.Paragraph,false));modal.components[0].components[0].setValue(m.name.slice(0,4000));if(m.description)modal.components[1].components[0].setValue(m.description.slice(0,4000));return i.showModal(modal);}
async function editSubmit(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});const old={name:m.name,description:m.description};const updated=await a.meetings.update(id,{name:i.fields.getTextInputValue('name'),description:i.fields.getTextInputValue('description')},s.userId);await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'meeting.edit',targetType:'meeting',targetId:id,oldValue:old,newValue:{name:updated.name,description:updated.description}});return i.reply({content:'✅ تم تعديل الاجتماع.',components:withNavigation([],`meeting:view:${id}`),ephemeral:Boolean(i.guildId)});}
async function decisionModal(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});const modal=new ModalBuilder().setCustomId(`meeting:decision-submit:${id}`).setTitle('إضافة قرار').addComponents(input('decision','نص القرار',TextInputStyle.Paragraph));return i.showModal(modal);}
async function decisionSubmit(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'meetings.edit',{teamId:m.team_id,meetingId:id});const d=await a.meetings.addDecision(id,i.fields.getTextInputValue('decision'),s.userId);await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'meeting.decision.add',targetType:'meeting',targetId:id,newValue:{decisionId:d.id,text:d.decision_text}});return i.reply({content:'✅ تم حفظ القرار رسميًا. يمكن متابعته وتعيين مسؤول وموعد ودليل تنفيذ من **/panel → مركز القيادة → سجل القرارات**.',components:withNavigation([],`meeting:view:${id}`),ephemeral:Boolean(i.guildId)});}
async function recordStart(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'recordings.manage',{teamId:m.team_id,meetingId:id});await i.deferReply({ephemeral:Boolean(i.guildId)});await a.recordingService.start({meeting:m,guild:s.guild,actorId:s.userId});return i.editReply({content:'🎙️ بدأ التسجيل. يتم حفظ الصوت كمسارات Ogg Opus منفصلة لكل مقطع متحدث.',components:withNavigation([],`meeting:view:${id}`)});}
async function recordStop(i,a,s,id){const m=await a.meetings.get(id);await a.permissionService.assert(s,'recordings.manage',{teamId:m.team_id,meetingId:id});await a.recordingService.stopByMeeting(id);return i.reply({content:'⏹️ تم إيقاف التسجيل وحفظ المسارات.',components:withNavigation([],`meeting:view:${id}`),ephemeral:Boolean(i.guildId)});}
