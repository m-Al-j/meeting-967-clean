import {handleTeamManagers} from './teamManagers.js';
import {ButtonStyle} from 'discord.js';
import {e,btn,rowsFromButtons,stringSelect,withNavigation} from '../ui.js';
import {subjectFromInteraction} from '../context.js';
import {PERMISSION_CATEGORIES,SUPER_ADMIN_PERMISSION,DM_TRIAL_PERMISSION,permissionMeta,permissionLabel,permissionsInCategory} from '../../../core/permissions/catalog.js';
import {AppError} from '../../../core/errors/AppError.js';
import {guildMemberOptions,guildRoleOptions,pickerPage,pickerMenuPage,pickerPageValue,pickerSearchValue} from '../guildPicker.js';
import {filterMemberOptions,getMemberSearch,setMemberSearch,clearMemberSearch,memberSearchModal,memberSearchRows,searchSummary} from '../memberSearch.js';
import {setSmartMemberContext,smartMemberHint,rankMemberOptionsForPicker} from '../smartMemberSearch.js';

const userSelectId={grant:'perm:subject:user',deny:'perm:deny-subject:user',revoke:'perm:revoke-subject:user',delivery:'perm:delivery-subject',inspect:'perm:subject:inspect'};
const roleSelectId={grant:'perm:subject:role',deny:'perm:deny-subject:role',revoke:'perm:revoke-subject:role'};

async function deferForPicker(i){if(!i.deferred&&!i.replied)await i.deferUpdate();}
const render=(i,payload)=>i.deferred?i.editReply(payload):i.update(payload);
const memberById=async(guild,userId)=>guild.members.cache.get(String(userId))??await guild.members.fetch(String(userId)).catch(()=>null);

export async function handlePermissions(i,a){
  const id=i.customId??'';
  if(!id.startsWith('perm:')&&id!=='admin:permissions')return false;
  // البحث يظهر كأول خيار داخل قائمة الأعضاء نفسها على الجوال.
  if(i.isAnySelectMenu?.()&&pickerSearchValue(i.values?.[0])){
    const context={
      'perm:subject:user':'grant',
      'perm:deny-subject:user':'deny',
      'perm:revoke-subject:user':'revoke',
      'perm:delivery-subject':'delivery',
      'perm:subject:inspect':'inspect',
      'perm:super-grant-subject':'super-grant',
      'perm:super-revoke-subject':'super-revoke',
      'perm:dm-trial-grant-subject':'dm-grant',
      'perm:dm-trial-revoke-subject':'dm-revoke'
    }[id];
    if(context){const current=getMemberSearch(a,i.user.id,`perm:${context}`);return i.showModal(memberSearchModal(`perm:member-search-submit:${context}`,current,'بحث في أعضاء السيرفر'));}
  }
  // فتح نافذة البحث فورًا قبل أي I/O حتى لا تنتهي مهلة Discord.
  if(id.startsWith('perm:member-search:')){const context=id.split(':')[2];const current=getMemberSearch(a,i.user.id,`perm:${context}`);return i.showModal(memberSearchModal(`perm:member-search-submit:${context}`,current,'بحث في أعضاء السيرفر'));}
  const s=await subjectFromInteraction(i,a.env);
  if(id.startsWith('perm:team-manager'))return handleTeamManagers(i,a,s);
  await a.permissionService.assert(s,'permissions.manage');
  if(id.startsWith('perm:member-search-submit:'))return permissionMemberSearchSubmit(i,a,s,id.split(':')[2]);
  if(id.startsWith('perm:member-search-clear:'))return permissionMemberSearchClear(i,a,s,id.split(':')[2]);

  if(id==='admin:permissions')return home(i,a,s);
  if(id==='perm:catalog')return catalogHome(i,a,s);
  if(id==='perm:catalog-category')return catalogCategory(i,a,s,i.values[0]);
  if(id==='perm:inspect-user')return memberPicker(i,s,'inspect',0,a);
  if(id==='perm:inspect-grant')return inspectGrant(i,a,s);
  if(id==='perm:inspect-revoke')return inspectRevoke(i,a,s);
  if(id==='perm:inspect-deny')return inspectDeny(i,a,s);
  if(id==='perm:delivery-user')return memberPicker(i,s,'delivery',0,a);
  if(id==='perm:grant-user')return memberPicker(i,s,'grant',0,a);
  if(id==='perm:deny-user')return memberPicker(i,s,'deny',0,a);
  if(id==='perm:grant-role')return rolePicker(i,s,'grant',0);
  if(id==='perm:deny-role')return rolePicker(i,s,'deny',0);
  if(id==='perm:revoke-user')return memberPicker(i,s,'revoke',0,a);
  if(id==='perm:revoke-role')return rolePicker(i,s,'revoke',0);
  if(id==='perm:super-home')return superHome(i,a,s);
  if(id==='perm:super-grant')return superGrantPicker(i,a,s,0);
  if(id.startsWith('perm:super-grant-page:'))return superGrantPicker(i,a,s,Number(id.split(':')[2]));
  if(id==='perm:super-grant-subject'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return superGrantPicker(i,a,s,page);return superGrantSubject(i,a,s);}
  if(id==='perm:super-grant-confirm')return superGrantConfirm(i,a,s);
  if(id==='perm:super-revoke')return superRevokePicker(i,a,s,0);
  if(id.startsWith('perm:super-revoke-page:'))return superRevokePicker(i,a,s,Number(id.split(':')[2]||0));
  if(id==='perm:super-revoke-subject'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return superRevokePicker(i,a,s,page);return superRevokeSubject(i,a,s);}
  if(id==='perm:super-revoke-confirm')return superRevokeConfirm(i,a,s);
  if(id==='perm:dm-trial-home')return dmTrialHome(i,a,s);
  if(id==='perm:dm-trial-grant')return dmTrialGrantPicker(i,a,s,0);
  if(id.startsWith('perm:dm-trial-grant-page:'))return dmTrialGrantPicker(i,a,s,Number(id.split(':')[2]));
  if(id==='perm:dm-trial-grant-subject'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return dmTrialGrantPicker(i,a,s,page);return dmTrialGrantSubject(i,a,s);}
  if(id==='perm:dm-trial-grant-confirm')return dmTrialGrantConfirm(i,a,s);
  if(id==='perm:dm-trial-revoke')return dmTrialRevokePicker(i,a,s,0);
  if(id.startsWith('perm:dm-trial-revoke-page:'))return dmTrialRevokePicker(i,a,s,Number(id.split(':')[2]||0));
  if(id==='perm:dm-trial-revoke-subject'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return dmTrialRevokePicker(i,a,s,page);return dmTrialRevokeSubject(i,a,s);}
  if(id==='perm:dm-trial-revoke-confirm')return dmTrialRevokeConfirm(i,a,s);
  if(id.startsWith('perm:member-page:')){const [, , mode,page]=id.split(':');return memberPicker(i,s,mode,Number(page),a);}
  if(id.startsWith('perm:role-page:')){const [, , mode,page]=id.split(':');return rolePicker(i,s,mode,Number(page));}
  if(id==='perm:delivery-subject'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return memberPicker(i,s,'delivery',page,a);return deliverySubject(i,a,s);}
  if(id==='perm:delivery-team')return deliveryTeam(i,a,s);
  if(id==='perm:grant-team')return chooseTeamSubject(i,a,s,'grant');
  if(id==='perm:deny-team')return chooseTeamSubject(i,a,s,'deny');
  if(id==='perm:revoke-team')return chooseTeamSubject(i,a,s,'revoke');
  if(id==='perm:subject:user'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return memberPicker(i,s,'grant',page,a);return subjectPicked(i,a,s,'user','allow');}
  if(id==='perm:deny-subject:user'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return memberPicker(i,s,'deny',page,a);return subjectPicked(i,a,s,'user','deny');}
  if(id==='perm:subject:inspect'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return memberPicker(i,s,'inspect',page,a);return inspectUser(i,a,s);}
  if(id==='perm:subject:role'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return rolePicker(i,s,'grant',page);return subjectPicked(i,a,s,'role','allow');}
  if(id==='perm:deny-subject:role'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return rolePicker(i,s,'deny',page);return subjectPicked(i,a,s,'role','deny');}
  if(id==='perm:revoke-subject:user'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return memberPicker(i,s,'revoke',page,a);return revokeSubjectPicked(i,a,s,'user');}
  if(id==='perm:revoke-subject:role'){const page=pickerPageValue(i.values?.[0]);if(page!==null)return rolePicker(i,s,'revoke',page);return revokeSubjectPicked(i,a,s,'role');}
  if(id.startsWith('perm:team-subject:'))return teamSubjectPicked(i,a,s,id.split(':')[2]);
  if(id.startsWith('perm:subject:'))return subjectPicked(i,a,s,id.split(':')[2]);
  if(id.startsWith('perm:revoke-subject:'))return revokeSubjectPicked(i,a,s,id.split(':')[2]);
  if(id==='perm:permission-category')return permissionCategoryPicked(i,a,s);
  if(id==='perm:permission')return permissionPicked(i,a,s);
  if(id==='perm:scope')return scopePicked(i,a,s);
  if(id==='perm:scope-team')return grant(i,a,s,'team',i.values[0]);
  if(id==='perm:scope-meeting')return grant(i,a,s,'meeting',i.values[0]);
  if(id.startsWith('perm:revoke-page:')){const [, , ,type,page]=id.split(':');const d=a.drafts.get(`perm-revoke:${s.userId}`);if(!d)throw new AppError('DRAFT_EXPIRED','انتهت جلسة سحب الصلاحية.');return showRevoke(i,a,s,type,d.subjectId,Number(page));}
  if(id.startsWith('perm:revoke-grant:'))return revokeGrant(i,a,s,id.split(':')[2],i.values[0]);
  return false;
}

