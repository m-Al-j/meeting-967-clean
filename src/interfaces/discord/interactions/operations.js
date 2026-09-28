import {ActionRowBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,ButtonStyle} from 'discord.js';
import {e,btn,rowsFromButtons,stringSelect,userSelect,withNavigation} from '../ui.js';
import {subjectFromInteraction} from '../context.js';
import {parseLocalDateTime,formatDate} from '../../../utils/time.js';
import {AppError} from '../../../core/errors/AppError.js';

const DECISION_STATUS={open:'مفتوح',in_progress:'قيد التنفيذ',implemented:'تم التنفيذ',cancelled:'ملغي'};
const DECISION_ICON={open:'⚪',in_progress:'🔵',implemented:'✅',cancelled:'⛔'};
const PRIORITY={low:'منخفضة',normal:'عادية',high:'عالية',critical:'حرجة'};
const WORKFLOW_STATUS={active:'نشط',blocked:'متعطل',completed:'مكتمل',cancelled:'ملغي'};
const WORKFLOW_ICON={active:'🔵',blocked:'🔴',completed:'✅',cancelled:'⛔'};

function input(id,label,{style=TextInputStyle.Short,required=true,value=null,placeholder=null,maxLength=null}={}){
  const x=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if(value!==null&&value!==undefined&&String(value).length)x.setValue(String(value).slice(0,maxLength??4000));
  if(placeholder)x.setPlaceholder(placeholder);
  if(maxLength)x.setMaxLength(maxLength);
  return new ActionRowBuilder().addComponents(x);
}
function unix(value){return value?Math.floor(new Date(value).getTime()/1000):null;}
function pct(done,total){const t=Number(total||0);return t?Math.round((Number(done||0)/t)*100):0;}
function compact(text,max=85){const s=String(text??'').replace(/\s+/g,' ').trim();return s.length>max?`${s.slice(0,max-1)}…`:s;}
function stepsOf(row){return Array.isArray(row?.steps)?row.steps:[];}

async function access(a,s){
  const isOwner=a.permissionService.isOwner(s.userId);
  const isSuperAdmin=!isOwner&&await a.permissionService.isSuperAdmin(s);
  const globalOps=isOwner||isSuperAdmin||await a.permissionService.has(s,'operations.view',{});
  const decisionsPotential=isOwner||isSuperAdmin||await a.permissionService.hasAnyPotential(s,['decisions.view','decisions.manage']);
  const workflowsPotential=isOwner||isSuperAdmin||await a.permissionService.hasAnyPotential(s,['workflows.view','workflows.manage']);
  if(!globalOps&&!decisionsPotential&&!workflowsPotential)throw new AppError('FORBIDDEN','ليس لديك صلاحية للوصول إلى مركز القيادة المؤسسي.');
  return {isOwner,isSuperAdmin,globalOps,decisionsPotential,workflowsPotential};
}

async function canDecision(a,s,row,permission){
  if(a.permissionService.isOwner(s.userId)||await a.permissionService.isSuperAdmin(s))return true;
  return a.permissionService.has(s,permission,{teamId:row.team_id,meetingId:row.meeting_id});
}
async function canWorkflow(a,s,row,permission){
  if(a.permissionService.isOwner(s.userId)||await a.permissionService.isSuperAdmin(s))return true;
  return a.permissionService.has(s,permission,row.team_id?{teamId:row.team_id}:{});
}

