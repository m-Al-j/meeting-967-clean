import {ActionRowBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,ButtonStyle} from 'discord.js';
import {e,btn,rowsFromButtons,stringSelect,withNavigation} from '../ui.js';
import {subjectFromInteraction} from '../context.js';
import {ADMIN_BUNDLE} from '../../../core/permissions/catalog.js';
import {parseLocalDateTime,formatDate} from '../../../utils/time.js';
import {AppError} from '../../../core/errors/AppError.js';
import {guildRoleOptions,pickerPage} from '../guildPicker.js';
import {refreshPanel,personalGuide,panelHub,panelSection} from '../commands/panel.js';
import {handleAIInteraction} from '../commands/ai.js';

const input=(id,label,style=TextInputStyle.Short,required=false)=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required));
export async function handleMisc(i,a){const id=i.customId??'';const s=await subjectFromInteraction(i,a.env);
  if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);

  if(id==='owner:messages'||id.startsWith('owner:messages:'))return ownerMessages(i,a,s,id);
  if(id==='panel:refresh')return refreshPanel(i,a);if(id==='panel:section')return panelSection(i,a,i.values?.[0]||'personal');if(id.startsWith('panel:hub:'))return panelHub(i,a,id.split(':')[2]||'personal');if(id==='panel:guide')return personalGuide(i,a,'home');if(id.startsWith('guide:'))return personalGuide(i,a,id.split(':')[1]||'home');if(id==='staff:my-permissions')return myPermissions(i,a,s);if(id==='setup:report')return setChannel(i,a,s,'report_channel_id');if(id==='setup:audit')return setChannel(i,a,s,'audit_channel_id');if(id==='setup:adminrole-picker')return setupAdminRolePicker(i,a,s,0);if(id.startsWith('setup:adminrole-page:'))return setupAdminRolePicker(i,a,s,Number(id.split(':')[2]));if(id==='setup:adminrole')return setAdminRole(i,a,s);if(id==='setup:toggle-recording'||id==='setup:toggle-autorecord')return automaticOutputsNotice(i);if(id==='setup:done')return i.update({content:'✅ انتهى الإعداد الأساسي. افتح `/panel` لإدارة النظام.',embeds:[],components:[]});
  if(id==='admin:autopilot')return autopilotStatus(i,a,s);if(id==='admin:outputs')return outputsStatus(i,a,s);if(id==='outputs:repair')return outputsRepair(i,a,s);if(id==='admin:audit')return audit(i,a,s);if(id==='admin:backups')return backups(i,a,s);if(id==='backup:create')return backupCreate(i,a,s);if(id==='admin:settings')return settings(i,a,s);if(id==='settings:late')return lateModal(i,a,s);if(id==='settings:late-submit')return lateSubmit(i,a,s);if(id==='settings:timezone')return timezoneModal(i,a,s);if(id==='settings:timezone-submit')return timezoneSubmit(i,a,s);if(id==='settings:recording'||id==='settings:autorecord')return automaticOutputsNotice(i);if(id==='settings:autopilot')return toggleSetting(i,a,s,'autopilot_enabled');if(id==='settings:taskreminders')return toggleSetting(i,a,s,'task_reminders_enabled');if(id==='settings:autopilot-timing')return autopilotTimingModal(i,a,s);if(id==='settings:autopilot-timing-submit')return autopilotTimingSubmit(i,a,s);if(id==='settings:autobackup')return toggleSetting(i,a,s,'auto_backup_enabled');if(id==='admin:archive')return archiveHome(i,a,s);if(id==='archive:search')return archiveModal(i,a,s);if(id==='archive:search-submit')return archiveSearch(i,a,s);if(id==='archive:open')return archiveOpen(i,a,s,i.values[0]);if(id.startsWith('archive:view:'))return archiveOpen(i,a,s,id.split(':')[2]);if(id.startsWith('archive:attendance:'))return archiveAttendance(i,a,s,id.split(':')[2]);if(id==='member:attendance')return ownAttendance(i,a,s);return false;}

// operations967-owner-message-center-v1.10.8
const OWNER_MESSAGE_DRAFTS=new Map();
const OWNER_MESSAGE_SEARCHES=new Map();
const OWNER_MESSAGE_DRAFT_TTL=15*60*1000;
const OWNER_MESSAGE_PAGE_SIZE=20;

function ownerMessageCleanState(){
  const now=Date.now();
  for(const [k,v] of OWNER_MESSAGE_DRAFTS)if(now-Number(v?.createdAt??0)>OWNER_MESSAGE_DRAFT_TTL)OWNER_MESSAGE_DRAFTS.delete(k);
}
function ownerMessageId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,9);}
function ownerMessageName(member){
  return String(member?.displayName??member?.user?.globalName??member?.user?.username??member?.id??'عضو').replace(/[\r\n]+/g,' ').slice(0,80);
}
function ownerMessageClip(text,max=3900){const v=String(text??'');return v.length>max?v.slice(0,max-1)+'…':v;}
function ownerMessageModeAr(mode){return mode==='user'?'عضو واحد':mode==='team'?'فريق كامل':'السيرفر كامل';}
function ownerMessageTargetKey(mode,targetId=''){return mode==='server'?'server':mode+':'+String(targetId);}

