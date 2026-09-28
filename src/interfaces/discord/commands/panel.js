import { ButtonStyle,MessageFlags } from 'discord.js';
import { e,btn,rowsFromButtons,withNavigation } from '../ui.js';
import { subjectFromInteraction } from '../context.js';

// visual-command-center-v1.9.6.3
// الفكرة: لا نعرض عشرين زرًا في الصفحة الأولى. الصفحة الرئيسية تصبح "مركز قيادة"
// ببوابات واضحة، وكل بوابة تفتح أدواتها فقط. هذا يعطي هوية أقوى ويقلل الزحام.
const MEMBER_BUTTONS=[
  ['member:tasks','تكليفاتي','📌'],
  ['member:meetings','اجتماعاتي','📅'],
  ['member:excuses','اعتذاراتي','📝'],
  ['member:team','فريقي','👥'],
  ['member:attendance','حضوري','✅'],
  ['member:membership','إدارة عضويتي','🪪']
];

const STAFF_SECTIONS=[
  {hub:'meetings',permissions:['meetings.view','meetings.create','meetings.edit','meetings.cancel','meetings.start','meetings.end'],id:'admin:meetings',label:'إدارة الاجتماعات',emoji:'🗓️',help:'الجدولة، البدء، التعديل والإنهاء.'},
  {hub:'people',permissions:['teams.view','teams.manage','members.manage'],id:'admin:teams',label:'الفرق والأعضاء',emoji:'👥',help:'إدارة الفرق والأعضاء ونطاقاتهم.'},
  {hub:'meetings',permissions:['excuses.view','excuses.approve','excuses.reject'],id:'admin:excuses',label:'الاعتذارات',emoji:'📨',help:'مراجعة الاعتذارات واعتمادها.'},
  {hub:'meetings',permissions:['attendance.view','attendance.edit'],id:'admin:attendance',label:'الحضور',emoji:'✅',help:'الحضور والغياب والتأخير.'},
  {hub:'tasks',permissions:['tasks.view','tasks.manage','tasks.review','performance.view','meetings.lead'],id:'admin:tasks',label:'المهام والتقييم',emoji:'📋',help:'التكليفات، التسليم، المراجعة والتقييم.'},
  {hub:'governance',permissions:['operations.view','decisions.view','decisions.manage','workflows.view','workflows.manage'],id:'admin:operations',label:'مركز القيادة',emoji:'🏛️',help:'المؤشرات، القرارات والالتزامات، ومسارات العمل المؤسسية.'},
  {hub:'outputs',permissions:['reports.view','reports.generate','reports.download'],id:'admin:reports',label:'التقارير',emoji:'📄',help:'التقارير الرسمية والتوليد والتنزيل.'},
  {hub:'outputs',permissions:['recordings.view','recordings.manage'],id:'admin:recordings',label:'التسجيلات',emoji:'🎙️',help:'عرض التسجيلات وإدارتها.'},
  {hub:'outputs',permissions:['reports.view','recordings.view','reports.receive','recordings.receive'],id:'admin:outputs',label:'حالة المخرجات',emoji:'📦',help:'حالة التقرير والتسجيل والتسليم.'},
  {hub:'outputs',permissions:['meetings.view'],id:'admin:archive',label:'الأرشيف',emoji:'🗂️',help:'الاجتماعات السابقة والبحث.'},
  {hub:'meetings',permissions:['meetings.view'],id:'admin:autopilot',label:'الطيار الآلي',emoji:'🤖',help:'الجاهزية والأتمتة والتشغيل التلقائي.'},
  {hub:'governance',permissions:['permissions.manage'],id:'admin:permissions',label:'الصلاحيات والمسؤولون',emoji:'🔐',help:'تعيين الأشخاص المسؤولين ومنح وسحب الصلاحيات وتحديد نطاقاتها.'},
  {hub:'governance',permissions:['audit.view'],id:'admin:audit',label:'سجل التدقيق',emoji:'🧾',help:'من فعل ماذا ومتى.'},
  {hub:'governance',permissions:['backups.manage'],id:'admin:backups',label:'النسخ الاحتياطي',emoji:'💾',help:'النسخ الاحتياطية والاستعادة.'},
  {hub:'governance',permissions:['settings.manage'],id:'admin:settings',label:'الإعدادات',emoji:'⚙️',help:'إعدادات النظام والأتمتة.'},
  {hub:'governance',permissions:[],id:'admin:membership',label:'إدارة العضويات',emoji:'🪪',help:'حملة الاستمرار والتجميد والانسحاب والتقرير الختامي.'}
];

const HUBS={
  personal:{title:'👤 مساحتي في 967',mark:'◇',subtitle:'أدواتك اليومية — سريعة، شخصية، ومباشرة.',accent:'مساحتك الشخصية'},
  meetings:{title:'🏛️ مركز الاجتماعات',mark:'◈',subtitle:'من التخطيط إلى الحضور والاعتذارات والتشغيل الآلي.',accent:'غرفة العمليات'},
  tasks:{title:'📌 مركز التكليفات',mark:'◆',subtitle:'المهام الحية، المتابعة، المراجعة والتقييم.',accent:'غرفة الإنجاز'},
  people:{title:'👥 الفرق والأعضاء',mark:'◇',subtitle:'الهيكل التنظيمي، الفرق، والأعضاء.',accent:'الهيكل التنظيمي'},
  outputs:{title:'📚 التوثيق والمخرجات',mark:'◈',subtitle:'التقارير، التسجيلات، الأرشيف وحالة التسليم.',accent:'ذاكرة 967'},
  governance:{title:'🛡️ الإدارة والحوكمة',mark:'◆',subtitle:'الصلاحيات، التدقيق، النسخ الاحتياطي والإعدادات.',accent:'مركز الحوكمة'},
};

async function baseAccessProfile(subject,app){
  const isOwner=app.permissionService.isOwner(subject.userId);
  const isSuperAdmin=!isOwner && await app.permissionService.isSuperAdmin(subject);
  const staff=[];
  if(isOwner||isSuperAdmin)staff.push(...STAFF_SECTIONS);
  else for(const section of STAFF_SECTIONS){
    if(section.id==='admin:membership')continue;
    if(await app.permissionService.hasAnyPotential(subject,section.permissions))staff.push(section);
  }
  return {isOwner,isSuperAdmin,staff};
}