function home(i,a,s){
  const buttons=[
    btn('perm:catalog','دليل الصلاحيات',ButtonStyle.Primary,'📚'),
    btn('perm:inspect-user','فحص صلاحيات عضو',ButtonStyle.Secondary,'🔎'),
    btn('perm:delivery-user','وصول مخرجات فريق',ButtonStyle.Secondary,'📨'),
    btn('perm:grant-user','تعيين مسؤول / منح صلاحية',ButtonStyle.Secondary,'👤'),
    btn('perm:deny-user','منع عن مستخدم',ButtonStyle.Danger,'⛔'),
    btn('perm:revoke-user','سحب سجل مستخدم',ButtonStyle.Secondary,'➖'),
    btn('perm:grant-role','منح لرتبة',ButtonStyle.Secondary,'🏷️'),
    btn('perm:deny-role','منع عن رتبة',ButtonStyle.Danger,'⛔'),
    btn('perm:revoke-role','سحب سجل رتبة',ButtonStyle.Secondary,'➖'),
    btn('perm:grant-team','منح لفريق',ButtonStyle.Secondary,'👥'),
    btn('perm:deny-team','منع عن فريق',ButtonStyle.Danger,'⛔'),
    btn('perm:revoke-team','سحب سجل فريق',ButtonStyle.Secondary,'➖')
  ];
  if(a.permissionService.isOwner(s.userId)){
    buttons.push(btn('perm:team-manager-home','مسؤول الفريق',ButtonStyle.Primary));
    buttons.unshift(btn('perm:super-home','وصول الإدارة العليا',ButtonStyle.Danger,'⭐'));
    buttons.push(btn('perm:dm-trial-home','وصول الخاص التجريبي',ButtonStyle.Secondary,'🧪'));
  }
  const desc=[
    '**من هنا تعيّن الأشخاص المسؤولين وتحدد صلاحيات كل شخص ونطاق عمله داخل Operations 967.**',
    '',
    '📚 **دليل الصلاحيات:** كل صلاحية باسم عربي ووصف واضح ومفتاحها البرمجي ومستوى حساسيتها.',
    '👤 **تعيين مسؤول / منح صلاحية:** اختر الشخص، ثم الصلاحية العربية، ثم النطاق: النظام كله أو فريق محدد أو اجتماع محدد.',
    '🔎 **فحص صلاحيات عضو:** يعرض الصلاحيات المباشرة والموروثة من الرتب والفرق، ثم يمكنك المنح أو السحب.',
    '✅ **منح:** يضيف سماحًا للصلاحية. ⛔ **منع:** يضيف منعًا صريحًا، والمنع يفوز على السماح عند نفس النطاق.',
    '➖ **سحب سجل:** يحذف سجل سماح أو منع موجود بدون إنشاء قرار جديد.',
    '👤 **المستخدم:** الصلاحية لشخص محدد.',
    '🏷️ **الرتبة:** كل من يحمل رتبة Discord يستفيد من الصلاحية.',
    '👥 **الفريق:** كل الأعضاء النشطين داخل الفريق يستفيدون منها.',
    '',
    '**النطاقات:** 🌐 عالمي = كل النظام • 👥 فريق = فريق محدد • 🗓️ اجتماع = اجتماع محدد.',
    'عند تعارض منح ومنع في نفس النطاق، المنع يفوز. والـOwner يملك وصولًا كاملًا ثابتًا.'
  ].join('\n');
  return i.update({content:null,embeds:[e('🔐 الصلاحيات والمسؤولون',desc)],components:withNavigation(rowsFromButtons(buttons))});
}

function categoryOptions(){
  return Object.entries(PERMISSION_CATEGORIES).map(([value,cat])=>({label:`${cat.emoji} ${cat.label}`.slice(0,100),description:cat.description.slice(0,100),value}));
}
function scopeArabic(type){return type==='global'?'عالمي — كل النظام':type==='team'?'فريق محدد':type==='meeting'?'اجتماع محدد':type;}
function sourceArabic(source){return source==='user'?'مباشرة للمستخدم':source==='role'?'موروثة من رتبة Discord':source==='team'?'موروثة من الفريق':source;}
function effectArabic(effect){return effect==='deny'?'منع':'سماح';}

