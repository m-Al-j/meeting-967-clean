import {ActionRowBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,ButtonStyle} from 'discord.js';
import {e,btn,rowsFromButtons,stringSelect,withNavigation,roleSelect,voiceSelect,textSelect} from '../ui.js';
import {guildMemberOptions,pickerMenuPage,pickerPageValue,pickerSearchValue} from '../guildPicker.js';
import {filterMemberOptions,getMemberSearch,setMemberSearch,clearMemberSearch,memberSearchModal,memberSearchRows,searchSummary} from '../memberSearch.js';
import {setSmartMemberContext,smartMemberHint,rankMemberOptionsForPicker} from '../smartMemberSearch.js';
import {subjectFromInteraction} from '../context.js';
const input=(id,label,style=TextInputStyle.Short,required=true)=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required));
export async function handleTeams(i,a){const id=i.customId??'';
  if(i.isAnySelectMenu?.()&&pickerSearchValue(i.values?.[0])){
    let mode=null,teamId=null;
    if(id.startsWith('team:add-user:')){mode='add';teamId=id.split(':')[2];}
    else if(id.startsWith('team:remove-user:')){mode='remove';teamId=id.split(':')[2];}
    else if(id.startsWith('team:move-user:')){mode='move';teamId=id.split(':')[2];}
    if(mode&&teamId){const current=getMemberSearch(a,i.user.id,`team:${mode}:${teamId}`);return i.showModal(memberSearchModal(`team:member-search-submit:${mode}:${teamId}`,current,'بحث في أعضاء الفريق'));}
  }
  if(id.startsWith('team:member-search:')){const parts=id.split(':');const mode=parts[2],teamId=parts[3];const current=getMemberSearch(a,i.user.id,`team:${mode}:${teamId}`);return i.showModal(memberSearchModal(`team:member-search-submit:${mode}:${teamId}`,current,'بحث في أعضاء الفريق'));}
  const s=await subjectFromInteraction(i,a.env);
  if(id.startsWith('team:member-search-submit:')){const parts=id.split(':');return teamMemberSearchSubmit(i,a,s,parts[2],parts[3]);}
  if(id.startsWith('team:member-search-clear:')){const parts=id.split(':');return teamMemberSearchClear(i,a,s,parts[2],parts[3]);}
  if(id==='admin:teams')return list(i,a,s);if(id==='team:create')return createModal(i,a,s);if(id==='team:create-submit')return createSubmit(i,a,s);if(id==='team:open')return open(i,a,s,i.values[0]);if(id.startsWith('team:view:'))return open(i,a,s,id.split(':')[2]);
  if(id.startsWith('team:add-page:'))return addSelect(i,a,s,id.split(':')[2],Number(id.split(':')[3]||0),true);if(id.startsWith('team:add:'))return addSelect(i,a,s,id.split(':')[2]);if(id.startsWith('team:add-user:')){const teamId=id.split(':')[2];const page=pickerPageValue(i.values?.[0]);if(page!==null)return addSelect(i,a,s,teamId,page,true);return addUser(i,a,s,teamId);}if(id.startsWith('team:remove-page:'))return removeSelect(i,a,s,id.split(':')[2],Number(id.split(':')[3]||0),true);if(id.startsWith('team:remove:'))return removeSelect(i,a,s,id.split(':')[2]);if(id.startsWith('team:remove-user:')){const teamId=id.split(':')[2];const page=pickerPageValue(i.values?.[0]);if(page!==null)return removeSelect(i,a,s,teamId,page,true);return removeUser(i,a,s,teamId);}
  if(id.startsWith('team:rename:'))return renameModal(i,a,s,id.split(':')[2]);if(id.startsWith('team:rename-submit:'))return renameSubmit(i,a,s,id.split(':')[3]);if(id.startsWith('team:disable:'))return disable(i,a,s,id.split(':')[2]);
  if(id.startsWith('team:move-page:'))return moveUserSelect(i,a,s,id.split(':')[2],Number(id.split(':')[3]||0),true);if(id.startsWith('team:move:'))return moveUserSelect(i,a,s,id.split(':')[2]);if(id.startsWith('team:move-user:')){const fromTeamId=id.split(':')[2];const page=pickerPageValue(i.values?.[0]);if(page!==null)return moveUserSelect(i,a,s,fromTeamId,page,true);return moveChooseDest(i,a,s,fromTeamId);}if(id==='team:move-dest')return moveSubmit(i,a,s);
  if(id.startsWith('team:link-role:'))return linkRole(i,a,s,id.split(':')[2]);if(id.startsWith('team:link-role-submit:'))return linkRoleSubmit(i,a,s,id.split(':')[3]);
  if(id.startsWith('team:link-voice:'))return linkVoice(i,a,s,id.split(':')[2]);if(id.startsWith('team:link-voice-submit:'))return linkVoiceSubmit(i,a,s,id.split(':')[3]);
  if(id.startsWith('team:link-text:'))return linkText(i,a,s,id.split(':')[2]);if(id.startsWith('team:link-text-submit:'))return linkTextSubmit(i,a,s,id.split(':')[3]);
  if(id.startsWith('team:sync-role:'))return syncRole(i,a,s,id.split(':')[2]);if(id.startsWith('team:unlink-role:'))return unlink(i,a,s,id.split(':')[2],'discord_role_id');if(id.startsWith('team:unlink-voice:'))return unlink(i,a,s,id.split(':')[2],'default_voice_channel_id');if(id.startsWith('team:unlink-text:'))return unlink(i,a,s,id.split(':')[2],'notification_channel_id');
  if(id==='team:delete-pick')return deletePick(i,a,s);if(id==='team:delete-select')return deleteConfirmScreen(i,a,s,i.values[0]);if(id.startsWith('team:delete-confirm-screen:'))return deleteConfirmScreen(i,a,s,id.split(':')[3]);if(id.startsWith('team:delete-confirm:'))return deleteConfirm(i,a,s,id.split(':')[3]);
  if(id==='member:team')return myTeam(i,a,s);return false;}