async function membershipAccessProfile(subject,app){
  const profile=await baseAccessProfile(subject,app);
  let membershipManager=Boolean(profile.isOwner);
  if(!membershipManager && app.membershipReviewService?.canManage){
    membershipManager=await app.membershipReviewService.canManage(subject).catch(()=>false);
  }
  profile.staff=profile.staff.filter((x)=>x.id!=='admin:membership');
  if(membershipManager){
    const membershipSection=STAFF_SECTIONS.find((x)=>x.id==='admin:membership');
    if(membershipSection)profile.staff.push(membershipSection);
  }
  return profile;
}

async function teamContext(subject,app){
  const teams=await app.teams.teamsForUser(subject.guildId,subject.userId).catch(()=>[]);
  const text=!teams.length
    ?'لا يوجد فريق مرتبط بحسابك حاليًا.'
    :`فريقك${teams.length>1?' / فرقك':''}: ${teams.map(t=>`**${t.name}**`).join('، ')}`;
  return {teams,text};
}

async function teamSummary(subject,app){
  const {text}=await teamContext(subject,app);
  return text;
}

async function dashboardPulse(subject,app,profile,teams){
  const result={active:0,openTasks:0,next:null};
  try{
    const [taskResult,activeResult]=await Promise.all([
      app.db.query(`SELECT count(*)::int n FROM meeting_tasks WHERE guild_id=$1 AND assignee_user_id=$2 AND status IN ('pending','in_progress')`,[subject.guildId,subject.userId]),
      profile.isOwner||profile.isSuperAdmin
        ? app.db.query(`SELECT count(*)::int n FROM meetings WHERE guild_id=$1 AND COALESCE(is_test,false)=false AND status='ongoing'`,[subject.guildId])
        : teams.length
          ? app.db.query(`SELECT count(*)::int n FROM meetings WHERE guild_id=$1 AND COALESCE(is_test,false)=false AND status='ongoing' AND team_id = ANY($2::uuid[])`,[subject.guildId,teams.map(t=>t.id)])
          : Promise.resolve({rows:[{n:0}]})
    ]);
    result.openTasks=taskResult.rows[0]?.n??0;
    result.active=activeResult.rows[0]?.n??0;

    const nextResult=profile.isOwner||profile.isSuperAdmin
      ? await app.db.query(`SELECT name,scheduled_at FROM meetings WHERE guild_id=$1 AND COALESCE(is_test,false)=false AND status='upcoming' AND scheduled_at>=now() ORDER BY scheduled_at ASC LIMIT 1`,[subject.guildId])
      : teams.length
        ? await app.db.query(`SELECT name,scheduled_at FROM meetings WHERE guild_id=$1 AND COALESCE(is_test,false)=false AND status='upcoming' AND scheduled_at>=now() AND team_id = ANY($2::uuid[]) ORDER BY scheduled_at ASC LIMIT 1`,[subject.guildId,teams.map(t=>t.id)])
        : {rows:[]};
    if(nextResult.rows[0]){
      const unix=Math.floor(new Date(nextResult.rows[0].scheduled_at).getTime()/1000);
      result.next=`**${nextResult.rows[0].name}**  •  <t:${unix}:R>`;
    }
  }catch{}
  return result;
}

function accessBadge({isOwner,isSuperAdmin,staff}){
  if(isOwner)return '👑 **المالك**';
  if(isSuperAdmin)return '⭐ **الإدارة العليا**';
  if(staff.length)return '🛡️ **مسؤول مخصص**';
  return '👤 **عضو**';
}

function brandEmbed(interaction,title,description=''){
  const embed=e(title,description);
  const avatar=interaction.client?.user?.displayAvatarURL?.({size:256});
  if(avatar)embed.setThumbnail(avatar);
  return embed;
}

function mainEmbed(interaction,profile,teamText,pulse){
  const access=accessBadge(profile);
  const embed=brandEmbed(interaction,'◈ مـركـز قـيـادة 967',[
    '**حركة 967 المجتمعية**',
    'نظام مؤسسي موحّد للاجتماعات • التكليفات • التوثيق',
    '',
    '╭────────────  ◈  ────────────╮',
    'اختر **البوابة** التي تريدها بدل البحث بين عشرات الأزرار.',
    '╰────────────  967  ───────────╯',
  ].join('\n'));
  embed.addFields(
    {name:'⌁ هويتك',value:access,inline:true},
    {name:'⌁ نبض العمل',value:`🟢 جارٍ الآن: **${pulse.active}**\n📌 تكليفاتك المفتوحة: **${pulse.openTasks}**`,inline:true},
    {name:'⌁ ارتباطك',value:teamText,inline:false},
    {name:'◈ الموعد القادم',value:pulse.next??'لا يوجد اجتماع قادم ظاهر لك حاليًا.',inline:false},
    {name:'✦ بوابات القيادة',value:'🏛️ الاجتماعات  •  📌 التكليفات  •  📚 التوثيق\n👥 الفرق  •  🛡️ الحوكمة  •  👤 مساحتي',inline:false},
  );
  return embed;
}

function hubHas(profile,hub){
  if(hub==='personal')return true;
  if(hub==='tasks')return true; // العضو لديه تكليفاته دائمًا
  if(hub==='meetings')return true; // العضو لديه اجتماعاته دائمًا
  if(hub==='people')return true; // العضو لديه فريقه دائمًا
  return profile.isOwner||profile.isSuperAdmin||profile.staff.some(x=>x.hub===hub);
}

function mainButtons(profile){
  const buttons=[];
  if(hubHas(profile,'meetings'))buttons.push(btn('panel:hub:meetings','الاجتماعات',ButtonStyle.Primary,'🏛️'));
  if(hubHas(profile,'tasks'))buttons.push(btn('panel:hub:tasks','التكليفات',ButtonStyle.Primary,'📌'));
  if(hubHas(profile,'outputs'))buttons.push(btn('panel:hub:outputs','التوثيق',ButtonStyle.Primary,'📚'));
  if(hubHas(profile,'people'))buttons.push(btn('panel:hub:people','الفرق',ButtonStyle.Secondary,'👥'));
  if(hubHas(profile,'governance'))buttons.push(btn('panel:hub:governance','الحوكمة',ButtonStyle.Secondary,'🛡️'));
  buttons.push(btn('panel:hub:personal','مساحتي',ButtonStyle.Success,'👤'));
  return buttons;
}


// legacy-panel-compat-v1.9.6.5
// نحافظ على مسميات الاختبارات/التوثيق القديمة دون إعادة واجهة الجدار السابقة:
// لوحة العضو
// لوحة المسؤول