// first-contact-welcome-v1.10.2: permission notifications
async function notifyPermissionUser(i,a,s,userId,title,description){
  // production-dm:permission-notice — no trial allowlist required
  try{
    const user=i.client.users.cache.get(String(userId))??await i.client.users.fetch(String(userId));
    await user.send({
      embeds:[e(title,description)],
      components:rowsFromButtons([btn('panel:refresh','فتح لوحتي',ButtonStyle.Primary,'🏠')])
    });
    return true;
  }catch(error){
    a.logger?.warn?.('permission-user-dm-failed',{userId:String(userId),error:error?.message??String(error)});
    return false;
  }
}

function catalogHome(i,a,s){
  const special=a.permissionService.isOwner(s.userId)?'\n\n⭐ **صلاحيات خاصة بالـOwner:** وصول الإدارة العليا ووصول الخاص التجريبي تداران من أزرارهما المنفصلة ولا تظهر ضمن المنح العادي.':'';
  const desc='اختر قسمًا لعرض كل صلاحياته بالعربي. ستشاهد **الاسم العربي، المفتاح البرمجي، الوصف، مستوى الحساسية، والنطاقات المتاحة**.'+special;
  return i.update({content:null,embeds:[e('📚 دليل الصلاحيات',desc)],components:withNavigation([stringSelect('perm:catalog-category','اختر قسم الصلاحيات',categoryOptions())],'admin:permissions','مركز الصلاحيات')});
}
function catalogCategory(i,a,s,category){
  const cat=PERMISSION_CATEGORIES[category];
  if(!cat)return catalogHome(i,a,s);
  const keys=permissionsInCategory(category);
  const lines=keys.map((key,idx)=>{
    const m=permissionMeta(key);
    return `**${idx+1}. ${m.label}**\n\`${key}\`\n${m.description}\n• الحساسية: **${m.risk}** • النطاق: عالمي / فريق / اجتماع`;
  });
  const desc=`${cat.description}\n\n${lines.join('\n\n')}`;
  return i.update({content:null,embeds:[e(`${cat.emoji} ${cat.label} — دليل الصلاحيات`,desc)],components:withNavigation([stringSelect('perm:catalog-category','انتقل إلى قسم آخر',categoryOptions())],'admin:permissions','مركز الصلاحيات')});
}