async function canAccessTeam(a,s,teamId){for(const p of ['teams.view','teams.manage','members.manage'])if(await a.permissionService.has(s,p,{teamId}))return true;return false;}
function splitMembers(members,max=900){const out=[];let cur='';for(const m of members){const token=`<@${m.user_id}>`;const next=cur?`${cur}، ${token}`:token;if(next.length>max){if(cur)out.push(cur);cur=token;}else cur=next;}if(cur)out.push(cur);return out.length?out:['لا يوجد أعضاء في رتبة الفريق.'];}
async function memberOptionsForRows(s,rows){const guildOptions=await guildMemberOptions(s.guild,{includeBots:false});const byId=new Map(guildOptions.map(x=>[String(x.value),x]));return rows.map(row=>byId.get(String(row.user_id))??{label:String(row.display_name??row.user_id).slice(0,100),description:'عضو في الفريق',value:String(row.user_id)});}
async function list(i,a,s){
  const potentials=await Promise.all(['teams.view','teams.manage','members.manage'].map(p=>a.permissionService.hasPotential(s,p)));
  if(!potentials.some(Boolean))throw new Error('ليس لديك صلاحية للوصول إلى الفرق.');
  const all=await a.teams.list(s.guildId,{activeOnly:true});
  const access=await Promise.all(all.map(async t=>t.discord_role_id&&await canAccessTeam(a,s,t.id)));
  const visible=all.filter((_,idx)=>access[idx]);
  if(!visible.length){const linkedCount=all.filter(t=>t.discord_role_id).length;const msg=linkedCount?'لا توجد فرق ضمن نطاق صلاحياتك.':'لا توجد فرق مستوردة من رتب Discord حتى الآن.';return i.update({embeds:[e('👥 الفرق والأعضاء',msg)],components:withNavigation([])});}

  const memberSets=await Promise.all(visible.map(t=>a.teams.members(t.id)));
  const embeds=[];let current=e('👥 الفرق والأعضاء','تُعرض هنا كل الفرق المسموح لك برؤيتها وكل أعضاء رتبها في Discord.\n**مفعّل** تعني أن الفريق مفعّل داخل النظام، وليست حالة Online؛ الأعداد تشمل المتصلين وغير المتصلين.');let fields=0,chars=220;
  for(let teamIndex=0;teamIndex<visible.length;teamIndex++){
    const t=visible[teamIndex];const members=memberSets[teamIndex];const chunks=splitMembers(members);
    for(let idx=0;idx<chunks.length;idx++){
      const name=idx===0?`${t.active?'✅':'⏸️'} ${t.name} — ${members.length} عضو`:`↳ ${t.name} (${idx+1})`;
      const prefix=idx===0?`${t.discord_role_id?`<@&${t.discord_role_id}>`:'رتبة غير مرتبطة'}${t.default_voice_channel_id?` • 🔊 <#${t.default_voice_channel_id}>`:''}\n`:'';
      const value=prefix+chunks[idx];
      if(fields>=24||chars+name.length+value.length>5200){embeds.push(current);current=e('👥 الفرق والأعضاء — متابعة','تكملة القائمة حسب نطاق صلاحياتك.');fields=0;chars=80;}
      current.addFields({name,value,inline:false});fields++;chars+=name.length+value.length;
    }
  }
  embeds.push(current);
  const components=[stringSelect('team:open','اختر فريقًا',visible.slice(0,25).map(t=>({label:String(t.name).slice(0,100),description:`${Number(t.member_count??0)} عضو`.slice(0,100),value:t.id})))];
  const deletable=[];for(const t of visible)if(await a.permissionService.has(s,'teams.manage',{teamId:t.id}))deletable.push(t);
  if(deletable.length)components.push(...rowsFromButtons([btn('team:delete-pick','حذف فريق',ButtonStyle.Danger,'🗑️')]));
  return i.update({embeds:embeds.slice(0,10),components:withNavigation(components)});
}
async function createModal(i,a,s){await a.permissionService.assert(s,'teams.manage');return i.showModal(new ModalBuilder().setCustomId('team:create-submit').setTitle('إنشاء فريق').addComponents(input('name','اسم الفريق'),input('description','الوصف',TextInputStyle.Paragraph,false)));}
async function createSubmit(i,a,s){await a.permissionService.assert(s,'teams.manage');const t=await a.teamService.create({guildId:s.guildId,name:i.fields.getTextInputValue('name'),description:i.fields.getTextInputValue('description'),actorId:s.userId});return i.reply({content:`✅ تم إنشاء فريق **${t.name}**.\nالخطوة التالية: اربطه برتبة Discord والقناة الصوتية من صفحة الفريق.`,components:withNavigation([],`team:view:${t.id}`),ephemeral:Boolean(i.guildId)});}
async function open(i,a,s,teamId){
  if(!await canAccessTeam(a,s,teamId))throw new Error('ليس لديك صلاحية لعرض هذا الفريق.');
  const [t,members]=await Promise.all([a.teams.get(teamId),a.teams.members(teamId)]);
  const links=`رتبة Discord: ${t.discord_role_id?`<@&${t.discord_role_id}>`:'غير مرتبطة'}\nقناة الاجتماع الافتراضية: ${t.default_voice_channel_id?`<#${t.default_voice_channel_id}>`:'غير محددة'}\nقناة تنبيهات الفريق: ${t.notification_channel_id?`<#${t.notification_channel_id}>`:'غير محددة'}`;
  const chunks=splitMembers(members,2800);const embeds=[e(`👥 ${t.name}`,`الحالة: ${t.active?'مفعّل':'معطّل'}\n${links}\n\n**كل أعضاء رتبة الفريق (${members.length}) — Online وOffline:**\n${chunks[0]}`)];
  for(let n=1;n<chunks.length&&embeds.length<10;n++)embeds.push(e(`👥 ${t.name} — متابعة الأعضاء`,chunks[n]));
  const buttons=[];
  // الفرق المرتبطة بـDiscord تُدار عضويتها تلقائيًا من الرتبة، لذلك لا نعرض إضافة/إزالة يدوية قد تمسحها المزامنة لاحقًا.
  const canManage=await a.permissionService.has(s,'teams.manage',{teamId});
  if(!t.discord_role_id&&canManage)buttons.push(btn(`team:link-role:${teamId}`,'ربط رتبة Discord',ButtonStyle.Secondary,'🎭'));
  if(canManage)buttons.push(btn(`team:delete-confirm-screen:${teamId}`,'حذف الفريق',ButtonStyle.Danger,'🗑️'));
  return i.update({embeds,components:withNavigation(rowsFromButtons(buttons),'admin:teams')});
}
async function addSelect(i,a,s,teamId,page=0,update=false){
  await a.permissionService.assert(s,'members.manage',{teamId});
  const existing=new Set((await a.teams.members(teamId)).map(m=>String(m.user_id)));const allOptions=(await guildMemberOptions(s.guild,{includeBots:false})).filter(x=>!existing.has(String(x.value)));
  setSmartMemberContext(a,s.userId,{customId:`team:add-user:${teamId}`,options:allOptions,title:'إضافة عضو للفريق',context:`team:add:${teamId}`});
  const context=`team:add:${teamId}`;const query=getMemberSearch(a,s.userId,context);const filteredOptions=filterMemberOptions(allOptions,query);const options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);const searchRows=memberSearchRows({openId:`team:member-search:add:${teamId}`,clearId:`team:member-search-clear:add:${teamId}`,query});
  if(!allOptions.length){const payload={content:'لا يوجد أعضاء آخرون متاحون للإضافة.',components:withNavigation([],`team:view:${teamId}`)};return update?i.update(payload):i.reply({...payload,ephemeral:Boolean(i.guildId)});}
  if(!options.length){const payload={content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,components:withNavigation(searchRows,`team:view:${teamId}`)};return update?i.update(payload):i.reply({...payload,ephemeral:Boolean(i.guildId)});}
  const p=pickerMenuPage(options,page);const comps=[...searchRows,stringSelect(`team:add-user:${teamId}`,`اختر عضوًا — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];const pager=[];
  if(p.page>0)pager.push(btn(`team:add-page:${teamId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`team:add-page:${teamId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)comps.push(...rowsFromButtons(pager));
  const payload={content:`اختر العضو لإضافته — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}\n🔎 يمكنك البحث بالاسم أو اليوزر.${smartMemberHint()}`,components:withNavigation(comps,`team:view:${teamId}`)};return update?i.update(payload):i.reply({...payload,ephemeral:Boolean(i.guildId)});
}

async function addUser(i,a,s,teamId){await a.permissionService.assert(s,'members.manage',{teamId});const user=s.guild.members.cache.get(String(i.values[0]))??await s.guild.members.fetch(i.values[0]);await a.teamService.addMember({guildId:s.guildId,teamId,user:{id:user.id,username:user.user.username,displayName:user.displayName},actorId:s.userId});return i.update({content:'✅ تمت إضافة العضو.',components:withNavigation([],`team:view:${teamId}`)});}
async function removeSelect(i,a,s,teamId,page=0,update=false){
  await a.permissionService.assert(s,'members.manage',{teamId});const members=await a.teams.members(teamId);if(!members.length){const payload={content:'الفريق بلا أعضاء.',components:withNavigation([],`team:view:${teamId}`)};return update?i.update(payload):i.reply({...payload,ephemeral:Boolean(i.guildId)});}
  const allOptions=await memberOptionsForRows(s,members);setSmartMemberContext(a,s.userId,{customId:`team:remove-user:${teamId}`,options:allOptions,title:'إزالة عضو من الفريق',context:`team:remove:${teamId}`});const context=`team:remove:${teamId}`;const query=getMemberSearch(a,s.userId,context);const filteredOptions=filterMemberOptions(allOptions,query);const options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);const searchRows=memberSearchRows({openId:`team:member-search:remove:${teamId}`,clearId:`team:member-search-clear:remove:${teamId}`,query});
  if(!options.length){const payload={content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,components:withNavigation(searchRows,`team:view:${teamId}`)};return update?i.update(payload):i.reply({...payload,ephemeral:Boolean(i.guildId)});}
  const p=pickerMenuPage(options,page);const comps=[...searchRows,stringSelect(`team:remove-user:${teamId}`,`عضو الفريق — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];const pager=[];if(p.page>0)pager.push(btn(`team:remove-page:${teamId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`team:remove-page:${teamId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)comps.push(...rowsFromButtons(pager));const payload={content:`اختر العضو — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}\n🔎 البحث يدعم الاسم واليوزر.${smartMemberHint()}`,components:withNavigation(comps,`team:view:${teamId}`)};return update?i.update(payload):i.reply({...payload,ephemeral:Boolean(i.guildId)});
}

async function removeUser(i,a,s,teamId){await a.permissionService.assert(s,'members.manage',{teamId});await a.teamService.removeMember({guildId:s.guildId,teamId,userId:i.values[0],actorId:s.userId});return i.update({content:'✅ تمت إزالة العضو.',components:withNavigation([],`team:view:${teamId}`)});}
async function renameModal(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});const t=await a.teams.get(teamId);const modal=new ModalBuilder().setCustomId(`team:rename-submit:${teamId}`).setTitle('تغيير اسم الفريق').addComponents(input('name','الاسم الجديد'));modal.components[0].components[0].setValue(t.name);return i.showModal(modal);}
async function renameSubmit(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});const old=await a.teams.get(teamId);const t=await a.teams.rename(teamId,i.fields.getTextInputValue('name'));await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'team.rename',targetType:'team',targetId:teamId,oldValue:{name:old.name},newValue:{name:t.name}});return i.reply({content:'✅ تم تغيير الاسم.',components:withNavigation([],`team:view:${teamId}`),ephemeral:Boolean(i.guildId)});}
async function disable(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});const old=await a.teams.get(teamId);const t=await a.teams.setActive(teamId,!old.active);await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'team.active.toggle',targetType:'team',targetId:teamId,oldValue:{active:old.active},newValue:{active:t.active}});return i.reply({content:`✅ الفريق الآن ${t.active?'نشط':'معطل'}.`,components:withNavigation([],`team:view:${teamId}`),ephemeral:Boolean(i.guildId)});}
async function moveUserSelect(i,a,s,fromTeamId,page=0,update=false){
  await a.permissionService.assert(s,'members.manage',{teamId:fromTeamId});const members=await a.teams.members(fromTeamId);if(!members.length){const payload={content:'لا يوجد أعضاء للنقل.',components:withNavigation([],`team:view:${fromTeamId}`)};return update?i.update(payload):i.reply({...payload,ephemeral:Boolean(i.guildId)});}
  const allOptions=await memberOptionsForRows(s,members);setSmartMemberContext(a,s.userId,{customId:`team:move-user:${fromTeamId}`,options:allOptions,title:'نقل عضو بين الفرق',context:`team:move:${fromTeamId}`});const context=`team:move:${fromTeamId}`;const query=getMemberSearch(a,s.userId,context);const filteredOptions=filterMemberOptions(allOptions,query);const options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);const searchRows=memberSearchRows({openId:`team:member-search:move:${fromTeamId}`,clearId:`team:member-search-clear:move:${fromTeamId}`,query});
  if(!options.length){const payload={content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,components:withNavigation(searchRows,`team:view:${fromTeamId}`)};return update?i.update(payload):i.reply({...payload,ephemeral:Boolean(i.guildId)});}
  const p=pickerMenuPage(options,page);const comps=[...searchRows,stringSelect(`team:move-user:${fromTeamId}`,`العضو — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];const pager=[];if(p.page>0)pager.push(btn(`team:move-page:${fromTeamId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`team:move-page:${fromTeamId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)comps.push(...rowsFromButtons(pager));const payload={content:`اختر العضو المراد نقله — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}\n🔎 يمكنك البحث بالاسم أو اليوزر.${smartMemberHint()}`,components:withNavigation(comps,`team:view:${fromTeamId}`)};return update?i.update(payload):i.reply({...payload,ephemeral:Boolean(i.guildId)});
}

async function moveChooseDest(i,a,s,fromTeamId){const userId=i.values[0];const teams=(await a.teams.list(s.guildId)).filter(t=>t.id!==fromTeamId);a.drafts.set(`team-move:${s.userId}`,{fromTeamId,userId});const comps=[stringSelect('team:move-dest','الفريق الجديد',teams.map(t=>({label:t.name,value:t.id})))];if(await a.permissionService.hasPotential(s,'teams.manage'))comps.push(...rowsFromButtons([btn('team:delete-pick','حذف فريق',ButtonStyle.Danger,'🗑️')]));return i.update({content:'اختر الفريق الجديد:',components:withNavigation(comps,`team:view:${fromTeamId}`)});}
async function moveSubmit(i,a,s){const d=a.drafts.get(`team-move:${s.userId}`);if(!d)return i.update({content:'انتهت جلسة النقل. ابدأ من جديد.',components:withNavigation([],'admin:teams')});await a.permissionService.assert(s,'members.manage',{teamId:d.fromTeamId});const member=s.guild.members.cache.get(String(d.userId))??await s.guild.members.fetch(d.userId);await a.teamService.moveMember({guildId:s.guildId,fromTeamId:d.fromTeamId,toTeamId:i.values[0],user:{id:member.id,username:member.user.username,displayName:member.displayName},actorId:s.userId});a.drafts.delete(`team-move:${s.userId}`);return i.update({content:'✅ تم نقل العضو.',components:withNavigation([],`team:view:${d.fromTeamId}`)});}
async function linkRole(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});return i.reply({content:'اختر رتبة Discord التي تمثل هذا الفريق. بعد الربط سيُزامن البوت أعضاء الرتبة مع الفريق.',components:withNavigation([roleSelect(`team:link-role-submit:${teamId}`)],`team:view:${teamId}`),ephemeral:Boolean(i.guildId)});}
async function linkRoleSubmit(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});const roleId=i.values[0];if(String(roleId)===String(s.guildId))throw new Error('لا يمكن ربط @everyone كفريق.');const old=await a.teams.get(teamId);await a.teams.updateDiscordLinks(teamId,{discord_role_id:roleId});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'team.discord_role.link',targetType:'team',targetId:teamId,oldValue:{discord_role_id:old.discord_role_id},newValue:{discord_role_id:roleId}});const out=await a.teamService.syncFromRole({guild:s.guild,teamId,actorId:s.userId});return i.update({content:`✅ تم ربط الرتبة <@&${roleId}> ومزامنة الأعضاء. أضيف ${out.added} وأزيل ${out.removed}.`,components:withNavigation([],`team:view:${teamId}`)});}
async function linkVoice(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});return i.reply({content:'اختر القناة الصوتية الافتراضية لاجتماعات هذا الفريق:',components:withNavigation([voiceSelect(`team:link-voice-submit:${teamId}`)],`team:view:${teamId}`),ephemeral:Boolean(i.guildId)});}
async function linkVoiceSubmit(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});const channelId=i.values[0];const old=await a.teams.get(teamId);await a.teams.updateDiscordLinks(teamId,{default_voice_channel_id:channelId});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'team.voice_channel.link',targetType:'team',targetId:teamId,oldValue:{default_voice_channel_id:old.default_voice_channel_id},newValue:{default_voice_channel_id:channelId}});return i.update({content:`✅ تم ربط قناة الاجتماع <#${channelId}>.`,components:withNavigation([],`team:view:${teamId}`)});}
async function linkText(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});return i.reply({content:'اختر قناة الفريق التي ستصلها تنبيهات إنشاء/بدء/إنهاء الاجتماعات:',components:withNavigation([textSelect(`team:link-text-submit:${teamId}`,'اختر قناة تنبيهات الفريق')],`team:view:${teamId}`),ephemeral:Boolean(i.guildId)});}
async function linkTextSubmit(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});const channelId=i.values[0];const old=await a.teams.get(teamId);await a.teams.updateDiscordLinks(teamId,{notification_channel_id:channelId});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'team.notification_channel.link',targetType:'team',targetId:teamId,oldValue:{notification_channel_id:old.notification_channel_id},newValue:{notification_channel_id:channelId}});return i.update({content:`✅ تم ربط قناة التنبيهات <#${channelId}>.`,components:withNavigation([],`team:view:${teamId}`)});}
async function syncRole(i,a,s,teamId){await a.permissionService.assert(s,'teams.manage',{teamId});await i.deferReply({ephemeral:Boolean(i.guildId)});const out=await a.teamService.syncFromRole({guild:s.guild,teamId,actorId:s.userId});return i.editReply({content:`✅ تمت مزامنة <@&${out.role.id}>: ${out.members} عضو، أضيف ${out.added}، أزيل ${out.removed}.`,components:withNavigation([],`team:view:${teamId}`)});}
async function unlink(i,a,s,teamId,field){await a.permissionService.assert(s,'teams.manage',{teamId});const old=await a.teams.get(teamId);await a.teams.updateDiscordLinks(teamId,{[field]:null});await a.audit.log({guildId:s.guildId,actorId:s.userId,action:'team.discord_link.unlink',targetType:'team',targetId:teamId,oldValue:{[field]:old[field]},newValue:{[field]:null}});return i.reply({content:'✅ تم فك الارتباط.',components:withNavigation([],`team:view:${teamId}`),ephemeral:Boolean(i.guildId)});}