export async function handleOperations(i,a){
  const id=String(i.customId??'');
  const s=await subjectFromInteraction(i,a.env);

  if(id==='admin:operations'||id==='ops:home'||id==='ops:refresh')return operationsHome(i,a,s);
  if(id==='ops:alerts')return alertsView(i,a,s);
  if(id==='ops:decisions'||id.startsWith('ops:decisions:'))return decisionsView(i,a,s,id.split(':')[2]??'open');
  if(id==='ops:decision-open')return decisionView(i,a,s,i.values[0]);
  if(id.startsWith('ops:decision:view:'))return decisionView(i,a,s,id.split(':')[3]);
  if(id.startsWith('ops:decision-owner:'))return decisionOwnerPicker(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:decision-owner-set:'))return decisionOwnerSet(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:decision-priority:'))return decisionPriorityPicker(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:decision-priority-set:'))return decisionPrioritySet(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:decision-meta:')&&!id.startsWith('ops:decision-meta-save:'))return decisionMetaModal(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:decision-meta-save:'))return decisionMetaSave(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:decision-start:'))return decisionStatus(i,a,s,id.split(':')[2],'in_progress');
  if(id.startsWith('ops:decision-reopen:'))return decisionStatus(i,a,s,id.split(':')[2],'open');
  if(id.startsWith('ops:decision-cancel:'))return decisionStatus(i,a,s,id.split(':')[2],'cancelled');
  if(id.startsWith('ops:decision-complete:')&&!id.startsWith('ops:decision-complete-save:'))return decisionCompleteModal(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:decision-complete-save:'))return decisionCompleteSave(i,a,s,id.split(':')[2]);

  if(id==='ops:workflows'||id.startsWith('ops:workflows:'))return workflowsView(i,a,s,id.split(':')[2]??'active');
  if(id==='ops:wf-start')return workflowStartTeamPicker(i,a,s);
  if(id==='ops:wf-start-team')return workflowTemplatePicker(i,a,s);
  if(id==='ops:wf-template')return workflowCreateModal(i,a,s,i.values[0]);
  if(id.startsWith('ops:wf-create:'))return workflowCreate(i,a,s,id.split(':')[2]);
  if(id==='ops:wf-open')return workflowView(i,a,s,i.values[0]);
  if(id.startsWith('ops:wf:view:'))return workflowView(i,a,s,id.split(':')[3]);
  if(id.startsWith('ops:wf-owner:'))return workflowOwnerPicker(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:wf-owner-set:'))return workflowOwnerSet(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:wf-team:'))return workflowTeamPicker(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:wf-team-set:'))return workflowTeamSet(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:wf-due:')&&!id.startsWith('ops:wf-due-save:'))return workflowDueModal(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:wf-due-save:'))return workflowDueSave(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:wf-advance:'))return workflowAdvance(i,a,s,id.split(':')[2]);
  if(id.startsWith('ops:wf-block:'))return workflowStatus(i,a,s,id.split(':')[2],'blocked');
  if(id.startsWith('ops:wf-resume:'))return workflowStatus(i,a,s,id.split(':')[2],'active');
  if(id.startsWith('ops:wf-cancel:'))return workflowStatus(i,a,s,id.split(':')[2],'cancelled');
  return false;
}

async function operationsHome(i,a,s){
  const ac=await access(a,s);const buttons=[];let metricsText='';
  if(ac.globalOps){
    const m=await a.operationsService.commandCenter(s.guildId);
    metricsText=[
      `🏛️ **الاجتماعات:** ${m.meetings_ongoing||0} جارٍ • ${m.meetings_next_7d||0} خلال 7 أيام`,
      `📋 **المهام:** ${m.tasks_open||0} مفتوحة • ${m.tasks_overdue||0} متأخرة • ${m.tasks_waiting_review||0} بانتظار المراجعة`,
      `📌 **القرارات:** ${m.decisions_open||0} مفتوحة • ${m.decisions_overdue||0} متأخرة • ${m.decisions_unassigned||0} بدون مسؤول`,
      `🔁 **المسارات:** ${m.workflows_active||0} نشطة • ${m.workflows_blocked||0} متعطلة • ${m.workflows_overdue||0} متأخرة`,
      '',
      `📈 **آخر 30 يومًا:** إنجاز المهام **${pct(m.tasks_done_30d,m.tasks_total_30d)}%** • تنفيذ القرارات **${pct(m.decisions_done_30d,m.decisions_total_30d)}%**`
    ].join('\n');
    buttons.push(btn('ops:alerts','التنبيهات الحرجة',ButtonStyle.Danger,'🚨'));
  }else metricsText='صلاحيتك الحالية تتيح لك أجزاء محددة من المركز؛ المؤشرات الشاملة تتطلب صلاحية **عرض مركز القيادة**.';
  if(ac.decisionsPotential)buttons.push(btn('ops:decisions','سجل القرارات',ButtonStyle.Primary,'📌'));
  if(ac.workflowsPotential)buttons.push(btn('ops:workflows','مسارات العمل',ButtonStyle.Primary,'🔁'));
  buttons.push(btn('ops:refresh','تحديث',ButtonStyle.Secondary,'🔄'));
  const desc=[
    '**Operations 967 — مركز القيادة المؤسسي**',
    'يجمع متابعة التنفيذ في مكان واحد بدل أن تبقى القرارات والمهام والمسارات منفصلة.',
    '',metricsText,'',
    '**المبدأ:** ما يخرج من الاجتماع يتحول إلى قرار قابل للمتابعة، وما يحتاج سلسلة تنفيذ يدخل في مسار عمل واضح.'
  ].join('\n');
  return i.update({embeds:[e('🏛️ مركز قيادة 967',desc.slice(0,4000))],components:withNavigation(rowsFromButtons(buttons),'panel:refresh','العودة للوحة')});
}