async function memberPicker(i,s,mode,page=0,a=null){
  if(!userSelectId[mode])throw new AppError('INVALID_PICKER','نوع اختيار المستخدم غير صالح.');
  if(!a)throw new AppError('PICKER_APP_MISSING','تعذر تحميل سياق البحث.');
  await deferForPicker(i);
  const allOptions=await guildMemberOptions(s.guild,{includeBots:false});
  setSmartMemberContext(a,s.userId,{customId:userSelectId[mode],options:allOptions,title:'اختيار عضو',context:`perm:${mode}`});
  const context=`perm:${mode}`;const query=getMemberSearch(a,s.userId,context);const filteredOptions=filterMemberOptions(allOptions,query);const options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);
  if(!allOptions.length)return render(i,{content:'لا يوجد أعضاء بشريون متاحون في السيرفر.',embeds:[],components:withNavigation([],'admin:permissions')});
  const searchRows=memberSearchRows({openId:`perm:member-search:${mode}`,clearId:`perm:member-search-clear:${mode}`,query});
  if(!options.length)return render(i,{content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,embeds:[],components:withNavigation(searchRows,'admin:permissions')});
  const p=pickerMenuPage(options,page);
  const components=[...searchRows,stringSelect(userSelectId[mode],`اختر عضوًا — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];
  const pager=[];
  if(p.page>0)pager.push(btn(`perm:member-page:${mode}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(p.page+1<p.pages)pager.push(btn(`perm:member-page:${mode}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length)components.push(...rowsFromButtons(pager));
  const purpose=mode==='delivery'?'اختر الشخص لمنحه وصولًا لمخرجات فريق محدد — بدون إرسال خاص':mode==='revoke'?'اختر المستخدم لسحب سجل صلاحية منه':mode==='inspect'?'اختر العضو لعرض جميع صلاحياته ومصادرها':mode==='deny'?'اختر المستخدم لإضافة منع صريح عليه':'اختر المستخدم لمنحه صلاحية';
  return render(i,{content:`${purpose}:\n**كل أعضاء السيرفر (Online وOffline)** — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}\n💡 ابحث بالاسم الظاهر أو اسم المستخدم Discord.${smartMemberHint()}`,embeds:[],components:withNavigation(components,'admin:permissions')});
}

async function rolePicker(i,s,mode,page){
  if(!roleSelectId[mode])throw new AppError('INVALID_PICKER','نوع اختيار الرتبة غير صالح.');
  await deferForPicker(i);
  const options=await guildRoleOptions(s.guild,{includeManaged:false});
  if(!options.length)return render(i,{content:'لا توجد رتب قابلة للإدارة في السيرفر.',embeds:[],components:withNavigation([],'admin:permissions')});
  const p=pickerPage(options,page);
  const components=[stringSelect(roleSelectId[mode],`اختر رتبة — ${p.start+1}-${p.end} من ${p.total}`,p.items)];
  const pager=[];
  if(p.page>0)pager.push(btn(`perm:role-page:${mode}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(p.page+1<p.pages)pager.push(btn(`perm:role-page:${mode}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length)components.push(...rowsFromButtons(pager));
  const purpose=mode==='revoke'?'اختر الرتبة لسحب سجل صلاحية منها':mode==='deny'?'اختر الرتبة لإضافة منع صريح عليها':'اختر الرتبة لمنحها صلاحية';
  return render(i,{content:`${purpose}:\n**رتب السيرفر الحقيقية** — صفحة ${p.page+1}/${p.pages}.`,embeds:[],components:withNavigation(components,'admin:permissions')});
}

async function chooseTeamSubject(i,a,s,mode){const teams=await a.teams.list(s.guildId);const comps=[stringSelect(`perm:team-subject:${mode}`,'الفريق',teams.map(t=>({label:t.name,value:t.id})))];if(await a.permissionService.hasPotential(s,'teams.manage'))comps.push(...rowsFromButtons([btn('team:delete-pick','حذف فريق',ButtonStyle.Danger,'🗑️')]));return i.update({content:'اختر الفريق صاحب الصلاحية:',embeds:[],components:withNavigation(comps,'admin:permissions')});}
async function teamSubjectPicked(i,a,s,mode){const teamId=i.values[0];if(mode==='revoke')return showRevoke(i,a,s,'team',teamId);a.drafts.set(`perm:${s.userId}`,{type:'team',subjectId:teamId,effect:mode==='deny'?'deny':'allow'});return showPermission(i);}
async function subjectPicked(i,a,s,type,effect='allow'){a.drafts.set(`perm:${s.userId}`,{type,subjectId:i.values[0],effect});return showPermission(i);}
function showPermission(i){
  return i.update({content:'**اختر قسم الصلاحية أولًا:**\nبهذا تظهر لك جميع الصلاحيات بدون حد قائمة Discord البالغ 25 خيارًا.',embeds:[],components:withNavigation([stringSelect('perm:permission-category','قسم الصلاحيات',categoryOptions())],'admin:permissions','مركز الصلاحيات')});
}
function permissionCategoryPicked(i,a,s){
  const category=i.values[0];
  const cat=PERMISSION_CATEGORIES[category];
  const keys=permissionsInCategory(category);
  if(!cat||!keys.length)throw new AppError('INVALID_PERMISSION_CATEGORY','قسم الصلاحيات غير صالح.');
  const options=keys.map((key)=>{const m=permissionMeta(key);return {label:m.label.slice(0,100),description:`${m.risk} • ${key}`.slice(0,100),value:key};});
  return i.update({content:`**${cat.emoji} ${cat.label}** — اختر الصلاحية المطلوبة:`,embeds:[],components:withNavigation([stringSelect('perm:permission','الصلاحية',options)],'admin:permissions','مركز الصلاحيات')});
}
async function permissionPicked(i,a,s){const permission=i.values[0];const d=a.drafts.merge(`perm:${s.userId}`,{permission});if(!d)throw new AppError('DRAFT_EXPIRED','انتهت الجلسة.');const m=permissionMeta(permission);return i.update({content:`**${m.label}**\n${m.description}\n\nالمفتاح: \`${permission}\` • الحساسية: **${m.risk}**\n\nاختر نطاق الصلاحية:`,embeds:[],components:withNavigation([stringSelect('perm:scope','النطاق',[{label:'🌐 عالمي — كل النظام',description:'تعمل في جميع الفرق والاجتماعات.',value:'global'},{label:'👥 فريق — فريق محدد',description:'تعمل فقط عندما يطابق السياق الفريق المختار.',value:'team'},{label:'🗓️ اجتماع — اجتماع محدد',description:'تعمل فقط على اجتماع واحد محدد.',value:'meeting'}])],'admin:permissions','مركز الصلاحيات')});}
async function scopePicked(i,a,s){const scope=i.values[0];if(scope==='global')return grant(i,a,s,'global',null);if(scope==='team'){const teams=await a.teams.list(s.guildId);const comps=[stringSelect('perm:scope-team','الفريق',teams.map(t=>({label:t.name,value:t.id})))];if(await a.permissionService.hasPotential(s,'teams.manage'))comps.push(...rowsFromButtons([btn('team:delete-pick','حذف فريق',ButtonStyle.Danger,'🗑️')]));return i.update({content:'اختر الفريق الذي تنطبق عليه الصلاحية:',components:withNavigation(comps,'admin:permissions')});}const ms=await a.meetings.listForGuild(s.guildId,{limit:25});return i.update({content:'اختر الاجتماع:',components:withNavigation([stringSelect('perm:scope-meeting','الاجتماع',ms.map(m=>({label:m.name.slice(0,100),description:m.team_name.slice(0,100),value:m.id})))],'admin:permissions')});}
async function grant(i,a,s,scopeType,scopeId){a.rateLimiter.consume(`permissions:${s.userId}`,{limit:10,windowMs:60_000});const d=a.drafts.get(`perm:${s.userId}`);if(!d)throw new AppError('DRAFT_EXPIRED','انتهت جلسة الصلاحيات.');const effect=d.effect==='deny'?'deny':'allow';const args={guildId:s.guildId,permission:d.permission,effect,scopeType,scopeId,actorId:s.userId};if(d.type==='user')await a.permissions.grantUser({...args,userId:d.subjectId});else if(d.type==='role')await a.permissions.grantRole({...args,roleId:d.subjectId});else await a.permissions.grantTeam({...args,teamId:d.subjectId});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:effect==='deny'?'permission.deny':'permission.grant',targetType:d.type,targetId:d.subjectId,newValue:{permission:d.permission,effect,scopeType,scopeId}});if(d.type==='user'){const label=permissionLabel(d.permission);const title=effect==='deny'?'⛔ تحديث على صلاحياتك — Operations 967':'🔐 صلاحية جديدة — Operations 967';const desc=effect==='deny'?`تم تطبيق **منع** على صلاحية **${label}** ضمن نطاق **${scopeArabic(scopeType)}**.\n\nإذا احتجت توضيحًا راجع مسؤول الفريق أو الإدارة.`:`تم منحك صلاحية **${label}** ضمن نطاق **${scopeArabic(scopeType)}**.\n\nستظهر لك الأدوات المرتبطة بها تلقائيًا في لوحتك.`;await notifyPermissionUser(i,a,s,d.subjectId,title,desc);}a.drafts.delete(`perm:${s.userId}`);const verb=effect==='deny'?'⛔ تم منع':'✅ تم منح';return i.update({content:`${verb} **${permissionLabel(d.permission)}**\n\`${d.permission}\`\nالنطاق: **${scopeArabic(scopeType)}**.`,embeds:[],components:withNavigation([],'admin:permissions','مركز الصلاحيات')});}
async function revokeSubjectPicked(i,a,s,type){return showRevoke(i,a,s,type,i.values[0]);}
async function showRevoke(i,a,s,type,subjectId,page=0){
  let grants=await a.permissions.listSubject({guildId:s.guildId,type,id:subjectId});
  grants=grants.filter(g=>g.permission_key!==DM_TRIAL_PERMISSION);
  if(!a.permissionService.isOwner(s.userId))grants=grants.filter(g=>g.permission_key!==SUPER_ADMIN_PERMISSION);
  if(!grants.length)return i.update({content:'لا توجد سجلات صلاحيات مباشرة قابلة للسحب لهذا العنصر.',embeds:[],components:withNavigation([],'admin:permissions','مركز الصلاحيات')});
  a.drafts.set(`perm-revoke:${s.userId}`,{type,subjectId});
  const pageSize=20;const pages=Math.max(1,Math.ceil(grants.length/pageSize));const safePage=Math.max(0,Math.min(Number(page)||0,pages-1));const slice=grants.slice(safePage*pageSize,(safePage+1)*pageSize);
  const options=slice.map(g=>({label:permissionLabel(g.permission_key).slice(0,100),description:`${effectArabic(g.effect)} • ${scopeArabic(g.scope_type)} • ${g.permission_key}`.slice(0,100),value:String(g.id)}));
  const components=[stringSelect(`perm:revoke-grant:${type}`,'اختر سجل الصلاحية',options)];
  const pager=[];if(safePage>0)pager.push(btn(`perm:revoke-page:${type}:${safePage-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(safePage+1<pages)pager.push(btn(`perm:revoke-page:${type}:${safePage+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)components.push(...rowsFromButtons(pager));
  return i.update({content:`اختر سجل **السماح أو المنع** المراد حذفه. الاسم بالعربي والمفتاح والنطاق في الوصف.\nصفحة **${safePage+1}/${pages}** — ${grants.length} سجل.`,embeds:[],components:withNavigation(components,'admin:permissions','مركز الصلاحيات')});
}
async function revokeGrant(i,a,s,type,grantId){a.rateLimiter.consume(`permissions:${s.userId}`,{limit:10,windowMs:60_000});const d=a.drafts.get(`perm-revoke:${s.userId}`);if(!d)throw new AppError('DRAFT_EXPIRED','انتهت جلسة سحب الصلاحية.');const grants=await a.permissions.listSubject({guildId:s.guildId,type,id:d.subjectId});const target=grants.find(g=>String(g.id)===String(grantId));if(target?.permission_key===SUPER_ADMIN_PERMISSION&&!a.permissionService.isOwner(s.userId))throw new AppError('OWNER_ONLY','وصول الإدارة العليا لا يستطيع سحبه إلا Owner النظام.');const old=await a.permissions.revoke({type,grantId});if(!old)throw new AppError('NOT_FOUND','الصلاحية غير موجودة.');await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'permission.revoke',targetType:type,targetId:d.subjectId,oldValue:old});if(type==='user')await notifyPermissionUser(i,a,s,d.subjectId,'🔐 تحديث على صلاحياتك — Operations 967',`تم سحب سجل صلاحية **${permissionLabel(old.permission_key)}** من حسابك.\n\nلوحتك ستتحدث تلقائيًا حسب الصلاحيات المتبقية لديك.`);a.drafts.delete(`perm-revoke:${s.userId}`);return i.update({content:`✅ تم سحب **${permissionLabel(old.permission_key)}**\n\`${old.permission_key}\``,embeds:[],components:withNavigation([],'admin:permissions','مركز الصلاحيات')});}
async function inspectUser(i,a,s){
  const userId=String(i.values[0]);
  const member=await memberById(s.guild,userId);
  if(!member)throw new AppError('MEMBER_NOT_FOUND','تعذر تحميل العضو من السيرفر.');
  a.drafts.set(`perm-inspect:${s.userId}`,{userId});
  if(a.permissionService.isOwner(userId)){
    return i.update({content:null,embeds:[e('🔎 فحص صلاحيات العضو',`<@${userId}> هو **Owner النظام**.\n\nيمتلك وصولًا كاملًا ثابتًا لجميع صلاحيات Meeting 967 ولا يعتمد على سجلات منح في قاعدة البيانات، لذلك لا يمكن سحب صلاحيات الـOwner من هذا المركز.`)],components:withNavigation([],'admin:permissions','مركز الصلاحيات')});
  }
  const roleIds=[...member.roles.cache.keys()].map(String);
  const subject={guildId:s.guildId,userId,roleIds};
  const [direct,effective,isSuper]=await Promise.all([
    a.permissions.listSubject({guildId:s.guildId,type:'user',id:userId}),
    a.permissionService.grants(subject),
    a.permissionService.isSuperAdmin(subject)
  ]);
  const visible=effective.filter(g=>g.permission_key!==DM_TRIAL_PERMISSION);
  const dedup=[];const seen=new Set();
  for(const g of visible){const k=`${g.permission_key}|${g.effect}|${g.scope_type}|${g.scope_id??''}|${g.source}`;if(seen.has(k))continue;seen.add(k);dedup.push(g);}
  const lines=dedup.slice(0,24).map(g=>`• **${permissionLabel(g.permission_key)}** — ${effectArabic(g.effect)}\n  \`${g.permission_key}\` • ${scopeArabic(g.scope_type)} • ${sourceArabic(g.source)}`);
  const extra=dedup.length>24?`\n… و${dedup.length-24} سجل صلاحية آخر.`:'';
  const special=isSuper?'⭐ **هذا العضو يملك وصول الإدارة العليا**؛ لذلك يستطيع استخدام جميع الصلاحيات العادية عالميًا حتى لو لم تظهر كسجلات منفصلة.\n\n':'';
  const desc=`العضو: <@${userId}>\nالصلاحيات المباشرة للمستخدم: **${direct.filter(g=>g.permission_key!==DM_TRIAL_PERMISSION).length}** • إجمالي السجلات الفعالة/الموروثة: **${dedup.length}**\n\n${special}${lines.join('\n')||'لا توجد لهذا العضو صلاحيات مباشرة أو موروثة حاليًا.'}${extra}\n\n**المصدر** يوضح هل الصلاحية مباشرة للمستخدم أو موروثة من رتبة Discord أو عضوية فريق.`;
  const buttons=[btn('perm:inspect-grant','منح هذا العضو صلاحية',ButtonStyle.Primary,'➕'),btn('perm:inspect-deny','منع صلاحية عن العضو',ButtonStyle.Danger,'⛔')];
  if(direct.some(g=>g.permission_key!==DM_TRIAL_PERMISSION))buttons.push(btn('perm:inspect-revoke','سحب صلاحية مباشرة',ButtonStyle.Secondary,'➖'));
  return i.update({content:null,embeds:[e('🔎 فحص صلاحيات العضو',desc)],components:withNavigation(rowsFromButtons(buttons),'admin:permissions','مركز الصلاحيات')});
}
function inspectGrant(i,a,s){
  const d=a.drafts.get(`perm-inspect:${s.userId}`);
  if(!d)throw new AppError('DRAFT_EXPIRED','انتهت جلسة فحص الصلاحيات.');
  a.drafts.set(`perm:${s.userId}`,{type:'user',subjectId:d.userId,effect:'allow'});
  return showPermission(i);
}
function inspectDeny(i,a,s){
  const d=a.drafts.get(`perm-inspect:${s.userId}`);
  if(!d)throw new AppError('DRAFT_EXPIRED','انتهت جلسة فحص الصلاحيات.');
  a.drafts.set(`perm:${s.userId}`,{type:'user',subjectId:d.userId,effect:'deny'});
  return showPermission(i);
}
function inspectRevoke(i,a,s){
  const d=a.drafts.get(`perm-inspect:${s.userId}`);
  if(!d)throw new AppError('DRAFT_EXPIRED','انتهت جلسة فحص الصلاحيات.');
  return showRevoke(i,a,s,'user',d.userId);
}