async function ownerMessageGuild(i,a){
  const gid=String(a.env?.GUILD_ID??'').trim();
  const guild=i.guild??(gid?i.client.guilds.cache.get(gid):null)??(gid?await i.client.guilds.fetch(gid).catch(()=>null):null);
  if(!guild)throw new AppError('GUILD_UNAVAILABLE','تعذر الوصول إلى سيرفر 967 من البوت.');
  return guild;
}
async function ownerMessageHumanMembers(i,a){
  const guild=await ownerMessageGuild(i,a);
  const fetched=await guild.members.fetch().catch(()=>null);
  const source=fetched??guild.members.cache;
  return [...source.values()].filter(m=>m?.user&&!m.user.bot).sort((x,y)=>ownerMessageName(x).localeCompare(ownerMessageName(y),'ar'));
}
async function ownerMessageDeliveryIsOff(a,guildId){
  try{
    const {rows}=await a.db.query('SELECT delivery_mode,member_delivery_enabled FROM member_delivery_control WHERE guild_id=$1 LIMIT 1',[String(guildId)]);
    const row=rows?.[0];
    if(!row)return false;
    if(String(row.delivery_mode)==='off')return true;
    if(!row.delivery_mode&&row.member_delivery_enabled===false)return true;
    return false;
  }catch(error){
    if(['42P01','42703'].includes(String(error?.code??'')))return false;
    throw error;
  }
}

function ownerMessageHomePayload(){
  return {
    embeds:[e('📨 مركز الرسائل — Operations 967',[
      '**إرسال رسالة شخصية مباشرة من البوت.**',
      '',
      '👤 **شخص محدد:** اختر أي عضو بشري في السيرفر.',
      '👥 **فريق محدد:** تصل رسالة مستقلة لكل عضو حالي في الفريق.',
      '🌐 **السيرفر كامل:** تصل رسالة مستقلة لكل عضو بشري في السيرفر.',
      '',
      '🏷️ البوت يضع **اسم كل مستلم تلقائيًا** في بداية رسالته.',
      'يمكنك كذلك كتابة `{name}` داخل النص وسيستبدله البوت باسم ذلك المستلم.',
      '',
      '🛡️ قبل الإرسال الجماعي تظهر لك معاينة وعدد المستلمين وزر تأكيد.',
      '🔕 إذا كان **إيقاف الكل** مفعّلًا فلن يسمح المركز بالإرسال.'
    ].join('\n'))],
    components:withNavigation(rowsFromButtons([
      btn('owner:messages:user','إلى شخص',ButtonStyle.Primary,'👤'),
      btn('owner:messages:team','إلى فريق',ButtonStyle.Primary,'👥'),
      btn('owner:messages:server','إلى السيرفر كامل',ButtonStyle.Danger,'🌐'),
    ]))
  };
}