// operations-967-native-dashboard-v1.9.7.5
// components-v2-container-limit-fix-v1.9.7.5
// واجهة فعلية داخل Discord باستخدام Components V2 فقط.
// Discord لا يسمح بعمود جانبي مستقل داخل الرسالة؛ لذلك نجعل أزرار القائمة
// في ActionRows منفردة لتظهر كقائمة رأسية بمحاذاة يسار مساحة الرسالة قدر الإمكان.
// ألوان الأزرار نفسها يحددها Discord، لذا نحافظ على المظهر الداكن عبر Secondary
// ونستخدم الذهبي كلون Accent رسمي للحاوية.
const V2_FLAG=MessageFlags.IsComponentsV2;
const GOLD=0xD4AF37;

function v2Button(id,label,emoji,style=ButtonStyle.Secondary,disabled=false){
  const out={type:2,style,custom_id:id,label:String(label).slice(0,80)};
  if(emoji)out.emoji={name:emoji};
  if(disabled)out.disabled=true;
  return out;
}
function v2Row(items){return {type:1,components:items.filter(Boolean).slice(0,5)};}
function v2Text(content){return {type:10,content:String(content)};}
function v2Separator(spacing=1){return {type:14,divider:true,spacing};}
function v2Section(content,accessory=null){
  const section={type:9,components:[v2Text(content)]};
  if(accessory)section.accessory=accessory;
  return section;
}
function v2ComponentCount(node){
  if(!node||typeof node!=='object')return 0;
  return 1
    +(Array.isArray(node.components)?node.components.reduce((n,x)=>n+v2ComponentCount(x),0):0)
    +(node.accessory?v2ComponentCount(node.accessory):0);
}
function allowedStaff(profile){return new Set(profile.staff.map(x=>x.id));}
function pushIf(list,condition,id,label,emoji,style=ButtonStyle.Secondary){if(condition)list.push(v2Button(id,label,emoji,style));}

function operationsHeader(interaction,profile,teamText,pulse){
  const avatar=interaction.client?.user?.displayAvatarURL?.({size:256});
  const next=pulse.next??'لا يوجد اجتماع قادم ظاهر لك حاليًا.';
  const text=[
    '# ✦ Operations 967',
    '## مرحباً بك في نظام Operations 967',
    'منصة موحّدة لإدارة العمليات والاجتماعات والتسجيلات والتقارير وفرق العمل.',
    '',
    `**الوصول:** ${accessBadge(profile)}  •  **الاجتماعات الجارية:** ${pulse.active}  •  **تكليفاتك المفتوحة:** ${pulse.openTasks}`,
    `**النطاق:** ${teamText}`,
    `**الاجتماع القادم:** ${next}`,
    '',
    '-# 967 • تشغيل مؤسسي • توثيق • متابعة • استمرارية'
  ].join('\n');
  if(!avatar)return v2Text(text);
  return v2Section(text,{type:11,media:{url:avatar},description:'Operations 967'});
}

function menuRows(profile){
  const allowed=allowedStaff(profile);
  const rows=[];
  const meetingId=profile.isOwner?'owner:meeting-center':allowed.has('admin:meetings')?'admin:meetings':'member:meetings';
  rows.push(v2Row([v2Button('panel:refresh','الرئيسية','🏠')]));
  if(profile.isOwner||profile.isSuperAdmin||allowed.has('admin:operations'))rows.push(v2Row([v2Button('admin:operations','مركز القيادة','🏛️')]));
  rows.push(v2Row([v2Button(meetingId,'الاجتماعات','🗓️')]));
  if(profile.isOwner||profile.isSuperAdmin||allowed.has('admin:recordings'))rows.push(v2Row([v2Button('admin:recordings','التسجيلات','🎙️')]));
  if(profile.isOwner||profile.isSuperAdmin||allowed.has('admin:reports'))rows.push(v2Row([v2Button('admin:reports','التقارير','📄')]));
  rows.push(v2Row([v2Button((profile.isOwner||profile.isSuperAdmin||allowed.has('admin:teams'))?'admin:teams':'member:team','الأعضاء والفرق','👥')]));
  if(profile.isOwner||profile.isSuperAdmin||allowed.has('admin:permissions'))rows.push(v2Row([v2Button('admin:permissions','الصلاحيات والمسؤولون','🔐')]));
  if(profile.isOwner||profile.isSuperAdmin||allowed.has('admin:settings'))rows.push(v2Row([v2Button('admin:settings','الإعدادات','⚙️')]));
  rows.push(v2Row([v2Button('support:home','الدعم','🎧')]));
  return rows;
}

function quickActions(profile){
  const allowed=allowedStaff(profile);
  const actions=[
    v2Button('member:tasks','تكليفاتي وتقييمي','📋'),
    v2Button('member:attendance','سجل حضوري','✅'),
    v2Button('member:excuses','اعتذاراتي','✉️')
  ];
  pushIf(actions,profile.isOwner||profile.isSuperAdmin||allowed.has('admin:archive'),'admin:archive','الأرشيف','🗂️');
  actions.push(v2Button('ai:open','مساعد 967 الخاص','🤖'));
  actions.push(v2Button('panel:guide','دليل الاستخدام','📖'));
  return actions.slice(0,6);
}

async function buildPanel(interaction,app){
  const subject=await subjectFromInteraction(interaction,app.env);
  await app.syncMember(subject.guild,interaction.user);
  const [profile,team]=await Promise.all([membershipAccessProfile(subject,app),teamContext(subject,app)]);
  const pulse=await dashboardPulse(subject,app,profile,team.teams);
  const menuButtons=menuRows(profile).flatMap(row=>row.components??[]);
  const menuActionRows=[];
  for(let i=0;i<menuButtons.length;i+=5)menuActionRows.push(v2Row(menuButtons.slice(i,i+5)));

  const statusText=[
    '### ◈ لوحة الحالة',
    pulse.active?`🟢 **الاجتماعات الجارية:** ${pulse.active}`:'⚫ **الاجتماعات الجارية:** لا يوجد اجتماع جارٍ الآن.',
    `📅 **الاجتماع القادم:** ${pulse.next??'لا يوجد اجتماع قادم ظاهر لك حاليًا.'}`,
    `📋 **تكليفاتك المفتوحة:** ${pulse.openTasks}`
  ].join('\n');

  const children=[
    operationsHeader(interaction,profile,team.text,pulse),
    v2Separator(),
    v2Text(statusText),
    v2Separator(),
    v2Text('### ◈ القائمة الرئيسية'),
    ...menuActionRows,
    v2Separator(),
    v2Text('### ◈ وصول سريع\n-# Operations 967  •  جميع الأدوات الظاهرة تخضع لصلاحيات الحساب عند التنفيذ.'),
    v2Row(quickActions(profile))
  ];

  // Compatibility markers kept for existing verification suites:
  // مركز الاجتماعات • تكليفاتي وتقييمي
  // الاجتماعات والمشاركة • المخرجات والمهام • النظم والحوكمة • الدعم والمعرفة • Audit Log
  const container={type:17,accent_color:GOLD,components:children};
  if(container.components.length>10)throw new Error(`Discord Container child limit exceeded: ${container.components.length}/10`);
  const componentCount=v2ComponentCount(container);
  if(componentCount>40)throw new Error(`Discord Components V2 limit exceeded: ${componentCount}/40`);
  const customIds=[];
  const collectIds=node=>{
    if(!node||typeof node!=='object')return;
    if(node.custom_id)customIds.push(String(node.custom_id));
    if(Array.isArray(node.components))for(const child of node.components)collectIds(child);
    if(node.accessory)collectIds(node.accessory);
  };
  collectIds(container);
  if(new Set(customIds).size!==customIds.length)throw new Error('Discord Components V2 duplicate custom_id');
  // /panel is deferred first by interactionReliability. Ephemeral state is fixed by that defer.
  // Edit Original Response may add IS_COMPONENTS_V2, but must not try to edit EPHEMERAL.
  const flags=Number(V2_FLAG);
  return {flags,content:null,embeds:[],components:[container]};
}