function assertOwnerForSuper(s,a){if(!a.permissionService.isOwner(s.userId))throw new AppError('OWNER_ONLY','وصول الإدارة العليا لا يستطيع منحه أو سحبه إلا Owner النظام.');}
async function superHome(i,a,s){assertOwnerForSuper(s,a);const current=await a.permissions.usersWithDirectPermission({guildId:s.guildId,permission:SUPER_ADMIN_PERMISSION});const rows=current.slice(0,20);const members=await Promise.all(rows.map(row=>memberById(s.guild,row.user_id)));const names=rows.map((row,idx)=>`• ${members[idx]?`<@${row.user_id}>`:`${row.user_id}`}`);const desc='هذه صلاحية **خاصة جدًا** لمستخدم محدد. تمنحه نفس أقسام وأدوات لوحة المالك وصلاحيات تشغيلية عالمية داخل Meeting 967.\n\n🔒 لا يصبح OWNER، ولا يستطيع تغيير OWNER_USER_ID أو منح/سحب هذه الصلاحية.\n\n**الحاليون:**\n'+(names.join('\n')||'لا يوجد أحد.');return i.update({embeds:[e('⭐ وصول الإدارة العليا',desc)],components:withNavigation(rowsFromButtons([btn('perm:super-grant','منح وصول كامل',ButtonStyle.Danger,'➕'),btn('perm:super-revoke','سحب الوصول الكامل',ButtonStyle.Secondary,'➖')]),'admin:permissions')});}
async function superGrantPicker(i,a,s,page=0){
  assertOwnerForSuper(s,a);await deferForPicker(i);
  let allOptions;
  try{allOptions=(await guildMemberOptions(s.guild,{includeBots:false})).filter(x=>String(x.value)!==String(a.env.OWNER_USER_ID));}
  catch(error){throw new AppError('MEMBER_PICKER_FAILED','تعذر تحميل أعضاء السيرفر لمنح وصول الإدارة العليا. تأكد أن Server Members Intent مفعّل وأن البوت ما زال داخل السيرفر.',[error?.message].filter(Boolean));}
  setSmartMemberContext(a,s.userId,{customId:'perm:super-grant-subject',options:allOptions,title:'اختيار وصول الإدارة العليا',context:'perm:super-grant'});
  const context='perm:super-grant';const query=getMemberSearch(a,s.userId,context);const filteredOptions=filterMemberOptions(allOptions,query);const options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);const searchRows=memberSearchRows({openId:'perm:member-search:super-grant',clearId:'perm:member-search-clear:super-grant',query});
  if(!allOptions.length)return render(i,{content:'لا يوجد مستخدم بشري آخر متاح في السيرفر.',embeds:[],components:withNavigation([],'perm:super-home')});
  if(!options.length)return render(i,{content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,embeds:[],components:withNavigation(searchRows,'perm:super-home')});
  const p=pickerMenuPage(options,page);const comps=[...searchRows,stringSelect('perm:super-grant-subject',`اختر مستخدمًا — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];const pager=[];
  if(p.page>0)pager.push(btn(`perm:super-grant-page:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`perm:super-grant-page:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)comps.push(...rowsFromButtons(pager));
  return render(i,{content:`اختر الشخص الذي سيحصل على **نفس أدوات لوحة المالك** — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}${smartMemberHint()}`,embeds:[],components:withNavigation(comps,'perm:super-home')});
}

async function superGrantSubject(i,a,s){assertOwnerForSuper(s,a);const userId=String(i.values[0]);if(userId===String(a.env.OWNER_USER_ID))throw new AppError('ALREADY_OWNER','هذا الحساب هو Owner بالفعل.');a.drafts.set(`super-admin:${s.userId}`,{action:'grant',userId});return i.update({embeds:[e('⚠️ تأكيد وصول الإدارة العليا',`سيحصل <@${userId}> على **كل أدوات الإدارة داخل Meeting 967**، بما فيها إدارة الصلاحيات والإعدادات والنسخ الاحتياطي.\n\nلا تمنحها إلا لشخص تثق به جدًا.`)],components:withNavigation(rowsFromButtons([btn('perm:super-grant-confirm','تأكيد المنح',ButtonStyle.Danger,'⭐')]),'perm:super-home')});}
async function superGrantConfirm(i,a,s){assertOwnerForSuper(s,a);a.rateLimiter.consume(`super-admin:${s.userId}`,{limit:5,windowMs:60_000});const d=a.drafts.get(`super-admin:${s.userId}`);if(!d||d.action!=='grant')throw new AppError('DRAFT_EXPIRED','انتهت جلسة منح الوصول الخاص.');await a.permissions.grantUser({guildId:s.guildId,userId:d.userId,permission:SUPER_ADMIN_PERMISSION,effect:'allow',scopeType:'global',scopeId:null,actorId:s.userId});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'super_admin.grant',targetType:'user',targetId:d.userId,newValue:{permission:SUPER_ADMIN_PERMISSION,scope:'global'}});await notifyPermissionUser(i,a,s,d.userId,'⭐ تم منحك وصول الإدارة العليا — Operations 967','أصبحت تملك وصولًا إداريًا موسعًا داخل النظام. ستظهر لك الأقسام والأدوات الإدارية في لوحتك حسب هذه الصلاحية.\n\nاستخدم هذا الوصول للمسؤوليات الإدارية المصرح لك بها فقط.');a.drafts.delete(`super-admin:${s.userId}`);return i.update({content:`✅ تم منح <@${d.userId}> **وصول الإدارة العليا**. عند فتح /panel ستظهر له لوحة كاملة مشابهة للمالك.`,embeds:[],components:withNavigation([],'perm:super-home')});}
async function superRevokePicker(i,a,s,page=0){
  assertOwnerForSuper(s,a);await deferForPicker(i);
  const rows=await a.permissions.usersWithDirectPermission({guildId:s.guildId,permission:SUPER_ADMIN_PERMISSION});
  if(!rows.length)return render(i,{content:'لا يوجد مستخدم يملك وصول الإدارة العليا حاليًا.',embeds:[],components:withNavigation([],'perm:super-home')});
  const members=await Promise.all(rows.map(row=>memberById(s.guild,row.user_id)));const allOptions=rows.map((row,idx)=>{const m=members[idx];return {label:(m?.displayName??m?.user?.username??String(row.user_id)).slice(0,100),description:m?.user?.username?`@${m.user.username}`.slice(0,100):'وصول إدارة عليا',value:String(row.user_id)};});
  setSmartMemberContext(a,s.userId,{customId:'perm:super-revoke-subject',options:allOptions,title:'سحب وصول الإدارة العليا',context:'perm:super-revoke'});
  const context='perm:super-revoke';const query=getMemberSearch(a,s.userId,context);const filteredOptions=filterMemberOptions(allOptions,query);const options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);const searchRows=memberSearchRows({openId:'perm:member-search:super-revoke',clearId:'perm:member-search-clear:super-revoke',query});
  if(!options.length)return render(i,{content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,embeds:[],components:withNavigation(searchRows,'perm:super-home')});
  const p=pickerMenuPage(options,page);const comps=[...searchRows,stringSelect('perm:super-revoke-subject',`المستخدم — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];const pager=[];if(p.page>0)pager.push(btn(`perm:super-revoke-page:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`perm:super-revoke-page:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)comps.push(...rowsFromButtons(pager));
  return render(i,{content:`اختر الشخص الذي تريد سحب وصول الإدارة العليا منه — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}${smartMemberHint()}`,embeds:[],components:withNavigation(comps,'perm:super-home')});
}