async function alertsView(i,a,s){
  const ac=await access(a,s);if(!ac.globalOps)throw new AppError('FORBIDDEN','التنبيهات الشاملة تتطلب صلاحية عرض مركز القيادة.');
  const rows=await a.operationsService.criticalAlerts(s.guildId,{limit:15});
  const kind={task:'مهمة',decision:'قرار',workflow:'مسار'};
  const lines=rows.map((x,n)=>{
    const due=x.due_at?`<t:${unix(x.due_at)}:R>`:'بدون موعد';
    const owner=x.owner_user_id?`<@${x.owner_user_id}>`:'**بدون مسؤول**';
    return `${n+1}. ${Number(x.severity)>=5?'🔴':Number(x.severity)>=4?'🟠':'🟡'} **${kind[x.kind]??x.kind}: ${compact(x.title,120)}**\n   ${x.team_name} • ${due} • ${owner}`;
  });
  return i.update({embeds:[e('🚨 التنبيهات الحرجة',lines.join('\n\n').slice(0,3900)||'✅ لا توجد عناصر متأخرة أو مسارات متعطلة حاليًا.')],components:withNavigation([], 'ops:home','مركز القيادة')});
}

async function visibleDecisions(a,s,mode){
  const options=mode==='all'?{limit:25}:mode==='done'?{limit:25,statuses:['implemented']}:mode==='overdue'?{limit:25,overdueOnly:true}:{limit:25,statuses:['open','in_progress']};
  const rows=await a.operationsService.listDecisions(s.guildId,options);const out=[];
  for(const row of rows)if(await canDecision(a,s,row,'decisions.view')||await canDecision(a,s,row,'decisions.manage'))out.push(row);
  return out;
}
async function decisionsView(i,a,s,mode='open'){
  await access(a,s);if(!['open','overdue','done','all'].includes(mode))mode='open';
  const rows=await visibleDecisions(a,s,mode);
  const lines=rows.slice(0,10).map((d,n)=>`${n+1}. ${DECISION_ICON[d.status]??'•'} **${compact(d.decision_text,110)}**\n   ${d.team_name} • ${PRIORITY[d.priority]??d.priority} • ${d.owner_user_id?`<@${d.owner_user_id}>`:'بدون مسؤول'}${d.due_at?` • <t:${unix(d.due_at)}:R>`:''}`);
  const components=[];
  if(rows.length)components.push(stringSelect('ops:decision-open','اختر قرارًا لفتحه',rows.map(d=>({label:compact(d.decision_text,95),description:`${d.team_name} • ${DECISION_STATUS[d.status]??d.status} • ${PRIORITY[d.priority]??d.priority}`.slice(0,100),value:String(d.id)}))));
  components.push(...rowsFromButtons([
    btn('ops:decisions:open','المفتوحة',mode==='open'?ButtonStyle.Primary:ButtonStyle.Secondary,'📌'),
    btn('ops:decisions:overdue','المتأخرة',mode==='overdue'?ButtonStyle.Danger:ButtonStyle.Secondary,'⏰'),
    btn('ops:decisions:done','المنفذة',mode==='done'?ButtonStyle.Success:ButtonStyle.Secondary,'✅'),
    btn('ops:decisions:all','الكل',mode==='all'?ButtonStyle.Primary:ButtonStyle.Secondary,'🗂️')
  ]));
  return i.update({embeds:[e('📌 سجل القرارات والالتزامات',`${lines.join('\n\n')||'لا توجد قرارات ضمن هذا العرض.'}\n\n-# القرار يصبح التزامًا واضحًا عند تعيين مسؤول وموعد وحالة تنفيذ.`.slice(0,4000))],components:withNavigation(components,'ops:home','مركز القيادة')});
}