async function deletePick(i,a,s){
  const teams=await a.teams.list(s.guildId,{activeOnly:true});const allowed=[];
  for(const t of teams)if(await a.permissionService.has(s,'teams.manage',{teamId:t.id}))allowed.push(t);
  if(!allowed.length)throw new Error('ليس لديك صلاحية حذف أي فريق.');
  return i.update({content:'اختر الفريق الذي تريد حذفه من Meeting 967:',embeds:[],components:withNavigation([stringSelect('team:delete-select','اختر فريقًا للحذف',allowed.slice(0,25).map(t=>({label:t.name.slice(0,100),description:t.discord_role_id?'مرتبط برتبة Discord — لن تُحذف الرتبة':'فريق داخلي',value:t.id})))],'admin:teams')});
}
async function deleteConfirmScreen(i,a,s,teamId){
  await a.permissionService.assert(s,'teams.manage',{teamId});const t=await a.teams.get(teamId);
  if(!t||t.deleted_at)throw new Error('الفريق غير موجود أو محذوف مسبقًا.');
  const warning=t.discord_role_id?'سيُحذف الفريق من Meeting 967 ويُستبعد من المزامنة التلقائية، لكن **رتبة Discord والقنوات لن تُحذف**.':'سيُحذف الفريق من قوائم Meeting 967 مع الإبقاء على سجلات الاجتماعات القديمة.';
  return i.update({content:`⚠️ هل تريد حذف فريق **${t.name}**؟\n${warning}`,embeds:[],components:withNavigation(rowsFromButtons([btn(`team:delete-confirm:${teamId}`,'نعم، احذف الفريق',ButtonStyle.Danger,'🗑️')]),'admin:teams')});
}
async function deleteConfirm(i,a,s,teamId){
  await a.permissionService.assert(s,'teams.manage',{teamId});const old=await a.teams.get(teamId);
  const out=await a.teamService.deleteTeam({guild:s.guild,teamId,actorId:s.userId});
  return i.update({content:`✅ تم حذف فريق **${old.name}** من Meeting 967.${out.roleId?'\n🚫 تم استبعاد رتبته من المزامنة التلقائية، لذلك لن يعود من نفسه.\nℹ️ لم يتم حذف رتبة Discord أو القنوات.':''}`,embeds:[],components:withNavigation([],'admin:teams')});
}
async function myTeam(i,a,s){const teams=await a.teams.teamsForUser(s.guildId,s.userId);return i.update({embeds:[e('👥 فريقي',teams.length?teams.map(t=>`• **${t.name}**${t.default_voice_channel_id?` — <#${t.default_voice_channel_id}>`:''}`).join('\n'):'أنت غير مربوط بأي فريق حاليًا.')],components:withNavigation([])});}

async function teamMemberSearchSubmit(i,a,s,mode,teamId){
  const query=i.fields.getTextInputValue('query').trim();setMemberSearch(a,s.userId,`team:${mode}:${teamId}`,query);return renderTeamMemberContext(i,a,s,mode,teamId,0,true);
}
async function teamMemberSearchClear(i,a,s,mode,teamId){
  clearMemberSearch(a,s.userId,`team:${mode}:${teamId}`);return renderTeamMemberContext(i,a,s,mode,teamId,0,true);
}
async function renderTeamMemberContext(i,a,s,mode,teamId,page=0,update=true){
  if(mode==='add')return addSelect(i,a,s,teamId,page,update);
  if(mode==='remove')return removeSelect(i,a,s,teamId,page,update);
  if(mode==='move')return moveUserSelect(i,a,s,teamId,page,update);
  throw new Error('سياق بحث الأعضاء غير صالح.');
}