async function superRevokeSubject(i,a,s){assertOwnerForSuper(s,a);const userId=String(i.values[0]);a.drafts.set(`super-admin:${s.userId}`,{action:'revoke',userId});return i.update({embeds:[e('تأكيد السحب',`هل تريد سحب **وصول الإدارة العليا** من <@${userId}>؟\nستعود لوحته فورًا إلى الصلاحيات العادية المتبقية لديه.`)],components:withNavigation(rowsFromButtons([btn('perm:super-revoke-confirm','تأكيد السحب',ButtonStyle.Danger,'➖')]),'perm:super-home')});}
async function superRevokeConfirm(i,a,s){assertOwnerForSuper(s,a);a.rateLimiter.consume(`super-admin:${s.userId}`,{limit:5,windowMs:60_000});const d=a.drafts.get(`super-admin:${s.userId}`);if(!d||d.action!=='revoke')throw new AppError('DRAFT_EXPIRED','انتهت جلسة سحب الوصول الخاص.');const removed=await a.permissions.revokeDirectUserPermission({guildId:s.guildId,userId:d.userId,permission:SUPER_ADMIN_PERMISSION});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'super_admin.revoke',targetType:'user',targetId:d.userId,oldValue:{permission:SUPER_ADMIN_PERMISSION,removed:removed.length}});await notifyPermissionUser(i,a,s,d.userId,'🔐 تحديث على وصولك الإداري — Operations 967','تم سحب **وصول الإدارة العليا** من حسابك. ستبقى لك أي صلاحيات أخرى مُنحت لك بشكل مستقل.');a.drafts.delete(`super-admin:${s.userId}`);return i.update({content:`✅ تم سحب وصول الإدارة العليا من <@${d.userId}>.`,embeds:[],components:withNavigation([],'perm:super-home')});}