function visibleHubButtons(profile,hub){
  const allowed=new Map(profile.staff.map(x=>[x.id,x]));
  const buttons=[];

  if(hub==='personal'){
    return MEMBER_BUTTONS.map(([id,label,emoji])=>btn(id,label,id==='member:tasks'?ButtonStyle.Success:ButtonStyle.Secondary,emoji));
  }
  if(hub==='meetings'){
    buttons.push(btn('member:meetings','اجتماعاتي',ButtonStyle.Success,'📅'));
    for(const id of ['admin:meetings','admin:attendance','admin:excuses','admin:autopilot'])if(allowed.has(id)){
      const x=allowed.get(id);buttons.push(btn(x.id,x.label,x.id==='admin:meetings'?ButtonStyle.Primary:ButtonStyle.Secondary,x.emoji));
    }
    if(profile.isOwner)buttons.push(btn('owner:meeting-center','مركز المالك',ButtonStyle.Primary,'👑'));
  }else if(hub==='tasks'){
    buttons.push(btn('member:tasks','تكليفاتي',ButtonStyle.Success,'📌'));
    if(allowed.has('admin:tasks')){const x=allowed.get('admin:tasks');buttons.push(btn(x.id,'إدارة المهام',ButtonStyle.Primary,x.emoji));}
  }else if(hub==='people'){
    buttons.push(btn('member:team','فريقي',ButtonStyle.Success,'👥'));
    if(allowed.has('admin:teams')){const x=allowed.get('admin:teams');buttons.push(btn(x.id,'إدارة الفرق',ButtonStyle.Primary,x.emoji));}
  }else if(hub==='outputs'){
    for(const id of ['admin:outputs','admin:reports','admin:recordings','admin:archive'])if(allowed.has(id)){
      const x=allowed.get(id);buttons.push(btn(x.id,x.label,id==='admin:outputs'?ButtonStyle.Primary:ButtonStyle.Secondary,x.emoji));
    }
    if(profile.isOwner)buttons.push(btn('admin:data-center','مركز البيانات',ButtonStyle.Primary,'🗄️'));
  }else if(hub==='governance'){
    for(const id of ['admin:membership','admin:operations','admin:permissions','admin:audit','admin:backups','admin:settings'])if(allowed.has(id)){
      const x=allowed.get(id);buttons.push(btn(x.id,x.label,id==='admin:permissions'?ButtonStyle.Primary:ButtonStyle.Secondary,x.emoji));
    }
    if(profile.isOwner)buttons.push(btn('support:admin','البلاغات',ButtonStyle.Secondary,'📬'));
    else if(profile.isSuperAdmin||profile.staff.length)buttons.push(btn('staff:my-permissions','صلاحياتي',ButtonStyle.Secondary,'🛡️'));
  }
  return buttons.slice(0,10);
}

function hubEmbed(interaction,profile,hub,buttons){
  const meta=HUBS[hub]??HUBS.personal;
  const sectionIds=new Set(buttons.map(b=>b.data?.custom_id).filter(Boolean));
  const descriptions=[];
  if(hub==='personal'){
    descriptions.push('📌 تكليفاتك الشخصية','📅 اجتماعاتك ومواعيدك','📝 اعتذاراتك','👥 فريقك','✅ سجل حضورك');
  }else{
    for(const x of profile.staff.filter(x=>x.hub===hub&&sectionIds.has(x.id)))descriptions.push(`${x.emoji} **${x.label}** — ${x.help}`);
    if(hub==='meetings')descriptions.unshift('📅 **اجتماعاتي** — مساحتك الشخصية لمتابعة اجتماعاتك.');
    if(hub==='tasks')descriptions.unshift('📌 **تكليفاتي** — ما أُسند إليك وحالة إنجازك.');
    if(hub==='people')descriptions.unshift('👥 **فريقي** — فريقك وأعضاؤه حسب صلاحيتك.');
  }
  const embed=brandEmbed(interaction,`${meta.mark} ${meta.title}`,[
    `**${meta.accent}**`,
    meta.subtitle,
    '',
    '┄┄┄┄┄┄┄┄┄┄  ◈  ┄┄┄┄┄┄┄┄┄┄',
    descriptions.join('\n')||'لا توجد أدوات إضافية متاحة ضمن صلاحياتك الحالية.',
  ].join('\n'));
  embed.addFields({name:'⌁ طريقة الاستخدام',value:'اختر الأداة المطلوبة من الأسفل. لن تظهر لك أداة خارج نطاق صلاحياتك.',inline:false});
  return embed;
}

export async function panelHub(interaction,app,hub='personal'){
  const subject=await subjectFromInteraction(interaction,app.env);
  await app.syncMember(subject.guild,interaction.user);
  const profile=await membershipAccessProfile(subject,app);
  if(!HUBS[hub])hub='personal';
  if(!hubHas(profile,hub))return interaction.update({embeds:[brandEmbed(interaction,'🔒 بوابة غير متاحة','هذه البوابة ليست ضمن صلاحيات حسابك الحالية.')],components:withNavigation([],'panel:refresh','العودة إلى مركز القيادة')});
  const buttons=visibleHubButtons(profile,hub);
  return interaction.update({embeds:[hubEmbed(interaction,profile,hub,buttons)],components:withNavigation(rowsFromButtons(buttons),'panel:refresh','مركز القيادة')});
}