async function decisionAccess(a,s,id,needManage=false){
  const row=await a.operationsService.getDecision(id);if(!row||String(row.guild_id)!==String(s.guildId))throw new AppError('DECISION_NOT_FOUND','القرار غير موجود.');
  const view=await canDecision(a,s,row,'decisions.view');const manage=await canDecision(a,s,row,'decisions.manage');
  if(!(manage||(!needManage&&view)))throw new AppError('FORBIDDEN','ليس لديك صلاحية لهذا القرار.');
  return {row,manage};
}
async function decisionView(i,a,s,id){
  const {row:d,manage}=await decisionAccess(a,s,id,false);
  const due=d.due_at?`<t:${unix(d.due_at)}:F> • <t:${unix(d.due_at)}:R>`:'غير محدد';
  const desc=[
    `**القرار:** ${d.decision_text}`,'',
    `**الفريق:** ${d.team_name}`,
    `**الاجتماع:** ${d.meeting_name}`,
    `**الحالة:** ${DECISION_ICON[d.status]??'•'} ${DECISION_STATUS[d.status]??d.status}`,
    `**الأولوية:** ${PRIORITY[d.priority]??d.priority}`,
    `**المسؤول:** ${d.owner_user_id?`<@${d.owner_user_id}>`:'غير معيّن'}`,
    `**الموعد:** ${due}`,
    `**المهام المرتبطة:** ${d.tasks_done||0}/${d.tasks_count||0} مكتملة`,
    d.evidence?`\n**دليل التنفيذ:**\n${d.evidence}`:'',
  ].filter(Boolean).join('\n');
  const buttons=[];
  if(manage){
    buttons.push(btn(`ops:decision-owner:${d.id}`,'تعيين مسؤول',ButtonStyle.Secondary,'👤'));
    buttons.push(btn(`ops:decision-meta:${d.id}`,'الموعد',ButtonStyle.Secondary,'🕒'));
    buttons.push(btn(`ops:decision-priority:${d.id}`,'الأولوية',ButtonStyle.Secondary,'⚑'));
    if(d.status==='open')buttons.push(btn(`ops:decision-start:${d.id}`,'بدء التنفيذ',ButtonStyle.Primary,'▶️'));
    if(d.status==='in_progress')buttons.push(btn(`ops:decision-reopen:${d.id}`,'إعادة فتح',ButtonStyle.Secondary,'↩️'));
    if(['open','in_progress'].includes(d.status))buttons.push(btn(`ops:decision-complete:${d.id}`,'تم التنفيذ + دليل',ButtonStyle.Success,'✅'),btn(`ops:decision-cancel:${d.id}`,'إلغاء',ButtonStyle.Danger,'⛔'));
    if(['implemented','cancelled'].includes(d.status))buttons.push(btn(`ops:decision-reopen:${d.id}`,'إعادة فتح',ButtonStyle.Secondary,'🔁'));
  }
  return i.update({embeds:[e('📌 بطاقة القرار المؤسسي',desc.slice(0,4000))],components:withNavigation(rowsFromButtons(buttons),'ops:decisions','سجل القرارات')});
}
async function decisionOwnerPicker(i,a,s,id){await decisionAccess(a,s,id,true);return i.update({content:'اختر الشخص المسؤول عن تنفيذ القرار:',embeds:[],components:withNavigation([userSelect(`ops:decision-owner-set:${id}`,'مسؤول القرار')],`ops:decision:view:${id}`,'العودة للقرار')});}
async function decisionOwnerSet(i,a,s,id){await decisionAccess(a,s,id,true);await a.operationsService.updateDecision({decisionId:id,guildId:s.guildId,actorId:s.userId,patch:{ownerUserId:i.values[0]}});return decisionView(i,a,s,id);}
async function decisionPriorityPicker(i,a,s,id){await decisionAccess(a,s,id,true);return i.update({content:'حدد أولوية القرار:',embeds:[],components:withNavigation([stringSelect(`ops:decision-priority-set:${id}`,'الأولوية',[{label:'حرجة',value:'critical',emoji:'🔴'},{label:'عالية',value:'high',emoji:'🟠'},{label:'عادية',value:'normal',emoji:'🟡'},{label:'منخفضة',value:'low',emoji:'⚪'}])],`ops:decision:view:${id}`,'العودة للقرار')});}
async function decisionPrioritySet(i,a,s,id){await decisionAccess(a,s,id,true);await a.operationsService.updateDecision({decisionId:id,guildId:s.guildId,actorId:s.userId,patch:{priority:i.values[0]}});return decisionView(i,a,s,id);}
async function decisionMetaModal(i,a,s,id){const {row}=await decisionAccess(a,s,id,true);const settings=await a.guilds.getSettings(s.guildId);return i.showModal(new ModalBuilder().setCustomId(`ops:decision-meta-save:${id}`).setTitle('موعد تنفيذ القرار').addComponents(input('due','الموعد YYYY-MM-DD HH:mm',{required:false,value:row.due_at?formatDate(row.due_at,settings.timezone):'',placeholder:'2026-09-15 20:00',maxLength:16})));}
async function decisionMetaSave(i,a,s,id){await decisionAccess(a,s,id,true);const settings=await a.guilds.getSettings(s.guildId);const value=i.fields.getTextInputValue('due').trim();await a.operationsService.updateDecision({decisionId:id,guildId:s.guildId,actorId:s.userId,patch:{dueAt:value?parseLocalDateTime(value,settings.timezone):null}});return decisionView(i,a,s,id);}
async function decisionStatus(i,a,s,id,status){await decisionAccess(a,s,id,true);await a.operationsService.updateDecision({decisionId:id,guildId:s.guildId,actorId:s.userId,patch:{status}});return decisionView(i,a,s,id);}
async function decisionCompleteModal(i,a,s,id){await decisionAccess(a,s,id,true);return i.showModal(new ModalBuilder().setCustomId(`ops:decision-complete-save:${id}`).setTitle('توثيق تنفيذ القرار').addComponents(input('evidence','دليل / ملخص التنفيذ',{style:TextInputStyle.Paragraph,required:true,maxLength:1800,placeholder:'ما الذي تم؟ أين الدليل أو الملف أو النتيجة؟'})));}
async function decisionCompleteSave(i,a,s,id){await decisionAccess(a,s,id,true);await a.operationsService.updateDecision({decisionId:id,guildId:s.guildId,actorId:s.userId,patch:{evidence:i.fields.getTextInputValue('evidence'),status:'implemented'}});return decisionView(i,a,s,id);}