function assertOwnerForDmTrial(s,a){if(!a.permissionService.isOwner(s.userId))throw new AppError('OWNER_ONLY','وصول الخاص التجريبي لا يستطيع إدارته إلا Owner النظام.');}
async function dmTrialHome(i,a,s){
  assertOwnerForDmTrial(s,a);
  const current=await a.permissions.usersWithDirectPermission({guildId:s.guildId,permission:DM_TRIAL_PERMISSION});
  const shown=current.slice(0,20);
  const members=await Promise.all(shown.map(row=>memberById(s.guild,row.user_id)));
  const names=shown.map((row,idx)=>`• ${members[idx]?`<@${row.user_id}>`:`${row.user_id}`}`);
  const extra=current.length>20?`\n… و${current.length-20} آخرين`:'';
  const desc='هذا الوصول مخصص **لفترة التجربة**. عند منحه لشخص، يرسل له Meeting 967 رسالة خاصة تلقائيًا فتظهر دردشة البوت عنده، ويستطيع فتح اللوحة من الزر داخل الرسالة.\n\n🔒 لا يمنحه أي صلاحية إدارية إضافية؛ ما يراه داخل اللوحة يظل حسب صلاحياته الأصلية.\n🔒 أي شخص غير موجود هنا لا يستطيع استخدام تفاعلات البوت في الخاص.\n\n**المسموح لهم حاليًا:**\n'+(names.join('\n')||'لا يوجد أحد.')+extra;
  return i.update({embeds:[e('🧪 وصول الخاص التجريبي',desc)],components:withNavigation(rowsFromButtons([btn('perm:dm-trial-grant','إضافة شخص للتجربة',ButtonStyle.Primary,'➕'),btn('perm:dm-trial-revoke','إزالة شخص',ButtonStyle.Secondary,'➖')]),'admin:permissions')});
}
async function dmTrialGrantPicker(i,a,s,page=0){
  assertOwnerForDmTrial(s,a);await deferForPicker(i);let allOptions;
  try{const current=await a.permissions.usersWithDirectPermission({guildId:s.guildId,permission:DM_TRIAL_PERMISSION});const existing=new Set(current.map(x=>String(x.user_id)));allOptions=(await guildMemberOptions(s.guild,{includeBots:false})).filter(x=>String(x.value)!==String(a.env.OWNER_USER_ID)).filter(x=>!existing.has(String(x.value)));}
  catch(error){throw new AppError('MEMBER_PICKER_FAILED','تعذر تحميل أعضاء السيرفر لإضافة مستخدم إلى تجربة الخاص.',[error?.message].filter(Boolean));}
  setSmartMemberContext(a,s.userId,{customId:'perm:dm-trial-grant-subject',options:allOptions,title:'اختيار مستخدم للتجربة',context:'perm:dm-grant'});
  const context='perm:dm-grant';const query=getMemberSearch(a,s.userId,context);const filteredOptions=filterMemberOptions(allOptions,query);const options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);const searchRows=memberSearchRows({openId:'perm:member-search:dm-grant',clearId:'perm:member-search-clear:dm-grant',query});
  if(!allOptions.length)return render(i,{content:'كل الأعضاء المتاحين مضافون بالفعل، أو لا يوجد عضو بشري آخر.',embeds:[],components:withNavigation([],'perm:dm-trial-home')});
  if(!options.length)return render(i,{content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,embeds:[],components:withNavigation(searchRows,'perm:dm-trial-home')});
  const p=pickerMenuPage(options,page);const comps=[...searchRows,stringSelect('perm:dm-trial-grant-subject',`اختر شخصًا — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];const pager=[];if(p.page>0)pager.push(btn(`perm:dm-trial-grant-page:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`perm:dm-trial-grant-page:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)comps.push(...rowsFromButtons(pager));
  return render(i,{content:`اختر الشخص الذي تريد أن **تظهر له دردشة Meeting 967 الخاصة** خلال التجربة — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}${smartMemberHint()}`,embeds:[],components:withNavigation(comps,'perm:dm-trial-home')});
}

async function dmTrialGrantSubject(i,a,s){
  assertOwnerForDmTrial(s,a);
  const userId=String(i.values[0]);
  a.drafts.set(`dm-trial:${s.userId}`,{action:'grant',userId});
  return i.update({embeds:[e('🧪 تأكيد تجربة الخاص',`سيتم فتح الوصول الخاص لـ <@${userId}> وإرسال رسالة من البوت له مباشرة حتى تظهر دردشة Meeting 967 في قائمته.\n\nهذا **لا يمنحه صلاحيات إدارة** من نفسه؛ اللوحة ستطبق صلاحياته الحالية فقط.`)],components:withNavigation(rowsFromButtons([btn('perm:dm-trial-grant-confirm','تأكيد وإرسال الخاص',ButtonStyle.Primary,'📨')]),'perm:dm-trial-home')});
}
async function dmTrialGrantConfirm(i,a,s){
  assertOwnerForDmTrial(s,a);
  a.rateLimiter.consume(`dm-trial:${s.userId}`,{limit:8,windowMs:60_000});
  const d=a.drafts.get(`dm-trial:${s.userId}`);
  if(!d||d.action!=='grant')throw new AppError('DRAFT_EXPIRED','انتهت جلسة تجربة الخاص.');
  await a.permissions.grantUser({guildId:s.guildId,userId:d.userId,permission:DM_TRIAL_PERMISSION,effect:'allow',scopeType:'global',scopeId:null,actorId:s.userId});
  let dmSent=false,dmError=null;
  try{
    const user=i.client.users.cache.get(String(d.userId))??await i.client.users.fetch(d.userId);
    await user.send({embeds:[e('🧪 تم تفعيل وصولك التجريبي إلى Meeting 967','اختارك Owner النظام لتجربة لوحة Meeting 967 في الخاص.\n\nاضغط الزر بالأسفل لفتح لوحتك. في بداية اللوحة سيظهر لك تعريف مختصر مخصص حسب صلاحياتك وفريقك، ويمكنك فتح **📘 كيف أستخدم البوت؟** في أي وقت.')],components:rowsFromButtons([btn('panel:refresh','فتح لوحة Meeting 967',ButtonStyle.Primary,'🧪')])});
    dmSent=true;
  }catch(error){dmError=error?.message??String(error);}
  await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'dm_trial.grant',targetType:'user',targetId:d.userId,newValue:{permission:DM_TRIAL_PERMISSION,dmSent,dmError}});
  a.drafts.delete(`dm-trial:${s.userId}`);
  const message=dmSent
    ?`✅ تم فتح **الخاص التجريبي** لـ <@${d.userId}> وإرسال رسالة له. الآن ستظهر دردشة البوت عنده.`
    :`⚠️ تم منح <@${d.userId}> وصول الخاص التجريبي، لكن Discord منع البوت من إرسال أول رسالة له. غالبًا الخاص مغلق عنده أو يمنع رسائل أعضاء السيرفر. بعد السماح بالـDM يمكنك إعادة إضافته/إرسال الدعوة من هنا.\n\nالسبب التقني: ${String(dmError??'غير معروف').slice(0,300)}`;
  return i.update({content:message,embeds:[],components:withNavigation([],'perm:dm-trial-home')});
}
async function dmTrialRevokePicker(i,a,s,page=0){
  assertOwnerForDmTrial(s,a);await deferForPicker(i);const rows=await a.permissions.usersWithDirectPermission({guildId:s.guildId,permission:DM_TRIAL_PERMISSION});
  if(!rows.length)return render(i,{content:'لا يوجد أحد ضمن تجربة الخاص حاليًا.',embeds:[],components:withNavigation([],'perm:dm-trial-home')});
  const members=await Promise.all(rows.map(row=>memberById(s.guild,row.user_id)));const allOptions=rows.map((row,idx)=>{const m=members[idx];return {label:(m?.displayName??m?.user?.username??String(row.user_id)).slice(0,100),description:m?.user?.username?`@${m.user.username}`.slice(0,100):'وصول خاص تجريبي',value:String(row.user_id)};});
  setSmartMemberContext(a,s.userId,{customId:'perm:dm-trial-revoke-subject',options:allOptions,title:'إزالة مستخدم من التجربة',context:'perm:dm-revoke'});
  const context='perm:dm-revoke';const query=getMemberSearch(a,s.userId,context);const filteredOptions=filterMemberOptions(allOptions,query);const options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);const searchRows=memberSearchRows({openId:'perm:member-search:dm-revoke',clearId:'perm:member-search-clear:dm-revoke',query});
  if(!options.length)return render(i,{content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,embeds:[],components:withNavigation(searchRows,'perm:dm-trial-home')});
  const p=pickerMenuPage(options,page);const comps=[...searchRows,stringSelect('perm:dm-trial-revoke-subject',`المستخدم — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];const pager=[];if(p.page>0)pager.push(btn(`perm:dm-trial-revoke-page:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`perm:dm-trial-revoke-page:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)comps.push(...rowsFromButtons(pager));
  return render(i,{content:`اختر الشخص الذي تريد إيقاف وصوله للخاص التجريبي — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}${smartMemberHint()}`,embeds:[],components:withNavigation(comps,'perm:dm-trial-home')});
}