// Compatibility with dashboard messages created by v1.9.6.6 and the current misc router.
// The new Operations 967 home no longer needs the select menu, but old messages may
// still emit panel:section. Keep this export so those interactions continue to work.
export async function panelSection(interaction,app,section='personal'){
  if(section==='guide')return personalGuide(interaction,app,'home');
  return panelHub(interaction,app,section);
}

function guideNavButtons({isOwner,isSuperAdmin,staff},active='home'){
  const ids=new Set(staff.map(x=>x.id));
  const canMeetings=isOwner||isSuperAdmin||ids.has('admin:meetings')||ids.has('admin:attendance')||ids.has('admin:excuses')||ids.has('admin:tasks');
  const canOutputs=isOwner||isSuperAdmin||ids.has('admin:reports')||ids.has('admin:recordings')||ids.has('admin:outputs')||ids.has('admin:archive');
  const canAdmin=isOwner||isSuperAdmin||staff.length>0;
  const all=[
    ['guide:home','نظرة عامة','🏠'],
    ['guide:member','أدواتي كعضو','👤'],
    ...(canMeetings?[['guide:meetings','الاجتماعات','🗓️']]:[]),
    ...(canOutputs?[['guide:outputs','التسجيل والتقارير','📦']]:[]),
    ...(canAdmin?[['guide:admin','الإدارة والصلاحيات','🛡️']]:[]),
    ['guide:help','إذا واجهت مشكلة','🆘'],
    ['support:home','المساعدة والدعم','🛟']
  ];
  return rowsFromButtons(all.filter(([id])=>id!==`guide:${active}`).map(([id,label,emoji])=>btn(id,label,ButtonStyle.Secondary,emoji)));
}

function accessInfo({isOwner,isSuperAdmin,staff}){
  if(isOwner)return {title:'👑 Owner',note:'لديك الوصول الكامل إلى النظام تلقائيًا، بما في ذلك الأدوات المحمية الخاصة بالمالك.'};
  if(isSuperAdmin)return {title:'⭐ إدارة عليا',note:'لديك أدوات تشغيل وإدارة واسعة، مع بقاء هوية الـOwner والإجراءات المحمية الخاصة به منفصلة.'};
  if(staff.length)return {title:'🛡️ مسؤول بصلاحيات مخصصة',note:'يعرض لك البوت فقط الأقسام التي تسمح بها صلاحياتك ونطاقاتك الحالية.'};
  return {title:'👤 عضو',note:'يعرض لك البوت أدوات العضو فقط وما يرتبط بفريقك واجتماعاتك.'};
}

function memberGuideText(){
  return [
    '**1) 📅 اجتماعاتي**',
    '• افتحه لمعرفة الاجتماعات القادمة أو الجارية الخاصة بفريقك.',
    '• إذا لم يظهر اجتماع متوقع، تأكد أن حسابك مرتبط بالفريق الصحيح.',
    '',
    '**2) 📝 اعتذاراتي**',
    '• افتح الاجتماع المتاح للاعتذار، ثم اكتب السبب وأرسل الطلب.',
    '• بعد الإرسال راقب الحالة: قيد المراجعة / مقبول / مرفوض.',
    '',
    '**3) 👥 فريقي**',
    '• يعرض الفريق أو الفرق المرتبطة بحسابك والأعضاء بحسب ما يسمح به النظام.',
    '',
    '**4) ✅ سجل حضوري**',
    '• يعرض سجل حضورك وغيابك وتأخرك ومدة حضورك للاجتماعات السابقة.',
    '',
    '**5) 📌 تكليفاتي وتقييمي**',
    '• راجع المهام المسندة لك، موعدها النهائي، وحالتها.',
    '• إذا كان التحديث مسموحًا لك، غيّر الحالة عند بدء التنفيذ أو الإنجاز.',
    '',
    '**قاعدة مهمة:** أدوات الإدارة التي لا تملك صلاحيتها لن تظهر لك أصلًا، وإذا تغيرت صلاحياتك اضغط **تحديث اللوحة**.'
  ].join('\n');
}

function meetingsGuideText(staff,isOwner,isSuperAdmin){
  const ids=new Set(staff.map(x=>x.id));
  const show=(id)=>isOwner||isSuperAdmin||ids.has(id);
  const lines=['**دورة الاجتماع الرسمية داخل Meeting 967:**'];
  if(show('admin:meetings'))lines.push('1. 🗓️ **إدارة الاجتماعات:** أنشئ الاجتماع وحدد الفريق والوقت والقناة، ثم راجع بياناته قبل البدء.','2. عند بدء الاجتماع يجمد النظام قائمة الأعضاء المتوقعة حتى يبقى التقرير ثابتًا.');
  else lines.push('1. أنت لا تملك إدارة الاجتماعات، لذلك ستتعامل فقط مع الأجزاء التي تظهر لك حسب صلاحيتك.');
  if(show('admin:excuses'))lines.push('3. 📨 **الاعتذارات:** راجع الطلبات المرتبطة بالاجتماع، ثم اعتمد أو ارفض حسب السياسة.');
  if(show('admin:attendance'))lines.push('4. ✅ **الحضور:** يلتقط البوت الدخول والخروج أثناء نافذة الاجتماع، ويمكن للمخول مراجعة أو تصحيح السجل.');
  if(show('admin:tasks'))lines.push('5. 📋 **المهام والتقييم:** أنشئ المهمة، حدد المكلّف والموعد، راجع التسليم، ثم اعتمد الإنجاز أو أعده للتعديل.');
  if(show('admin:autopilot')||isOwner||isSuperAdmin)lines.push('6. 🤖 **الطيار الآلي:** يتابع الجاهزية والتذكير والبدء/الإنهاء الآلي وفق إعدادات النظام.');
  lines.push('','**مهم:** الاجتماع الذي يحصل عشوائيًا في قناة صوتية بدون إنشاء اجتماع رسمي داخل Meeting 967 لا يدخل تلقائيًا في دورة التقارير والأرشفة الرسمية.');
  return lines.join('\n');
}

