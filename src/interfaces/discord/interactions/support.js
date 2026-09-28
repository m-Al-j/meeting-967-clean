import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle} from 'discord.js';
import {e,btn,rowsFromButtons,stringSelect,withNavigation} from '../ui.js';
import {subjectFromInteraction} from '../context.js';
import {AppError} from '../../../core/errors/AppError.js';

const statusAr={open:'مفتوح',in_progress:'قيد المتابعة',resolved:'تم الحل',closed:'مغلق'};
const kindAr={problem:'بلاغ مشكلة',help:'طلب مساعدة'};
const input=(id,label,style=TextInputStyle.Short,required=true,placeholder=null)=>{const x=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);if(placeholder)x.setPlaceholder(placeholder);return new ActionRowBuilder().addComponents(x);};
const shortId=id=>String(id).split('-')[0].toUpperCase();
function contactButton(ownerId){return new ButtonBuilder().setLabel('التواصل مع المسؤول').setStyle(ButtonStyle.Link).setEmoji('💬').setURL(`https://discord.com/users/${ownerId}`);}

export async function handleSupport(i,a){
  const id=i.customId??'';
  if(id==='support:problem')return openRequestModal(i,'problem');
  if(id==='support:help')return openRequestModal(i,'help');
  const s=await subjectFromInteraction(i,a.env);
  if(id==='support:home')return supportHome(i,a,s);
  if(id==='support:submit:problem')return submitRequest(i,a,s,'problem');
  if(id==='support:submit:help')return submitRequest(i,a,s,'help');
  if(id==='support:mine')return myRequests(i,a,s);
  if(id==='support:mine-open')return openRequest(i,a,s,i.values[0],false);
  if(id.startsWith('support:view:'))return openRequest(i,a,s,id.split(':')[2],String(s.userId)===String(a.env.OWNER_USER_ID));
  if(id==='support:admin')return adminRequests(i,a,s);
  if(id==='support:admin-open')return openRequest(i,a,s,i.values[0],true);
  if(id.startsWith('support:status:')){const [, ,requestId,status]=id.split(':');return setStatus(i,a,s,requestId,status);}
  return false;
}

function openRequestModal(i,kind){
  const problem=kind==='problem';
  const modal=new ModalBuilder().setCustomId(`support:submit:${kind}`).setTitle(problem?'الإبلاغ عن مشكلة':'طلب مساعدة');
  modal.addComponents(
    input('subject',problem?'عنوان المشكلة':'ما الذي تحتاج مساعدة فيه؟',TextInputStyle.Short,true,problem?'مثال: التقرير لم يصل':'مثال: أحتاج شرح الصلاحيات'),
    input('category','القسم أو الميزة',TextInputStyle.Short,false,'مثال: الاجتماعات / التسجيل / الصلاحيات'),
    input('description',problem?'اشرح ما حدث بالتفصيل':'اشرح ما تحتاجه',TextInputStyle.Paragraph,true,problem?'ماذا فعلت؟ ماذا ظهر لك؟':'اكتب سؤالك أو الشيء الذي لم تفهمه')
  );
  return i.showModal(modal);
}

async function supportHome(i,a,s){
  const own=await a.support.listForUser(s.guildId,s.userId,{limit:20});
  const open=own.filter(x=>['open','in_progress'].includes(x.status)).length;
  const isOwner=String(s.userId)===String(a.env.OWNER_USER_ID);
  const description=[
    'إذا واجهتك مشكلة أو احتجت مساعدة في استخدام **Meeting 967**، أرسلها من هنا بدل ضياعها في الرسائل.',
    '',
    `طلباتك الحالية: **${own.length}** | قيد المتابعة: **${open}**`,
    '',
    '**🚨 بلاغ مشكلة** — عند وجود خطأ أو ميزة لا تعمل كما ينبغي.',
    '**🆘 طلب مساعدة** — عندما تحتاج شرحًا أو مساعدة في استخدام البوت.',
    '**📬 طلباتي** — متابعة حالة البلاغ أو طلب المساعدة.',
    '',
    `**حساب التواصل المباشر:** <@${a.env.OWNER_USER_ID}>`,
    '> يفضّل استخدام البلاغ داخل البوت أولًا لأنه يحفظ رقم الطلب والسياق التقني ويسهّل المتابعة.'
  ].join('\n');
  const buttons=[btn('support:problem','الإبلاغ عن مشكلة',ButtonStyle.Danger,'🚨'),btn('support:help','أحتاج مساعدة',ButtonStyle.Primary,'🆘'),btn('support:mine','طلباتي',ButtonStyle.Secondary,'📬')];
  if(isOwner)buttons.push(btn('support:admin','مركز الدعم والبلاغات',ButtonStyle.Secondary,'🛟'));
  const rows=rowsFromButtons(buttons);rows.push(new ActionRowBuilder().addComponents(contactButton(a.env.OWNER_USER_ID)));
  return i.update({embeds:[e('🛟 المساعدة والدعم',description)],components:withNavigation(rows,'panel:refresh','العودة للوحة')});
}