async function ownerMessageUserPicker(i,a,page=0){
  const all=await ownerMessageHumanMembers(i,a);
  const query=String(OWNER_MESSAGE_SEARCHES.get(String(i.user.id))??'').trim().toLocaleLowerCase('ar');
  const filtered=query?all.filter(m=>[ownerMessageName(m),m.user?.username,m.user?.globalName,m.id].filter(Boolean).join(' ').toLocaleLowerCase('ar').includes(query)):all;
  const pages=Math.max(1,Math.ceil(filtered.length/OWNER_MESSAGE_PAGE_SIZE));
  const safe=Math.max(0,Math.min(Number(page)||0,pages-1));
  const start=safe*OWNER_MESSAGE_PAGE_SIZE;
  const slice=filtered.slice(start,start+OWNER_MESSAGE_PAGE_SIZE);
  const components=[];
  if(slice.length){
    components.push(stringSelect(`owner:messages:user-pick:${safe}`,`اختر العضو — ${start+1}-${start+slice.length} من ${filtered.length}`,slice.map(m=>({
      label:ownerMessageName(m).slice(0,100),
      description:String(m.user?.username??m.id).slice(0,100),
      value:String(m.id),
    }))));
  }
  const nav=[];
  nav.push(btn('owner:messages:user-search','بحث بالاسم أو اليوزر',ButtonStyle.Secondary,'🔎'));
  if(query)nav.push(btn('owner:messages:user-clear','مسح البحث',ButtonStyle.Secondary,'✖️'));
  if(safe>0)nav.push(btn(`owner:messages:user-page:${safe-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safe+1<pages)nav.push(btn(`owner:messages:user-page:${safe+1}`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(nav.length)components.push(...rowsFromButtons(nav));
  return i.update({
    embeds:[e('👤 إرسال إلى شخص',`${query?`نتائج البحث عن **${ownerMessageClip(query,80)}**\n`:''}الأعضاء المتاحون: **${filtered.length}** • الصفحة **${safe+1}/${pages}**\n\nاختر العضو الذي تريد مراسلته.`)],
    components:withNavigation(components,'owner:messages')
  });
}

async function ownerMessageTeamPicker(i,a,page=0){
  const teams=await a.teams.list(String(a.env.GUILD_ID),{activeOnly:true});
  const pages=Math.max(1,Math.ceil(teams.length/OWNER_MESSAGE_PAGE_SIZE));
  const safe=Math.max(0,Math.min(Number(page)||0,pages-1));
  const start=safe*OWNER_MESSAGE_PAGE_SIZE;
  const slice=teams.slice(start,start+OWNER_MESSAGE_PAGE_SIZE);
  const components=[];
  if(slice.length){
    components.push(stringSelect(`owner:messages:team-pick:${safe}`,`اختر الفريق — ${start+1}-${start+slice.length} من ${teams.length}`,slice.map(t=>({
      label:String(t.name).slice(0,100),
      description:`${Number(t.member_count??0)} عضو`.slice(0,100),
      value:String(t.id),
    }))));
  }
  const nav=[];
  if(safe>0)nav.push(btn(`owner:messages:team-page:${safe-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safe+1<pages)nav.push(btn(`owner:messages:team-page:${safe+1}`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(nav.length)components.push(...rowsFromButtons(nav));
  return i.update({embeds:[e('👥 إرسال إلى فريق',teams.length?`اختر الفريق المطلوب. الصفحة **${safe+1}/${pages}**.`:'لا توجد فرق فعالة حاليًا.')],components:withNavigation(components,'owner:messages')});
}

async function ownerMessageRecipients(i,a,mode,targetId){
  const guild=await ownerMessageGuild(i,a);
  if(mode==='server'){
    const members=await ownerMessageHumanMembers(i,a);
    return {guild,label:'كل أعضاء السيرفر',members};
  }
  if(mode==='user'){
    const member=guild.members.cache.get(String(targetId))??await guild.members.fetch(String(targetId)).catch(()=>null);
    if(!member||member.user?.bot)throw new AppError('MESSAGE_TARGET','العضو غير موجود حاليًا في السيرفر.');
    return {guild,label:ownerMessageName(member),members:[member]};
  }
  if(mode==='team'){
    const team=await a.teams.get(String(targetId));
    if(!team||String(team.guild_id)!==String(a.env.GUILD_ID))throw new AppError('MESSAGE_TARGET','الفريق غير موجود.');
    const rows=await a.teams.members(String(targetId));
    const byId=new Map((await ownerMessageHumanMembers(i,a)).map(m=>[String(m.id),m]));
    const members=[];
    const seen=new Set();
    for(const row of rows){const id=String(row.user_id);const m=byId.get(id);if(m&&!seen.has(id)){seen.add(id);members.push(m);}}
    return {guild,label:String(team.name),members};
  }
  throw new AppError('MESSAGE_TARGET','نوع المستلم غير معروف.');
}

async function ownerMessageTargetScreen(i,a,mode,targetId=''){
  const {label,members}=await ownerMessageRecipients(i,a,mode,targetId);
  const composeId=mode==='server'?'owner:messages:compose:server':`owner:messages:compose:${mode}:${targetId}`;
  const warning=mode==='server'?'\n\n⚠️ هذا اختيار شامل لكل الأعضاء البشريين في السيرفر، وسيطلب البوت تأكيدًا إضافيًا قبل الإرسال.':'';
  return i.update({
    embeds:[e('✉️ المستلم جاهز',`**النطاق:** ${ownerMessageModeAr(mode)}\n**الهدف:** ${label}\n**عدد المستلمين الحالي:** ${members.length}${warning}\n\nاضغط **كتابة الرسالة** للمتابعة.`)],
    components:withNavigation(rowsFromButtons([btn(composeId,'كتابة الرسالة',ButtonStyle.Success,'✍️')]),mode==='team'?'owner:messages:team':mode==='user'?'owner:messages:user':'owner:messages')
  });
}

function ownerMessageComposeModal(i,mode,targetId=''){
  const target=mode==='server'?'السيرفر كامل':mode==='team'?'الفريق':'العضو';
  const modal=new ModalBuilder().setCustomId(mode==='server'?'owner:messages:send:server':`owner:messages:send:${mode}:${targetId}`).setTitle(`رسالة إلى ${target}`);
  const title=new TextInputBuilder().setCustomId('message_title').setLabel('عنوان الرسالة — اختياري').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setPlaceholder('مثال: تنبيه مهم');
  const body=new TextInputBuilder().setCustomId('message_body').setLabel('نص الرسالة').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(1).setMaxLength(1500).setPlaceholder('اكتب الرسالة هنا. يمكنك استخدام {name} لاسم المستلم.');
  modal.addComponents(new ActionRowBuilder().addComponents(title),new ActionRowBuilder().addComponents(body));
  return i.showModal(modal);
}

function ownerMessagePersonalText(member,title,body){
  const name=ownerMessageName(member);
  const personalized=String(body).replaceAll('{name}',name).trim();
  const heading=String(title??'').trim();
  return `السلام عليكم يا ${name} 👋\n\n${heading?`**${heading}**\n\n`:''}${personalized}\n\n-# Operations 967`;
}

async function ownerMessagePreview(i,a,s,mode,targetId=''){
  const title=String(i.fields.getTextInputValue('message_title')??'').trim();
  const body=String(i.fields.getTextInputValue('message_body')??'').trim();
  if(!body)throw new AppError('MESSAGE_EMPTY','اكتب نص الرسالة أولًا.');
  const target=await ownerMessageRecipients(i,a,mode,targetId);
  if(!target.members.length)throw new AppError('MESSAGE_EMPTY_TARGET','لا يوجد أي عضو حالي يمكن إرسال الرسالة له في هذا النطاق.');
  const draftId=ownerMessageId();
  OWNER_MESSAGE_DRAFTS.set(draftId,{actorId:String(s.userId),mode,targetId:String(targetId??''),title,body,createdAt:Date.now()});
  const sample=ownerMessagePersonalText(target.members[0],title,body);
  const confirmStyle=mode==='server'?ButtonStyle.Danger:ButtonStyle.Success;
  return i.reply({
    embeds:[e('👀 معاينة قبل الإرسال',`**النطاق:** ${ownerMessageModeAr(mode)}\n**الهدف:** ${target.label}\n**عدد المستلمين الحالي:** ${target.members.length}\n\n**مثال لأول مستلم:**\n${ownerMessageClip(sample,2500)}\n\n${mode==='server'?'⚠️ تأكد من النص؛ عند الضغط على تأكيد سيبدأ الإرسال لكل أعضاء السيرفر.':'لن يبدأ الإرسال حتى تضغط تأكيد.'}`)],
    components:withNavigation(rowsFromButtons([
      btn(`owner:messages:confirm:${draftId}`,'تأكيد الإرسال',confirmStyle,'✅'),
      btn(`owner:messages:cancel:${draftId}`,'إلغاء',ButtonStyle.Secondary,'✖️'),
    ]),'owner:messages')
  });
}

async function ownerMessageConfirm(i,a,s,draftId){
  ownerMessageCleanState();
  const draft=OWNER_MESSAGE_DRAFTS.get(String(draftId));
  if(!draft||String(draft.actorId)!==String(s.userId))throw new AppError('MESSAGE_DRAFT','انتهت صلاحية مسودة الرسالة. افتح مركز الرسائل واكتبها من جديد.');
  if(await ownerMessageDeliveryIsOff(a,a.env.GUILD_ID))throw new AppError('DELIVERY_OFF','الإرسال العام مضبوط على «إيقاف الكل». شغّل الإرسال أولًا ثم أعد المحاولة.');
  const target=await ownerMessageRecipients(i,a,draft.mode,draft.targetId);
  if(!target.members.length)throw new AppError('MESSAGE_EMPTY_TARGET','لا يوجد مستلمون حاليون لهذا النطاق.');

  let sent=0,failed=0;
  const failures=[];
  const total=target.members.length;
  for(let idx=0;idx<target.members.length;idx++){
    const member=target.members[idx];
    const text=ownerMessagePersonalText(member,draft.title,draft.body);
    const ok=await member.user.send(text).then(()=>true).catch(()=>false);
    if(ok)sent++;else{failed++;if(failures.length<20)failures.push(String(member.id));}
    if((idx+1)%10===0&&idx+1<total){
      await i.editReply({content:`📨 جارٍ الإرسال... **${idx+1}/${total}**`,embeds:[],components:[]}).catch(()=>{});
    }
    if(idx+1<total)await new Promise(r=>setTimeout(r,250));
  }

  OWNER_MESSAGE_DRAFTS.delete(String(draftId));
  await a.audit?.log?.({
    guildId:String(a.env.GUILD_ID),actorId:String(s.userId),action:'messages.manual_send',targetType:'broadcast',targetId:ownerMessageTargetKey(draft.mode,draft.targetId),
    newValue:{mode:draft.mode,targetId:draft.targetId||null,targetLabel:target.label,requested:total,sent,failed,title:draft.title||null,preview:String(draft.body).slice(0,180)}
  }).catch(()=>{});

  const failText=failures.length?`\n\n**تعذر الإرسال إلى:** ${failures.map(id=>`<@${id}>`).join('، ')}${failed>failures.length?` … و${failed-failures.length} آخرين`:''}\nغالبًا الخاص مغلق لديهم أو Discord رفض الـDM.`:'';
  return i.editReply({
    content:null,
    embeds:[e('✅ نتيجة الإرسال',`**النطاق:** ${ownerMessageModeAr(draft.mode)}\n**الهدف:** ${target.label}\n**المطلوب:** ${total}\n**تم بنجاح:** ✅ ${sent}\n**فشل:** ❌ ${failed}${failText}`)],
    components:withNavigation(rowsFromButtons([btn('owner:messages','رسالة جديدة',ButtonStyle.Primary,'📨')]))
  });
}

async function ownerMessages(i,a,s,id){
  await ownerOnly(s,a);
  ownerMessageCleanState();
  if(id==='owner:messages'){OWNER_MESSAGE_SEARCHES.delete(String(i.user.id));return i.update(ownerMessageHomePayload());}
  if(id==='owner:messages:user'){OWNER_MESSAGE_SEARCHES.delete(String(i.user.id));return ownerMessageUserPicker(i,a,0);}
  if(id==='owner:messages:user-clear'){OWNER_MESSAGE_SEARCHES.delete(String(i.user.id));return ownerMessageUserPicker(i,a,0);}
  if(id==='owner:messages:user-search'){
    return i.showModal(new ModalBuilder().setCustomId('owner:messages:user-search-submit').setTitle('بحث عن عضو').addComponents(input('query','الاسم أو اليوزر أو Discord ID',TextInputStyle.Short,true)));
  }
  if(id==='owner:messages:user-search-submit'){
    OWNER_MESSAGE_SEARCHES.set(String(i.user.id),String(i.fields.getTextInputValue('query')??'').trim());
    return ownerMessageUserPicker(i,a,0);
  }
  if(id.startsWith('owner:messages:user-page:'))return ownerMessageUserPicker(i,a,Number(id.split(':').at(-1))||0);
  if(id.startsWith('owner:messages:user-pick:'))return ownerMessageTargetScreen(i,a,'user',String(i.values?.[0]??''));

  if(id==='owner:messages:team')return ownerMessageTeamPicker(i,a,0);
  if(id.startsWith('owner:messages:team-page:'))return ownerMessageTeamPicker(i,a,Number(id.split(':').at(-1))||0);
  if(id.startsWith('owner:messages:team-pick:'))return ownerMessageTargetScreen(i,a,'team',String(i.values?.[0]??''));
  if(id==='owner:messages:server')return ownerMessageTargetScreen(i,a,'server','');

  if(id.startsWith('owner:messages:compose:')){
    const parts=id.split(':');
    const mode=parts[3];
    const targetId=parts.slice(4).join(':');
    if(!['user','team','server'].includes(mode))throw new AppError('MESSAGE_TARGET','نوع المستلم غير معروف.');
    return ownerMessageComposeModal(i,mode,targetId);
  }
  if(id.startsWith('owner:messages:send:')){
    const parts=id.split(':');
    const mode=parts[3];
    const targetId=parts.slice(4).join(':');
    return ownerMessagePreview(i,a,s,mode,targetId);
  }
  if(id.startsWith('owner:messages:confirm:'))return ownerMessageConfirm(i,a,s,id.split(':').at(-1));
  if(id.startsWith('owner:messages:cancel:')){OWNER_MESSAGE_DRAFTS.delete(id.split(':').at(-1));return i.update(ownerMessageHomePayload());}
  return false;
}


async function ownerOnly(s,a){if(String(s.userId)!==String(a.env.OWNER_USER_ID))throw new AppError('OWNER_ONLY','هذا الإجراء متاح للـOwner فقط.');}
async function setChannel(i,a,s,field){await ownerOnly(s,a);await a.guilds.updateSettings(s.guildId,{[field]:i.values[0]});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'settings.channel',targetType:'settings',newValue:{[field]:i.values[0]}});return i.update({content:'✅ تم حفظ القناة.',components:[]});}
async function setupAdminRolePicker(i,a,s,page=0){await ownerOnly(s,a);const options=await guildRoleOptions(s.guild,{includeManaged:false});if(!options.length)return i.update({content:'لا توجد رتب قابلة للإدارة في السيرفر.',components:withNavigation([])});const p=pickerPage(options,page);const comps=[stringSelect('setup:adminrole',`اختر رتبة الإدارة — ${p.start+1}-${p.end} من ${p.total}`,p.items)];const pager=[];if(p.page>0)pager.push(btn(`setup:adminrole-page:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`setup:adminrole-page:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)comps.push(...rowsFromButtons(pager));return i.update({content:`اختر رتبة الإدارة من رتب السيرفر — صفحة ${p.page+1}/${p.pages}.`,embeds:[],components:withNavigation(comps)});}
async function setAdminRole(i,a,s){await ownerOnly(s,a);const roleId=i.values[0];if(String(roleId)===String(s.guildId))throw new AppError('UNSAFE_ROLE','لا يمكن منح حزمة الإدارة لرتبة @everyone.');await Promise.all(ADMIN_BUNDLE.map(permission=>a.permissions.grantRole({guildId:s.guildId,roleId,permission,scopeType:'global',scopeId:null,actorId:s.userId})));await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'setup.admin_role',targetType:'role',targetId:roleId,newValue:{permissions:ADMIN_BUNDLE}});return i.update({content:`✅ تم منح حزمة الإدارة للرتبة <@&${roleId}>. صلاحية permissions.manage تبقى للـOwner ما لم يمنحها بنفسه.`,components:[]});}
async function setupToggle(i,a,s,field){await ownerOnly(s,a);const cur=await a.guilds.getSettings(s.guildId);const val=!cur[field];await a.guilds.updateSettings(s.guildId,{[field]:val});return i.update({content:`✅ ${field}: ${val?'مفعّل':'معطّل'}`,components:[]});}
async function autopilotStatus(i,a,s){await a.permissionService.assertPotential(s,'meetings.view');const x=await a.guilds.getSettings(s.guildId);const ongoing=await a.meetings.ongoingForGuild(s.guildId);const upcoming=await a.meetings.autopilotCandidates(s.guildId,{horizonMinutes:Math.max(x.autopilot_readiness_minutes,x.autopilot_reminder_minutes),graceMinutes:x.autopilot_start_grace_minutes});const activeRec=a.recordingService.active.size;const desc=`الحالة: **${x.autopilot_enabled?'🟢 مفعّل':'🔴 معطّل'}**
اجتماعات ضمن نافذة الأتمتة: **${upcoming.length}**
اجتماعات جارية: **${ongoing.length}**
تسجيلات صوتية حية: **${activeRec}**

فحص الجاهزية: قبل **${x.autopilot_readiness_minutes} دقيقة**
التذكير: قبل **${x.autopilot_reminder_minutes} دقيقة**
مهلة الاسترداد/البدء: **${x.autopilot_start_grace_minutes} دقيقة**
إنهاء بعد خلو القناة: **${x.autopilot_empty_end_minutes} دقيقة**
No-show: **${x.autopilot_no_show_end_minutes} دقيقة**

> يعمل المجدول كل 15 ثانية، ويفصل كل اجتماع بمعرّفه وفريقه. التسجيل الصوتي المتزامن يبقى مقيدًا باتصال صوتي واحد لنفس حساب البوت داخل السيرفر.`;const buttons=[];if(await a.permissionService.has(s,'settings.manage'))buttons.push(btn('settings:autopilot','تشغيل/إيقاف',ButtonStyle.Primary,'🤖'),btn('settings:autopilot-timing','تعديل التوقيت',ButtonStyle.Secondary,'⏱️'));return i.update({embeds:[e('🤖 Meeting Autopilot',desc)],components:withNavigation(rowsFromButtons(buttons))});}
async function audit(i,a,s){await a.permissionService.assert(s,'audit.view');const rows=await a.auditRepo.latest(s.guildId,20);const text=rows.map(x=>`• \`${x.action}\` — <@${x.actor_id}> — ${x.target_type}${x.target_id?`:${x.target_id}`:''} — ${x.created_at.toISOString()}`).join('\n')||'لا يوجد سجل.';return i.update({embeds:[e('🧾 Audit Log',text.slice(0,3900))],components:withNavigation([])});}
async function backups(i,a,s){await a.permissionService.assert(s,'backups.manage');const rows=await a.backups.latest(s.guildId,10);const text=rows.map(x=>`• ${x.status} — ${x.started_at.toISOString()} — ${x.size_bytes?Math.round(Number(x.size_bytes)/1024)+' KB':''}`).join('\n')||'لا توجد نسخ.';return i.update({embeds:[e('💾 النسخ الاحتياطي',text)],components:withNavigation(rowsFromButtons([btn('backup:create','إنشاء Backup الآن',ButtonStyle.Primary,'💾')]))});}
async function backupCreate(i,a,s){await a.permissionService.assert(s,'backups.manage');a.rateLimiter.consume(`backup:${s.userId}`,{limit:2,windowMs:60_000});await i.deferReply({ephemeral:Boolean(i.guildId)});const b=await a.backupService.create({guildId:s.guildId,actorId:s.userId});return i.editReply({content:`✅ اكتمل النسخ الاحتياطي (${Math.round(Number(b.size_bytes)/1024)} KB).`,files:[b.path],components:withNavigation([],'admin:backups')});}
async function settings(i,a,s){await a.permissionService.assert(s,'settings.manage');const x=await a.guilds.getSettings(s.guildId);return i.update({embeds:[e('⚙️ الإعدادات',`Timezone: **${x.timezone}**\nحد التأخير: **${x.late_after_minutes} دقيقة**\nالتسجيل: **🟢 تلقائي إلزامي لكل اجتماع**\nالتقرير: **🟢 تلقائي عند انتهاء الاجتماع**\nالتسليم: **🟢 تلقائي للـOwner والمخولين حسب الفريق**\n🤖 Autopilot: **${x.autopilot_enabled?'مفعّل':'معطّل'}**\nفحص الجاهزية: قبل **${x.autopilot_readiness_minutes} د** | التذكير: قبل **${x.autopilot_reminder_minutes} د**\nمهلة البدء: **${x.autopilot_start_grace_minutes} د** | إنهاء بعد خلو القناة: **${x.autopilot_empty_end_minutes} د** | No-show: **${x.autopilot_no_show_end_minutes} د**\nتذكيرات التكليفات: **${x.task_reminders_enabled?'مفعّلة':'معطّلة'}**\nBackup دوري: **${x.auto_backup_enabled?'مفعّل':'معطّل'}**`)],components:withNavigation(rowsFromButtons([btn('settings:autopilot','Autopilot',2,'🤖'),btn('settings:autopilot-timing','توقيت الطيار الآلي',2,'⏱️'),btn('settings:taskreminders','تذكير التكليفات',2,'📌'),btn('settings:late','حد التأخير',2,'⌛'),btn('settings:timezone','المنطقة الزمنية',2,'🌍'),btn('settings:autobackup','Backup دوري',2,'💾')]))});}
async function automaticOutputsNotice(i){return i.reply({content:'🟢 التسجيل والتقرير والتسليم التلقائي أصبحت جزءًا إلزاميًا من دورة أي اجتماع داخل Meeting 967، لذلك لا يمكن تعطيلها من اللوحة.',components:withNavigation([],'admin:settings'),ephemeral:Boolean(i.guildId)});}
async function outputsStatus(i,a,s){if(!await a.permissionService.hasAnyPotential(s,['reports.view','recordings.view','reports.receive','recordings.receive']))throw new AppError('FORBIDDEN','ليس لديك صلاحية للوصول إلى مخرجات الاجتماعات.');const rows=await a.outputs.recentForGuild(s.guildId,{limit:12});const icon=(v)=>v==='ready'||v==='sent'?'✅':v==='recording'?'🔴':v==='missing'?'⚠️':v==='failed'?'❌':'⏳';const visible=[];for(const r of rows){const ctx={teamId:r.team_id,meetingId:r.meeting_id};if(await a.permissionService.has(s,'reports.view',ctx)||await a.permissionService.has(s,'recordings.view',ctx)||await a.permissionService.has(s,'reports.receive',ctx)||await a.permissionService.has(s,'recordings.receive',ctx))visible.push(r);}const text=visible.length?visible.map(r=>`• **${r.meeting_name}** — ${r.team_name}\n  📄 ${icon(r.report_status)} ${r.report_status} | 🎙️ ${icon(r.recording_status)} ${r.recording_status} | 📨 ${icon(r.delivery_status)} ${r.delivery_status}${r.last_error?`\n  ⚠️ ${String(r.last_error).slice(0,180)}`:''}`).join('\n'):'لا توجد حالات مخرجات مسجلة بعد.';const buttons=[];if(a.permissionService.isOwner(s.userId)||await a.permissionService.has(s,'settings.manage'))buttons.push(btn('outputs:repair','فحص وإصلاح الآن',ButtonStyle.Primary,'🛠️'));return i.update({embeds:[e('📦 مخرجات الاجتماعات',`${text.slice(0,3800)}\n\n> النظام يعيد فحص الاجتماعات الجارية والمنتهية تلقائيًا كل 30 ثانية، ويعيد محاولة التقرير/التسليم عند الفشل.`)],components:withNavigation(rowsFromButtons(buttons))});}
async function outputsRepair(i,a,s){if(!a.permissionService.isOwner(s.userId))await a.permissionService.assert(s,'settings.manage');await a.outputReliabilityService.tick({force:true});return i.reply({content:'✅ تم تشغيل فحص شامل للمخرجات: التسجيلات الجارية + التقارير + التسليمات الحديثة.',components:withNavigation([],'admin:outputs'),ephemeral:Boolean(i.guildId)});}
async function lateModal(i,a,s){await a.permissionService.assert(s,'settings.manage');return i.showModal(new ModalBuilder().setCustomId('settings:late-submit').setTitle('حد التأخير').addComponents(input('minutes','الدقائق (0-180)',TextInputStyle.Short,true)));}
async function lateSubmit(i,a,s){await a.permissionService.assert(s,'settings.manage');const n=Number(i.fields.getTextInputValue('minutes'));if(!Number.isInteger(n)||n<0||n>180)throw new Error('قيمة غير صالحة');await a.guilds.updateSettings(s.guildId,{late_after_minutes:n});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'settings.late',targetType:'settings',newValue:{late_after_minutes:n}});return i.reply({content:'✅ تم حفظ حد التأخير.',components:withNavigation([],'admin:settings'),ephemeral:Boolean(i.guildId)});}
async function autopilotTimingModal(i,a,s){await a.permissionService.assert(s,'settings.manage');const x=await a.guilds.getSettings(s.guildId);const modal=new ModalBuilder().setCustomId('settings:autopilot-timing-submit').setTitle('توقيت Meeting Autopilot').addComponents(input('readiness','فحص الجاهزية قبل الموعد (دقائق)',TextInputStyle.Short,true),input('reminder','التذكير قبل الموعد (دقائق)',TextInputStyle.Short,true),input('grace','مهلة محاولة البدء بعد الموعد (دقائق)',TextInputStyle.Short,true),input('empty','إنهاء بعد خلو القناة (دقائق)',TextInputStyle.Short,true),input('noshow','إنهاء إذا لم يدخل أحد (دقائق)',TextInputStyle.Short,true));const vals=[x.autopilot_readiness_minutes,x.autopilot_reminder_minutes,x.autopilot_start_grace_minutes,x.autopilot_empty_end_minutes,x.autopilot_no_show_end_minutes];modal.components.forEach((r,n)=>r.components[0].setValue(String(vals[n])));return i.showModal(modal);}
async function autopilotTimingSubmit(i,a,s){await a.permissionService.assert(s,'settings.manage');const n=(k,min,max)=>{const v=Number(i.fields.getTextInputValue(k));if(!Number.isInteger(v)||v<min||v>max)throw new Error('قيمة غير صالحة');return v;};const patch={autopilot_readiness_minutes:n('readiness',1,180),autopilot_reminder_minutes:n('reminder',1,180),autopilot_start_grace_minutes:n('grace',1,120),autopilot_empty_end_minutes:n('empty',1,60),autopilot_no_show_end_minutes:n('noshow',2,180)};await a.guilds.updateSettings(s.guildId,patch);await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'settings.autopilot_timing',targetType:'settings',newValue:patch});return i.reply({content:'✅ تم حفظ توقيت Meeting Autopilot.',components:withNavigation([],'admin:settings'),ephemeral:Boolean(i.guildId)});}
async function timezoneModal(i,a,s){await a.permissionService.assert(s,'settings.manage');return i.showModal(new ModalBuilder().setCustomId('settings:timezone-submit').setTitle('المنطقة الزمنية').addComponents(input('timezone','مثال: Asia/Riyadh',TextInputStyle.Short,true)));}
async function timezoneSubmit(i,a,s){await a.permissionService.assert(s,'settings.manage');const zone=i.fields.getTextInputValue('timezone').trim();try{Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{throw new Error('منطقة زمنية غير صالحة');}await a.guilds.updateSettings(s.guildId,{timezone:zone});return i.reply({content:'✅ تم حفظ المنطقة الزمنية.',components:withNavigation([],'admin:settings'),ephemeral:Boolean(i.guildId)});}
async function toggleSetting(i,a,s,field){await a.permissionService.assert(s,'settings.manage');const cur=await a.guilds.getSettings(s.guildId);const val=!cur[field];await a.guilds.updateSettings(s.guildId,{[field]:val});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'settings.toggle',targetType:'settings',newValue:{[field]:val}});return i.reply({content:`✅ ${val?'تم التفعيل':'تم التعطيل'}.`,components:withNavigation([],'admin:settings'),ephemeral:Boolean(i.guildId)});}
async function archiveHome(i,a,s){await a.permissionService.assertPotential(s,'meetings.view');return i.update({embeds:[e('🗂️ الأرشيف','ابحث بالاسم أو الفريق أو العضو أو الحالة أو التاريخ.')],components:withNavigation(rowsFromButtons([btn('archive:search','بحث متقدم',ButtonStyle.Primary,'🔎')]))});}
async function archiveModal(i,a,s){await a.permissionService.assertPotential(s,'meetings.view');return i.showModal(new ModalBuilder().setCustomId('archive:search-submit').setTitle('بحث الأرشيف').addComponents(input('query','كلمة من اسم/وصف'),input('status','الحالة: ended/upcoming/...'),input('member','Discord User ID'),input('from','من: YYYY-MM-DD HH:mm'),input('to','إلى: YYYY-MM-DD HH:mm')));}
async function archiveSearch(i,a,s){await a.permissionService.assertPotential(s,'meetings.view');const settings=await a.guilds.getSettings(s.guildId);const val=(k)=>i.fields.getTextInputValue(k).trim();const rows=await a.meetings.search(s.guildId,{query:val('query'),status:val('status')||null,memberId:val('member')||null,dateFrom:val('from')?parseLocalDateTime(val('from'),settings.timezone):null,dateTo:val('to')?parseLocalDateTime(val('to'),settings.timezone):null});const visible=[];for(const m of rows)if(await a.permissionService.has(s,'meetings.view',{teamId:m.team_id,meetingId:m.id}))visible.push(m);const text=visible.map(m=>`• **${m.name}** — ${m.team_name} — ${formatDate(m.scheduled_at,settings.timezone)} — ${m.status}`).join('\n')||'لا توجد نتائج ضمن صلاحياتك.';const components=visible.length?[stringSelect('archive:open','فتح اجتماع من الأرشيف',visible.map(m=>({label:m.name.slice(0,100),description:`${m.team_name} • ${m.status}`.slice(0,100),value:m.id})))]:[];return i.reply({embeds:[e('🔎 نتائج الأرشيف',text.slice(0,3900))],components:withNavigation(components,'admin:archive'),ephemeral:Boolean(i.guildId)});}