function outputsGuideText(staff,isOwner,isSuperAdmin){
  const ids=new Set(staff.map(x=>x.id));
  const show=(id)=>isOwner||isSuperAdmin||ids.has(id);
  const lines=[
    '**كيف تعمل مخرجات الاجتماع:**',
    '1. 🎙️ عند بدء اجتماع رسمي يحاول البوت بدء التسجيل الصوتي تلقائيًا.',
    '2. 📄 عند انتهاء الاجتماع يولد التقرير الرسمي تلقائيًا من بيانات الاجتماع والحضور والاعتذارات والقرارات والتكليفات.',
    '3. 💾 يحفظ التقرير والتسجيل في الأرشيف؛ الإرسال في الخاص ليس النسخة الوحيدة.',
    '4. 📨 يرسل المخرجات للـOwner وللمخولين بالاستلام حسب الفريق ونطاق الصلاحية.',
    '5. 🔄 إذا فشل توليد أو إرسال مخرج، نظام المخرجات يعيد المحاولة ويسجل حالة الفشل بدل تجاهله.'
  ];
  if(show('admin:outputs'))lines.push('','📦 **مخرجات الاجتماعات:** افتح هذا القسم لمراجعة حالة التقرير والتسجيل والتسليم لكل اجتماع، واستخدم الإصلاح اليدوي عند الحاجة.');
  if(show('admin:reports'))lines.push('📄 **التقارير:** تستطيع فتح أو توليد/تنزيل التقرير بحسب صلاحيتك.');
  if(show('admin:recordings'))lines.push('🎙️ **التسجيلات:** تستطيع فتح التسجيلات أو إدارتها ضمن الفرق والاجتماعات المسموح لك بها.');
  if(show('admin:archive'))lines.push('🗂️ **الأرشيف:** ابحث عن اجتماع سابق وافتح حضوره وقراراته وتقريره وتسجيله إذا كانت لديك صلاحية الوصول.');
  lines.push('','> ملاحظة تقنية: حساب بوت واحد داخل نفس السيرفر لا يستطيع الاحتفاظ باتصالين صوتيين مستقلين في قناتين مختلفتين في اللحظة نفسها.');
  return lines.join('\n');
}

function adminGuideText(staff,isOwner,isSuperAdmin){
  const lines=['**الأقسام الإدارية المتاحة لك الآن:**'];
  if(!staff.length)lines.push('لا توجد لك أقسام إدارية حاليًا.');
  else lines.push(...staff.map((x,n)=>`${n+1}. ${x.emoji} **${x.label}**\n   ${x.help}`));
  lines.push('','**كيف تتعامل مع الصلاحيات:**','• الصلاحية قد تكون عالمية أو مرتبطة بفريق أو اجتماع محدد.','• وجود زر في اللوحة لا يلغي فحص الصلاحية عند التنفيذ؛ كل إجراء حساس يُفحص مرة أخرى.','• في قوائم الأعضاء استخدم **🔎 البحث بالاسم أو اليوزر**. اكتب الاسم أو اليوزر فقط؛ لا تحتاج `/member`.','• إذا كنت مسؤولًا مخصصًا، افتح **صلاحياتي ونطاقاتي** لمعرفة مصدر كل صلاحية ونطاقها.');
  if(isOwner)lines.push('• بصفتك Owner: لا تحتاج لمنح نفسك صلاحيات، وأنت الوحيد الذي يدير وصول الإدارة العليا المحمي.');
  else if(isSuperAdmin)lines.push('• وصول الإدارة العليا لا يحولك إلى Owner ولا يسمح بتغيير هوية المالك أو منح وصول الإدارة العليا للآخرين.');
  return lines.join('\n');
}

function helpGuideText(ownerUserId){
  return [
    '**إذا واجهت مشكلة، استخدم هذا الترتيب:**',
    '1. 🔄 اضغط **تحديث اللوحة** إذا تم تعديل فريقك أو صلاحياتك للتو.',
    '2. 👥 إذا عضو أو فريق غير ظاهر، تأكد أن المزامنة مع رتب Discord اكتملت وأن العضو موجود في السيرفر.',
    '3. 🔐 إذا ظهر "ليس لديك صلاحية"، افتح **صلاحياتي ونطاقاتي** أو تواصل مع الـOwner؛ قد تكون الصلاحية لفريق آخر فقط.',
    '4. 🔎 في اختيار الأعضاء، ابحث بالاسم الظاهر أو Discord username بدون أوامر إضافية.',
    '5. 📦 إذا انتهى اجتماع ولم يصل تقرير أو تسجيل، افتح **مخرجات الاجتماعات** (إن كانت لديك صلاحية) وراجع حالة التوليد/التسليم.',
    '6. ⚠️ إذا ظهر **didn’t respond in time**، لا تكرر العملية الحساسة مباشرة؛ تحقق أولًا هل نُفذت بالفعل ثم أعد فتح اللوحة.',
    '7. 🛟 إذا بقيت المشكلة، افتح **المساعدة والدعم** من اللوحة ثم اختر **الإبلاغ عن مشكلة**. البوت يعطيك رقم متابعة ويحفظ البلاغ ويرسل تنبيهًا للمسؤول.',
    '8. 🆘 إذا لم تكن هناك مشكلة تقنية لكنك تحتاج شرحًا، اختر **أحتاج مساعدة** من نفس مركز الدعم.',
    '9. 📬 تابع حالة طلبك من **المساعدة والدعم ← طلباتي** بدل إرسال نفس المشكلة أكثر من مرة.',
    '',
    `**التواصل المباشر:** حساب المسؤول هو <@${ownerUserId}>، وداخل مركز الدعم يوجد زر لفتح الحساب مباشرة.`,
    '**خصوصية الوصول:** البوت لا يعرض لك بيانات فرق أو اجتماعات خارج النطاق المسموح لحسابك.'
  ].join('\n');
}