async function submitRequest(i,a,s,kind){
  const subject=i.fields.getTextInputValue('subject').trim();
  const category=i.fields.getTextInputValue('category').trim()||'عام';
  const description=i.fields.getTextInputValue('description').trim();
  const teams=await a.teams.teamsForUser(s.guildId,s.userId).catch(()=>[]);
  const context={
    source:'discord',
    command:'panel',
    dm:!i.guildId,
    teamIds:teams.map(x=>x.id),
    teamNames:teams.map(x=>x.name),
    botVersion:process.env.npm_package_version??null,
    submittedAt:new Date().toISOString()
  };
  const row=await a.supportService.create({guildId:s.guildId,userId:s.userId,kind,category,subject,description,context,guild:s.guild});
  const type=kindAr[kind];
  const rows=[new ActionRowBuilder().addComponents(contactButton(a.env.OWNER_USER_ID))];
  return i.editReply({embeds:[e('✅ تم استلام طلبك',`${type}: **${subject}**\nرقم المتابعة: **#${shortId(row.id)}**\nالحالة: **${statusAr[row.status]}**\n\nتم حفظ الطلب وإرسال تنبيه للمسؤول. تستطيع متابعة حالته من **🛟 المساعدة والدعم ← طلباتي**.\n\nحساب التواصل: <@${a.env.OWNER_USER_ID}>`)],components:withNavigation(rows,'support:home','الدعم')});
}

async function myRequests(i,a,s){
  const rows=await a.support.listForUser(s.guildId,s.userId,{limit:25});
  const lines=rows.map(x=>`• **#${shortId(x.id)}** — ${kindAr[x.kind]} — **${x.subject}** — ${statusAr[x.status]}`);
  const comps=[];
  if(rows.length)comps.push(stringSelect('support:mine-open','فتح طلب',rows.map(x=>({label:`#${shortId(x.id)} • ${x.subject}`.slice(0,100),description:`${kindAr[x.kind]} • ${statusAr[x.status]}`.slice(0,100),value:x.id}))));
  return i.update({embeds:[e('📬 طلباتي',lines.join('\n')||'لم ترسل أي بلاغ أو طلب مساعدة حتى الآن.')],components:withNavigation(comps,'support:home','الدعم')});
}

async function adminRequests(i,a,s){
  if(String(s.userId)!==String(a.env.OWNER_USER_ID))throw new AppError('OWNER_ONLY','مركز الدعم والبلاغات متاح للـOwner فقط.');
  const rows=await a.support.listForGuild(s.guildId,{limit:50});
  const open=rows.filter(x=>x.status==='open').length,progress=rows.filter(x=>x.status==='in_progress').length;
  const lines=rows.slice(0,20).map(x=>`• **#${shortId(x.id)}** — ${kindAr[x.kind]} — <@${x.user_id}> — **${x.subject}** — ${statusAr[x.status]}`);
  const comps=[];
  if(rows.length)comps.push(stringSelect('support:admin-open','فتح طلب دعم',rows.slice(0,25).map(x=>({label:`#${shortId(x.id)} • ${x.subject}`.slice(0,100),description:`${x.requester_name??x.user_id} • ${statusAr[x.status]}`.slice(0,100),value:x.id}))));
  return i.update({embeds:[e('🛟 مركز الدعم والبلاغات',`مفتوح: **${open}** | قيد المتابعة: **${progress}**\n\n${lines.join('\n')||'لا توجد طلبات دعم.'}`)],components:withNavigation(comps,'support:home','الدعم')});
}

async function openRequest(i,a,s,requestId,adminMode=false){
  const row=await a.support.get(requestId);if(!row||String(row.guild_id)!==String(s.guildId))throw new AppError('SUPPORT_NOT_FOUND','طلب الدعم غير موجود.');
  const isOwner=String(s.userId)===String(a.env.OWNER_USER_ID);
  if(!isOwner&&String(row.user_id)!==String(s.userId))throw new AppError('FORBIDDEN','لا يمكنك فتح طلب دعم لا يخصك.');
  const ctx=row.context??{};
  const desc=[
    `رقم الطلب: **#${shortId(row.id)}**`,
    `النوع: **${kindAr[row.kind]}**`,
    `الحالة: **${statusAr[row.status]}**`,
    `صاحب الطلب: <@${row.user_id}>`,
    `القسم: **${row.category}**`,
    '',
    `**${row.subject}**`,
    row.description,
    '',
    ctx.teamNames?.length?`الفريق وقت الإرسال: ${ctx.teamNames.join('، ')}`:null,
    row.owner_note?`**ملاحظة المسؤول:** ${row.owner_note}`:null
  ].filter(Boolean).join('\n');
  const buttons=[];
  if(isOwner){
    if(row.status!=='in_progress')buttons.push(btn(`support:status:${row.id}:in_progress`,'قيد المتابعة',ButtonStyle.Primary,'👀'));
    if(row.status!=='resolved')buttons.push(btn(`support:status:${row.id}:resolved`,'تم الحل',ButtonStyle.Success,'✅'));
    if(row.status!=='closed')buttons.push(btn(`support:status:${row.id}:closed`,'إغلاق',ButtonStyle.Secondary,'🔒'));
    if(['resolved','closed'].includes(row.status))buttons.push(btn(`support:status:${row.id}:open`,'إعادة فتح',ButtonStyle.Secondary,'🔁'));
  }
  const components=rowsFromButtons(buttons);components.push(new ActionRowBuilder().addComponents(contactButton(a.env.OWNER_USER_ID)));
  return i.update({embeds:[e(`${row.kind==='problem'?'🚨':'🆘'} ${row.subject}`,desc.slice(0,3900))],components:withNavigation(components,isOwner&&adminMode?'support:admin':'support:mine','رجوع')});
}

async function setStatus(i,a,s,requestId,status){
  await a.supportService.setStatus({requestId,status,actorId:s.userId,guildId:s.guildId});
  const row=await a.support.get(requestId);
  const requester=await s.guild.client.users.fetch(String(row.user_id)).catch(()=>null);
  if(requester)await requester.send(`🛟 **تحديث طلب الدعم #${shortId(row.id)}**\nالحالة الجديدة: **${statusAr[status]}**\nالعنوان: ${row.subject}\nافتح /panel ← المساعدة والدعم ← طلباتي للتفاصيل.`).catch(()=>{});
  return openRequest(i,a,s,requestId,true);
}