async function dmTrialRevokeSubject(i,a,s){
  assertOwnerForDmTrial(s,a);
  const userId=String(i.values[0]);
  a.drafts.set(`dm-trial:${s.userId}`,{action:'revoke',userId});
  return i.update({embeds:[e('تأكيد إيقاف الخاص التجريبي',`سيتم منع <@${userId}> من استخدام تفاعلات Meeting 967 في الخاص.\nالدردشة القديمة قد تبقى ظاهرة في Discord، لكن أزرار ولوحة البوت لن تعمل له بعد السحب.`)],components:withNavigation(rowsFromButtons([btn('perm:dm-trial-revoke-confirm','تأكيد الإزالة',ButtonStyle.Danger,'➖')]),'perm:dm-trial-home')});
}
async function dmTrialRevokeConfirm(i,a,s){
  assertOwnerForDmTrial(s,a);
  const d=a.drafts.get(`dm-trial:${s.userId}`);
  if(!d||d.action!=='revoke')throw new AppError('DRAFT_EXPIRED','انتهت جلسة إيقاف تجربة الخاص.');
  const removed=await a.permissions.revokeDirectUserPermission({guildId:s.guildId,userId:d.userId,permission:DM_TRIAL_PERMISSION});
  await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'dm_trial.revoke',targetType:'user',targetId:d.userId,oldValue:{permission:DM_TRIAL_PERMISSION,removed:removed.length}});
  a.drafts.delete(`dm-trial:${s.userId}`);
  return i.update({content:`✅ تم إيقاف وصول الخاص التجريبي عن <@${d.userId}>.`,embeds:[],components:withNavigation([],'perm:dm-trial-home')});
}

async function deliverySubject(i,a,s){const userId=i.values[0];a.drafts.set(`delivery:${s.userId}`,{userId});const teams=await a.teams.list(s.guildId);const comps=[stringSelect('perm:delivery-team','الفريق',teams.filter(t=>t.discord_role_id).map(t=>({label:t.name,value:t.id})))];if(await a.permissionService.hasPotential(s,'teams.manage'))comps.push(...rowsFromButtons([btn('team:delete-pick','حذف فريق',ButtonStyle.Danger,'🗑️')]));return i.update({content:'اختر الفريق. سيحصل الشخص على صلاحيات الوصول للمخرجات؛ التقرير والتسجيل يُنشران في قناة الفريق فقط ولا يُرسلان في الخاص:',components:withNavigation(comps,'admin:permissions')});}
async function deliveryTeam(i,a,s){a.rateLimiter.consume(`permissions:${s.userId}`,{limit:10,windowMs:60_000});const d=a.drafts.get(`delivery:${s.userId}`);if(!d)throw new AppError('DRAFT_EXPIRED','انتهت الجلسة.');const teamId=i.values[0];await Promise.all(['reports.receive','recordings.receive'].map(permission=>a.permissions.grantUser({guildId:s.guildId,userId:d.userId,permission,effect:'allow',scopeType:'team',scopeId:teamId,actorId:s.userId})));await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'delivery.recipient.grant',targetType:'user',targetId:d.userId,newValue:{teamId,permissions:['reports.receive','recordings.receive']}});const team=await a.teams.get(teamId).catch(()=>null);await notifyPermissionUser(i,a,s,d.userId,'📦 تم تعيينك لاستلام مخرجات فريق — Operations 967',`أصبحت من المستلمين المعتمدين لـ **التقارير والتسجيلات**${team?.name?` الخاصة بفريق **${team.name}**`:' لفريق محدد'} عند صدورها.`);a.drafts.delete(`delivery:${s.userId}`);return i.update({content:`✅ تم منح <@${d.userId}> صلاحيات الوصول لمخرجات هذا الفريق. الإرسال نفسه يبقى في قناة الفريق فقط.`,components:withNavigation([],'admin:permissions')});}

async function permissionMemberSearchSubmit(i,a,s,context){
  const query=i.fields.getTextInputValue('query').trim();setMemberSearch(a,s.userId,`perm:${context}`,query);return renderPermissionMemberContext(i,a,s,context,0);
}
async function permissionMemberSearchClear(i,a,s,context){
  clearMemberSearch(a,s.userId,`perm:${context}`);return renderPermissionMemberContext(i,a,s,context,0);
}
async function renderPermissionMemberContext(i,a,s,context,page=0){
  if(['grant','deny','revoke','delivery','inspect'].includes(context))return memberPicker(i,s,context,page,a);
  if(context==='super-grant')return superGrantPicker(i,a,s,page);
  if(context==='super-revoke')return superRevokePicker(i,a,s,page);
  if(context==='dm-grant')return dmTrialGrantPicker(i,a,s,page);
  if(context==='dm-revoke')return dmTrialRevokePicker(i,a,s,page);
  throw new AppError('INVALID_PICKER','سياق بحث الأعضاء غير صالح.');
}