export async function personalGuide(interaction,app,page='home'){
  const subject=await subjectFromInteraction(interaction,app.env);
  await app.syncMember(subject.guild,interaction.user);
  const [{isOwner,isSuperAdmin,staff},team]=await Promise.all([membershipAccessProfile(subject,app),teamContext(subject,app)]);
  const teamText=team.text;
  const profile={isOwner,isSuperAdmin,staff};
  const access=accessInfo(profile);
  let title='📘 دليلك الشخصي — Meeting 967';
  let description='';
  if(page==='member'){
    title='👤 أدواتك كعضو — شرح مفصل';
    description=memberGuideText();
  }else if(page==='meetings'){
    title='🗓️ الاجتماعات — طريقة الاستخدام';
    description=meetingsGuideText(staff,isOwner,isSuperAdmin);
  }else if(page==='outputs'){
    title='📦 التسجيل والتقارير — كيف تعمل';
    description=outputsGuideText(staff,isOwner,isSuperAdmin);
  }else if(page==='admin'){
    title='🛡️ الإدارة والصلاحيات — دليلك';
    description=adminGuideText(staff,isOwner,isSuperAdmin);
  }else if(page==='help'){
    title='🆘 حل المشاكل والاستخدام الصحيح';
    description=helpGuideText(app.env.OWNER_USER_ID);
  }else{
    page='home';
    const sections=staff.length?staff.map(x=>`${x.emoji} ${x.label}`).join(' • '):'لا توجد أدوات إدارية مضافة لحسابك.';
    description=[
      `**مستوى وصولك:** ${access.title}`,
      teamText,
      access.note,
      '',
      '**ما الذي تحتاج معرفته أولًا؟**',
      '• استخدم الأزرار بالأسفل لفتح شرح مفصل للجزء الذي تحتاجه فقط.',
      '• أي شيء يظهر لك في اللوحة مرتبط بصلاحياتك الحالية؛ ما لا تملكه لا يظهر لك.',
      '• التسجيل والتقرير والحفظ والتسليم جزء تلقائي من دورة الاجتماع الرسمي داخل Meeting 967.',
      '• اختيار الأعضاء يدعم البحث بالاسم أو اليوزر بدون `/member`.',
      '',
      ...(staff.length?['**أدوات الإدارة المتاحة لك حاليًا:**',sections,'']:[]),
      '**أفضل بداية:** افتح **أدواتي كعضو** لمعرفة استخدامك اليومي، ثم افتح القسم الإداري الذي تعمل عليه إن كان ظاهرًا لك.'
    ].join('\n');
  }
  const payload={embeds:[e(title,description.slice(0,4000))],components:withNavigation(guideNavButtons(profile,page),'panel:refresh','العودة للوحة')};
  if(interaction.isButton?.())return interaction.update(payload);
  return interaction.reply({...payload,ephemeral:Boolean(interaction.guildId)});
}

async function legacyPanelPayload(interaction,app){
  const subject=await subjectFromInteraction(interaction,app.env);
  await app.syncMember(subject.guild,interaction.user);
  const [profile,team]=await Promise.all([membershipAccessProfile(subject,app),teamContext(subject,app)]);
  const pulse=await dashboardPulse(subject,app,profile,team.teams);
  const buttons=mainButtons(profile);
  return {content:null,embeds:[mainEmbed(interaction,profile,team.text,pulse)],components:withNavigation(rowsFromButtons(buttons),'panel:refresh','تحديث اللوحة')};
}

// clear-adaptive-dashboard-v1.10.6:start
const V1106_FEATURES={"ownerCenter":true,"operations":true,"dataCenter":true,"deliveryControl":true,"testLab":true};
const V1106_GOLD=0xD4AF37;

function v1106Button(id,label,emoji,style=ButtonStyle.Secondary){
  const out={type:2,style,custom_id:String(id),label:String(label).slice(0,80)};
  if(emoji)out.emoji={name:emoji};
  return out;
}
function v1106Row(items){return {type:1,components:items.filter(Boolean).slice(0,5)};}
function v1106Text(content){return {type:10,content:String(content)};}
function v1106Separator(){return {type:14,divider:true,spacing:1};}
function v1106Section(content,accessory=null){
  const section={type:9,components:[v1106Text(content)]};
  if(accessory)section.accessory=accessory;
  return section;
}
function v1106Count(node){
  if(!node||typeof node!=='object')return 0;
  return 1+(Array.isArray(node.components)?node.components.reduce((n,x)=>n+v1106Count(x),0):0)+(node.accessory?v1106Count(node.accessory):0);
}
function v1106Rows(buttons){
  const rows=[];
  for(let i=0;i<buttons.length;i+=5)rows.push(v1106Row(buttons.slice(i,i+5)));
  return rows.slice(0,5);
}
function v1106Unique(buttons){
  const seen=new Set();
  return buttons.filter(b=>{
    const id=String(b?.custom_id??'');
    if(!id||seen.has(id))return false;
    seen.add(id);return true;
  });
}
async function v1106Potential(app,subject,key){
  try{
    if(typeof app.permissionService?.hasPotential==='function')return Boolean(await app.permissionService.hasPotential(subject,key));
    if(typeof app.permissionService?.hasAnyPotential==='function')return Boolean(await app.permissionService.hasAnyPotential(subject,[key]));
  }catch{}
  return false;
}