async function archiveOpen(i,a,s,meetingId){
  const m=await a.meetings.get(meetingId);
  await a.permissionService.assert(s,'meetings.view',{teamId:m.team_id,meetingId});
  const [settings,attendance,excuseResult,decisions,tasks,report,recording,auditResult,canReport,canRecording]=await Promise.all([
    a.guilds.getSettings(s.guildId),
    a.attendance.rows(meetingId),
    a.db.query('SELECT status,count(*)::int count FROM excuses WHERE meeting_id=$1 GROUP BY status',[meetingId]),
    a.meetings.decisions(meetingId),
    a.tasks.listForMeeting(meetingId),
    a.reports.latest(meetingId),
    a.recordings.latestForMeeting(meetingId),
    a.db.query('SELECT count(*)::int count FROM audit_logs WHERE guild_id=$1 AND target_type=\'meeting\' AND target_id=$2',[s.guildId,meetingId]),
    a.permissionService.has(s,'reports.download',{teamId:m.team_id,meetingId}),
    a.permissionService.has(s,'recordings.view',{teamId:m.team_id,meetingId})
  ]);
  const excuses=excuseResult.rows,auditRows=auditResult.rows;
  const byStatus=Object.fromEntries(['present','late','absent','excused'].map(x=>[x,attendance.filter(r=>r.status===x).length]));
  const ex=Object.fromEntries(excuses.map(x=>[x.status,x.count]));
  const desc=`الفريق: **${m.team_name}**\nالحالة: **${m.status}**\nالموعد: ${formatDate(m.scheduled_at,settings.timezone)}\nالحضور: حاضر ${byStatus.present} | متأخر ${byStatus.late} | غائب ${byStatus.absent} | معتذر ${byStatus.excused}\nالاعتذارات: Pending ${ex.pending||0} | Approved ${ex.approved||0} | Rejected ${ex.rejected||0}\nالقرارات: ${decisions.length} | التكليفات: ${tasks.length}\nالتقرير: ${report?'موجود':'لا يوجد'}\nالتسجيل: ${recording?recording.status:'لا يوجد'}\nأحداث Audit على الاجتماع: ${auditRows[0].count}`;
  const buttons=[btn(`archive:attendance:${meetingId}`,'تفاصيل الحضور',2,'✅')];
  if(report&&canReport)buttons.push(btn(`report:download:${meetingId}`,'التقرير',2,'📄'));
  if(recording&&canRecording)buttons.push(btn(`recording:open:${meetingId}`,'التسجيلات',2,'🎙️'));
  return i.update({embeds:[e(`🗂️ ${m.name}`,desc)],components:withNavigation(rowsFromButtons(buttons),'admin:archive')});
}
async function archiveAttendance(i,a,s,meetingId){const m=await a.meetings.get(meetingId);await a.permissionService.assert(s,'meetings.view',{teamId:m.team_id,meetingId});const rows=await a.attendance.rows(meetingId);const ar={present:'حاضر',late:'متأخر',absent:'غائب',excused:'معتذر'};return i.reply({embeds:[e('تفاصيل الحضور',rows.map(r=>`• <@${r.user_id}> — ${ar[r.status]} — ${Math.round((r.total_seconds||0)/60)} د`).join('\n')||'لا يوجد')],components:withNavigation([],`archive:view:${meetingId}`),ephemeral:Boolean(i.guildId)});}