async function visibleWorkflows(a,s,mode){
  const statuses=mode==='done'?['completed','cancelled']:mode==='all'?null:['active','blocked'];
  const rows=await a.operationsService.listWorkflows(s.guildId,{limit:25,statuses});const out=[];
  for(const row of rows)if(await canWorkflow(a,s,row,'workflows.view')||await canWorkflow(a,s,row,'workflows.manage'))out.push(row);
  return out;
}
async function workflowsView(i,a,s,mode='active'){
  const ac=await access(a,s);if(!['active','done','all'].includes(mode))mode='active';const rows=await visibleWorkflows(a,s,mode);
  const lines=rows.slice(0,10).map((w,n)=>{const steps=stepsOf(w);const idx=Math.min(Number(w.current_step||0),Math.max(steps.length-1,0));return `${n+1}. ${WORKFLOW_ICON[w.status]??'•'} **${compact(w.title,100)}**\n   ${w.team_name} • ${WORKFLOW_STATUS[w.status]??w.status} • الخطوة ${steps.length?idx+1:0}/${steps.length}${w.due_at?` • <t:${unix(w.due_at)}:R>`:''}`;});
  const components=[];if(rows.length)components.push(stringSelect('ops:wf-open','اختر مسارًا لفتحه',rows.map(w=>({label:compact(w.title,95),description:`${w.template_name} • ${WORKFLOW_STATUS[w.status]??w.status}`.slice(0,100),value:String(w.id)}))));
  const buttons=[btn('ops:workflows:active','النشطة',mode==='active'?ButtonStyle.Primary:ButtonStyle.Secondary,'🔵'),btn('ops:workflows:done','المغلقة',mode==='done'?ButtonStyle.Success:ButtonStyle.Secondary,'✅'),btn('ops:workflows:all','الكل',mode==='all'?ButtonStyle.Primary:ButtonStyle.Secondary,'🗂️')];
  if(ac.isOwner||ac.isSuperAdmin||await a.permissionService.hasPotential(s,'workflows.manage'))buttons.unshift(btn('ops:wf-start','بدء مسار',ButtonStyle.Success,'➕'));
  components.push(...rowsFromButtons(buttons));
  return i.update({embeds:[e('🔁 محرك مسارات العمل',`${lines.join('\n\n')||'لا توجد مسارات في هذا العرض.'}\n\n-# القوالب الجاهزة: انضمام عضو • دورة مشروع • تسليم واستلام مسؤولية`.slice(0,4000))],components:withNavigation(components,'ops:home','مركز القيادة')});
}
const workflowDraftKey=(userId)=>`ops-wf-create:${userId}`;
async function workflowStartTeamPicker(i,a,s){
  const ac=await access(a,s);
  const globalManage=ac.isOwner||ac.isSuperAdmin||await a.permissionService.has(s,'workflows.manage',{});
  const teams=await a.teams.list(s.guildId);const options=[];
  if(globalManage)options.push({label:'عام — بدون فريق محدد',description:'مسار على مستوى المبادرة',value:'__global__'});
  for(const team of teams){
    if(globalManage||await a.permissionService.has(s,'workflows.manage',{teamId:team.id}))options.push({label:team.name.slice(0,100),description:'ربط المسار بهذا الفريق',value:String(team.id)});
  }
  if(!options.length)throw new AppError('FORBIDDEN','لا يوجد فريق تملك عليه صلاحية إدارة مسارات العمل.');
  return i.update({content:'أولًا اختر نطاق مسار العمل:',embeds:[],components:withNavigation([stringSelect('ops:wf-start-team','الفريق / النطاق',options.slice(0,25))],'ops:workflows','مسارات العمل')});
}
async function workflowTemplatePicker(i,a,s){
  const selected=String(i.values?.[0]??'');
  if(!selected)throw new AppError('WORKFLOW_TEAM_REQUIRED','اختر نطاق مسار العمل.');
  const teamId=selected==='__global__'?null:selected;
  const ac=await access(a,s);
  const canManage=ac.isOwner||ac.isSuperAdmin||await a.permissionService.has(s,'workflows.manage',teamId?{teamId}:{});
  if(!canManage)throw new AppError('FORBIDDEN','ليس لديك صلاحية إدارة مسارات العمل في هذا النطاق.');
  a.drafts.set(workflowDraftKey(s.userId),{teamId});
  const templates=await a.operationsService.listTemplates();if(!templates.length)throw new AppError('NO_WORKFLOW_TEMPLATES','لا توجد قوالب مسارات مفعلة.');
  return i.update({content:'اختر قالب المسار المؤسسي. بعد الاختيار ستدخل العنوان والموعد:',embeds:[],components:withNavigation([stringSelect('ops:wf-template','قالب مسار العمل',templates.map(t=>({label:t.name_ar,description:compact(t.description_ar,100),value:t.template_key})))],'ops:workflows','مسارات العمل')});
}
async function workflowCreateModal(i,a,s,templateKey){
  const draft=a.drafts.get(workflowDraftKey(s.userId));if(!draft)throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء المسار. ابدأ من جديد.');
  const ac=await access(a,s);const canManage=ac.isOwner||ac.isSuperAdmin||await a.permissionService.has(s,'workflows.manage',draft.teamId?{teamId:draft.teamId}:{});
  if(!canManage)throw new AppError('FORBIDDEN','ليس لديك صلاحية بدء مسار في هذا النطاق.');
  const template=(await a.operationsService.listTemplates()).find(x=>x.template_key===templateKey);if(!template)throw new AppError('WORKFLOW_TEMPLATE_NOT_FOUND','القالب غير موجود.');
  return i.showModal(new ModalBuilder().setCustomId(`ops:wf-create:${templateKey}`).setTitle(template.name_ar.slice(0,45)).addComponents(input('title','عنوان الحالة / المشروع / الطلب',{value:template.name_ar,maxLength:180}),input('due','الموعد النهائي YYYY-MM-DD HH:mm',{required:false,placeholder:'2026-09-30 18:00',maxLength:16})));
}
async function workflowCreate(i,a,s,templateKey){
  const draft=a.drafts.get(workflowDraftKey(s.userId));if(!draft)throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء المسار. ابدأ من جديد.');
  const ac=await access(a,s);const canManage=ac.isOwner||ac.isSuperAdmin||await a.permissionService.has(s,'workflows.manage',draft.teamId?{teamId:draft.teamId}:{});
  if(!canManage)throw new AppError('FORBIDDEN','ليس لديك صلاحية بدء مسار في هذا النطاق.');
  const settings=await a.guilds.getSettings(s.guildId);const due=i.fields.getTextInputValue('due').trim();
  const row=await a.operationsService.createWorkflow({guildId:s.guildId,templateKey,title:i.fields.getTextInputValue('title'),teamId:draft.teamId,ownerUserId:s.userId,dueAt:due?parseLocalDateTime(due,settings.timezone):null,actorId:s.userId});
  a.drafts.delete(workflowDraftKey(s.userId));
  return workflowView(i,a,s,row.id);
}
async function workflowAccess(a,s,id,needManage=false){const row=await a.operationsService.getWorkflow(id);if(!row||String(row.guild_id)!==String(s.guildId))throw new AppError('WORKFLOW_NOT_FOUND','مسار العمل غير موجود.');const view=await canWorkflow(a,s,row,'workflows.view');const manage=await canWorkflow(a,s,row,'workflows.manage');if(!(manage||(!needManage&&view)))throw new AppError('FORBIDDEN','ليس لديك صلاحية لهذا المسار.');return {row,manage};}
async function workflowView(i,a,s,id){
  const {row:w,manage}=await workflowAccess(a,s,id,false);const steps=stepsOf(w);const idx=Math.min(Number(w.current_step||0),Math.max(steps.length-1,0));
  const stepLines=steps.map((step,n)=>`${w.status==='completed'||n<idx?'✅':n===idx&&w.status==='blocked'?'⏸️':n===idx&&w.status==='active'?'▶️':'▫️'} ${n+1}. ${step}`).join('\n');
  const desc=[`**${w.title}**`,`القالب: **${w.template_name}**`,`الحالة: ${WORKFLOW_ICON[w.status]??'•'} **${WORKFLOW_STATUS[w.status]??w.status}**`,`الفريق: **${w.team_name}**`,`المسؤول: ${w.owner_user_id?`<@${w.owner_user_id}>`:'غير معيّن'}`,`الموعد: ${w.due_at?`<t:${unix(w.due_at)}:F> • <t:${unix(w.due_at)}:R>`:'غير محدد'}`,'',`**الخطوات (${steps.length?idx+1:0}/${steps.length})**`,stepLines||'لا توجد خطوات.'].join('\n');
  const buttons=[];if(manage){buttons.push(btn(`ops:wf-owner:${w.id}`,'المسؤول',ButtonStyle.Secondary,'👤'),btn(`ops:wf-team:${w.id}`,'الفريق',ButtonStyle.Secondary,'👥'),btn(`ops:wf-due:${w.id}`,'الموعد',ButtonStyle.Secondary,'🕒'));if(w.status==='active')buttons.push(btn(`ops:wf-advance:${w.id}`,'إنجاز الخطوة الحالية',ButtonStyle.Success,'✅'),btn(`ops:wf-block:${w.id}`,'تعطيل مؤقت',ButtonStyle.Danger,'⏸️'));if(w.status==='blocked')buttons.push(btn(`ops:wf-resume:${w.id}`,'استئناف',ButtonStyle.Success,'▶️'));if(!['completed','cancelled'].includes(w.status))buttons.push(btn(`ops:wf-cancel:${w.id}`,'إلغاء المسار',ButtonStyle.Danger,'⛔'));}
  return i.update({embeds:[e('🔁 مسار عمل مؤسسي',desc.slice(0,4000))],components:withNavigation(rowsFromButtons(buttons),'ops:workflows','مسارات العمل')});
}
async function workflowOwnerPicker(i,a,s,id){await workflowAccess(a,s,id,true);return i.update({content:'اختر مسؤول مسار العمل:',embeds:[],components:withNavigation([userSelect(`ops:wf-owner-set:${id}`,'مسؤول المسار')],`ops:wf:view:${id}`,'العودة للمسار')});}
async function workflowOwnerSet(i,a,s,id){await workflowAccess(a,s,id,true);await a.operationsService.setWorkflowOwner({workflowId:id,guildId:s.guildId,actorId:s.userId,ownerUserId:i.values[0]});return workflowView(i,a,s,id);}
async function workflowTeamPicker(i,a,s,id){
  await workflowAccess(a,s,id,true);const ac=await access(a,s);const globalManage=ac.isOwner||ac.isSuperAdmin||await a.permissionService.has(s,'workflows.manage',{});
  const teams=await a.teams.list(s.guildId);const options=[];
  if(globalManage)options.push({label:'عام — بدون فريق محدد',value:'__global__',description:'نطاق المبادرة بالكامل'});
  for(const team of teams)if(globalManage||await a.permissionService.has(s,'workflows.manage',{teamId:team.id}))options.push({label:team.name,value:String(team.id),description:'ربط المسار بهذا الفريق'});
  if(!options.length)throw new AppError('FORBIDDEN','لا يوجد فريق تملك عليه صلاحية إدارة المسارات.');
  return i.update({content:'اربط المسار بالفريق المسؤول أو المعني:',embeds:[],components:withNavigation([stringSelect(`ops:wf-team-set:${id}`,'الفريق / النطاق',options.slice(0,25))],`ops:wf:view:${id}`,'العودة للمسار')});
}
async function workflowTeamSet(i,a,s,id){
  await workflowAccess(a,s,id,true);const selected=String(i.values[0]);const teamId=selected==='__global__'?null:selected;
  const ac=await access(a,s);const allowed=ac.isOwner||ac.isSuperAdmin||await a.permissionService.has(s,'workflows.manage',teamId?{teamId}:{});
  if(!allowed)throw new AppError('FORBIDDEN','ليس لديك صلاحية إدارة المسارات في الفريق المحدد.');
  await a.operationsService.setWorkflowTeam({workflowId:id,guildId:s.guildId,actorId:s.userId,teamId});return workflowView(i,a,s,id);
}
async function workflowDueModal(i,a,s,id){const {row}=await workflowAccess(a,s,id,true);const settings=await a.guilds.getSettings(s.guildId);return i.showModal(new ModalBuilder().setCustomId(`ops:wf-due-save:${id}`).setTitle('موعد مسار العمل').addComponents(input('due','الموعد YYYY-MM-DD HH:mm',{required:false,value:row.due_at?formatDate(row.due_at,settings.timezone):'',placeholder:'2026-09-30 18:00',maxLength:16})));}
async function workflowDueSave(i,a,s,id){await workflowAccess(a,s,id,true);const settings=await a.guilds.getSettings(s.guildId);const value=i.fields.getTextInputValue('due').trim();await a.operationsService.setWorkflowDue({workflowId:id,guildId:s.guildId,actorId:s.userId,dueAt:value?parseLocalDateTime(value,settings.timezone):null});return workflowView(i,a,s,id);}
async function workflowAdvance(i,a,s,id){await workflowAccess(a,s,id,true);await a.operationsService.advanceWorkflow({workflowId:id,guildId:s.guildId,actorId:s.userId});return workflowView(i,a,s,id);}
async function workflowStatus(i,a,s,id,status){await workflowAccess(a,s,id,true);await a.operationsService.setWorkflowStatus({workflowId:id,guildId:s.guildId,actorId:s.userId,status});return workflowView(i,a,s,id);}