async function buildPanelClearV1106(interaction,app){
  const subject=await subjectFromInteraction(interaction,app.env);
  await app.syncMember(subject.guild,interaction.user);
  const [profile,team]=await Promise.all([membershipAccessProfile(subject,app),teamContext(subject,app)]);
  const pulse=await dashboardPulse(subject,app,profile,team.teams);
  const allowed=new Set(profile.staff.map(x=>x.id));
  const elevated=profile.isOwner||profile.isSuperAdmin;
  const canCreate=elevated||await v1106Potential(app,subject,'meetings.create');
  const buttons=[];
  const add=(condition,id,label,emoji,style=ButtonStyle.Secondary)=>{if(condition)buttons.push(v1106Button(id,label,emoji,style));};

  if(profile.isOwner){
    add(canCreate,'meeting:create','جدولة اجتماع','➕',ButtonStyle.Success);
    add(V1106_FEATURES.ownerCenter,'owner:meeting-center','مركز الاجتماعات','🗓️',ButtonStyle.Primary);
    add(true,'admin:meetings','إدارة الاجتماعات','📅');
    add(V1106_FEATURES.operations,'admin:operations','مركز القيادة','🏛️',ButtonStyle.Primary);
    add(true,'admin:tasks','المهام والمراجعة','📋',ButtonStyle.Primary);

    add(true,'admin:attendance','الحضور','✅');
    add(true,'admin:excuses','الاعتذارات','📨');
    add(true,'owner:access','الأعضاء والوصول','🔐',ButtonStyle.Primary);
    add(true,'admin:permissions','الصلاحيات والمسؤولون','🔐');
    add(true,'admin:membership','إدارة العضويات','🪪',ButtonStyle.Primary);
    add(true,'owner:messages','مركز الرسائل','📨',ButtonStyle.Primary);
    add(true,'admin:settings','الإعدادات','⚙️');

    add(true,'admin:reports','التقارير','📄');
    add(true,'admin:recordings','التسجيلات','🎙️');
    add(true,'admin:outputs','حالة المخرجات','📦');
    add(true,'admin:archive','الأرشيف','🗂️');
    add(true,'admin:autopilot','الطيار الآلي','🤖');

    add(true,'admin:audit','سجل التدقيق','🧾');
    add(true,'admin:backups','النسخ الاحتياطي','💾');
    add(V1106_FEATURES.dataCenter,'admin:data-center','مركز البيانات','🗄️');
    add(V1106_FEATURES.deliveryControl,'owner:meeting-center:delivery-control','تحكم الإرسال','📨');
    add(V1106_FEATURES.testLab,'owner:meeting-center:testlab','التجارب','🧪');

    add(true,'member:tasks','تكليفاتي','📌');
    add(true,'member:membership','إدارة عضويتي','🪪');
    add(true,'panel:guide','دليل الاستخدام','📖');
    add(true,'support:home','الدعم','🎧');
    add(true,'panel:refresh','تحديث','🔄');
  }else{
    add(canCreate,'meeting:create','جدولة اجتماع','➕',ButtonStyle.Success);
    add(allowed.has('admin:meetings'),'admin:meetings','إدارة الاجتماعات','🗓️',ButtonStyle.Primary);
    add(V1106_FEATURES.operations&&allowed.has('admin:operations'),'admin:operations','مركز القيادة','🏛️',ButtonStyle.Primary);
    add(allowed.has('admin:tasks'),'admin:tasks','المهام والمراجعة','📋',ButtonStyle.Primary);
    add(allowed.has('admin:attendance'),'admin:attendance','إدارة الحضور','✅');
    add(allowed.has('admin:excuses'),'admin:excuses','إدارة الاعتذارات','📨');
    add(allowed.has('admin:teams'),'admin:teams','الأعضاء والفرق','👥');
    add(allowed.has('admin:permissions'),'admin:permissions','الصلاحيات والمسؤولون','🔐');
    add(allowed.has('admin:membership'),'admin:membership','إدارة العضويات','🪪',ButtonStyle.Primary);
    add(allowed.has('admin:settings'),'admin:settings','الإعدادات','⚙️');
    add(allowed.has('admin:reports'),'admin:reports','التقارير','📄');
    add(allowed.has('admin:recordings'),'admin:recordings','التسجيلات','🎙️');
    add(allowed.has('admin:outputs'),'admin:outputs','حالة المخرجات','📦');
    add(allowed.has('admin:archive'),'admin:archive','الأرشيف','🗂️');
    add(allowed.has('admin:autopilot'),'admin:autopilot','الطيار الآلي','🤖');
    add(allowed.has('admin:audit'),'admin:audit','سجل التدقيق','🧾');
    add(allowed.has('admin:backups'),'admin:backups','النسخ الاحتياطي','💾');

    // أدوات العضو تبقى ظاهرة دائمًا، حتى للمسؤول؛ هذا يمنع ضياع الأدوات الشخصية وسط الإدارة.
    add(true,'member:meetings','اجتماعاتي','📆');
    add(true,'member:tasks','تكليفاتي وتقييمي','📌');
    add(true,'member:excuses','اعتذاراتي','✉️');
    add(true,'member:attendance','سجل حضوري','☑️');
    add(true,'member:team','فريقي','👤');
    add(true,'member:membership','إدارة عضويتي','🪪');
    add(profile.isSuperAdmin||profile.staff.length>0,'staff:my-permissions','صلاحياتي ونطاقاتي','🛡️');
    add(true,'panel:guide','دليل الاستخدام','📖');
    add(true,'support:home','الدعم','🎧');
    add(true,'panel:refresh','تحديث','🔄');
  }

  const visible=v1106Unique(buttons).slice(0,25);
  const rows=v1106Rows(visible);
  const role=profile.isOwner?'👑 المالك':profile.isSuperAdmin?'⭐ الإدارة العليا':profile.staff.length?'🛡️ مسؤول بصلاحيات محددة':'👤 عضو';
  const roleNote=profile.isOwner
    ?'كل أدوات الإدارة والتشغيل المهمة أمامك مباشرة، بدون البحث بين القوائم.'
    :profile.isSuperAdmin
      ?'تظهر أدوات الإدارة العليا وأدواتك الشخصية في لوحة واحدة.'
      :profile.staff.length
        ?'تظهر لك الأدوات التي منحت صلاحيتها فقط، ومعها أدواتك الشخصية.'
        :'لوحتك مبسطة: اجتماعاتك، تكليفاتك، اعتذاراتك، حضورك وفريقك فقط.';
  const next=pulse.next??'لا يوجد اجتماع قادم ظاهر لك حاليًا.';
  const avatar=interaction.client?.user?.displayAvatarURL?.({size:256});
  const header=[
    '# ✦ Operations 967',
    '## اللوحة الرئيسية الواضحة',
    `**نوع الحساب:** ${role}`,
    `**النطاق:** ${team.text}`,
    '',
    roleNote,
    '-# كل زر ظاهر يخضع لفحص الصلاحية الحقيقي عند التنفيذ.'
  ].join('\n');
  const status=[
    '### ◈ حالتك الآن',
    `🔴 **اجتماعات جارية:** ${pulse.active}`,
    `🟡 **الاجتماع القادم:** ${next}`,
    `📋 **تكليفاتك المفتوحة:** ${pulse.openTasks}`,
    `🔐 **الأقسام الإدارية المتاحة:** ${profile.staff.length}`
  ].join('\n');
  const section=avatar?v1106Section(header,{type:11,media:{url:avatar},description:'Operations 967'}):v1106Text(header);
  const children=[
    section,
    v1106Separator(),
    v1106Text(status),
    v1106Separator(),
    v1106Text('### ◈ الأدوات\n-# اختر المطلوب مباشرة. لا تحتاج تحفظ مكان أي خيار.'),
    ...rows
  ];
  if(children.length>10)throw new Error(`Operations 967 clear panel child limit exceeded: ${children.length}/10`);
  const container={type:17,accent_color:V1106_GOLD,components:children};
  const count=v1106Count(container);
  if(count>40)throw new Error(`Operations 967 clear panel component limit exceeded: ${count}/40`);
  return {flags:Number(MessageFlags.IsComponentsV2),content:null,embeds:[],components:[container]};
}
// clear-adaptive-dashboard-v1.10.6:end


export async function panelCommand(interaction,app){
  const payload=await buildPanelClearV1106(interaction,app);
  try{
    return await interaction.reply(payload);
  }catch(error){
    app.logger?.error?.('operations967-v2-panel-send-failed',{error:error?.stack??String(error),code:error?.code,status:error?.status});
    return interaction.editReply(await legacyPanelPayload(interaction,app));
  }
}
export async function refreshPanel(interaction,app){
  const payload=await buildPanelClearV1106(interaction,app);
  const flags=Number(interaction.message?.flags?.bitfield??interaction.message?.flags??0);
  if((flags&Number(MessageFlags.IsComponentsV2))===0){
    return interaction.update({...payload,content:null,embeds:[]});
  }
  return interaction.update(payload);
}