async function ownAttendance(i,a,s){const {rows}=await a.db.query(`SELECT a.*,m.name meeting_name,m.scheduled_at FROM attendance a JOIN meetings m ON m.id=a.meeting_id WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND a.user_id=$2 ORDER BY m.scheduled_at DESC LIMIT 20`,[s.guildId,s.userId]);return i.update({embeds:[e('✅ سجل حضوري',rows.length?rows.map(r=>`• **${r.meeting_name}** — ${r.status} — ${Math.round((r.total_seconds??0)/60)} د`).join('\n'):'لا توجد سجلات.')],components:withNavigation([])});}

async function myPermissions(i,a,s){
  if(a.permissionService.isOwner(s.userId))return i.reply({content:'👑 أنت Owner النظام وتملك جميع الصلاحيات تلقائيًا بنطاق عالمي.',components:withNavigation([]),ephemeral:Boolean(i.guildId)});
  if(await a.permissionService.isSuperAdmin(s))return i.reply({content:'⭐ لديك **وصول الإدارة العليا**: نفس أدوات لوحة المالك وصلاحيات تشغيلية عالمية داخل Meeting 967.\n\n🔒 لا تصبح OWNER، ولا تستطيع تغيير `OWNER_USER_ID` أو منح/سحب وصول الإدارة العليا؛ هذه تبقى للـOwner فقط.',components:withNavigation([]),ephemeral:Boolean(i.guildId)});
  const grants=await a.permissionService.grants(s);
  const allows=grants.filter(g=>g.effect==='allow');
  if(!allows.length)return i.reply({content:'لا توجد صلاحيات إدارية فعالة مسجلة لك حاليًا.',components:withNavigation([]),ephemeral:Boolean(i.guildId)});
  const sourceAr={user:'مباشرة لك',role:'عن طريق رتبة',team:'عن طريق فريق'};
  const scopeAr={global:'كل النظام',team:'فريق محدد',meeting:'اجتماع محدد'};
  const unique=[];const seen=new Set();
  for(const g of allows){const k=[g.permission_key,g.source,g.scope_type,g.scope_id??''].join('|');if(seen.has(k))continue;seen.add(k);unique.push(g);}
  const lines=unique.slice(0,30).map(g=>`• \`${g.permission_key}\` — ${sourceAr[g.source]??g.source} — ${scopeAr[g.scope_type]??g.scope_type}`);
  return i.reply({embeds:[e('🛡️ صلاحياتي ونطاقاتي',`${lines.join('\n')}${unique.length>30?`\n… و${unique.length-30} صلاحية أخرى`:''}\n\n> هذه القائمة تعريفية فقط؛ كل إجراء يعاد فحص صلاحيته ونطاقه عند التنفيذ.`)],components:withNavigation([]),ephemeral:Boolean(i.guildId)});
}
