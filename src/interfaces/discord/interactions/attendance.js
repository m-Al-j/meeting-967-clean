import {ButtonStyle} from 'discord.js';
import {e,btn,rowsFromButtons,stringSelect,withNavigation} from '../ui.js';
import {subjectFromInteraction} from '../context.js';
import {guildMemberOptions,pickerMenuPage,pickerPageValue,pickerSearchValue} from '../guildPicker.js';
import {filterMemberOptions,getMemberSearch,setMemberSearch,clearMemberSearch,memberSearchModal,memberSearchRows,searchSummary} from '../memberSearch.js';
import {setSmartMemberContext,smartMemberHint,rankMemberOptionsForPicker} from '../smartMemberSearch.js';

export async function handleAttendance(i,a){
  const id=i.customId??'';
  if(i.isAnySelectMenu?.()&&pickerSearchValue(i.values?.[0])&&id.startsWith('attendance:edit:')){const meetingId=id.split(':')[2];const current=getMemberSearch(a,i.user.id,`attendance:${meetingId}`);return i.showModal(memberSearchModal(`attendance:member-search-submit:${meetingId}`,current,'بحث في أعضاء الحضور'));}
  if(id.startsWith('attendance:member-search:')){
    const meetingId=id.split(':')[2];const current=getMemberSearch(a,i.user.id,`attendance:${meetingId}`);
    return i.showModal(memberSearchModal(`attendance:member-search-submit:${meetingId}`,current,'بحث في أعضاء الحضور'));
  }
  const s=await subjectFromInteraction(i,a.env);
  if(id.startsWith('attendance:member-search-submit:')){const meetingId=id.split(':')[2];setMemberSearch(a,s.userId,`attendance:${meetingId}`,i.fields.getTextInputValue('query').trim());return show(i,a,s,meetingId,0);}
  if(id.startsWith('attendance:member-search-clear:')){const meetingId=id.split(':')[2];clearMemberSearch(a,s.userId,`attendance:${meetingId}`);return show(i,a,s,meetingId,0);}
  if(id==='admin:attendance')return meetings(i,a,s);
  if(id==='attendance:meeting')return show(i,a,s,i.values[0],0);
  if(id.startsWith('attendance:view:'))return show(i,a,s,id.split(':')[2],0);
  if(id.startsWith('attendance:edit-page:'))return show(i,a,s,id.split(':')[2],Number(id.split(':')[3]||0));
  if(id.startsWith('attendance:edit:')){const meetingId=id.split(':')[2];const page=pickerPageValue(i.values?.[0]);if(page!==null)return show(i,a,s,meetingId,page);return statusPick(i,a,s,meetingId,i.values[0]);}
  if(id.startsWith('attendance:status:')){const parts=id.split(':');return override(i,a,s,parts[2],parts[3],i.values[0]);}
  return false;
}

async function meetings(i,a,s){
  await a.permissionService.assertPotential(s,'attendance.view');const ms=await a.meetings.listForGuild(s.guildId,{statuses:['ongoing','ended'],limit:25});const visible=[];
  for(const m of ms)if(await a.permissionService.has(s,'attendance.view',{teamId:m.team_id,meetingId:m.id}))visible.push(m);
  if(!visible.length)return i.update({embeds:[e('✅ الحضور','لا توجد اجتماعات متاحة.')],components:withNavigation([])});
  return i.update({embeds:[e('✅ الحضور','اختر اجتماعًا.')],components:withNavigation([stringSelect('attendance:meeting','الاجتماع',visible.map(m=>({label:m.name.slice(0,100),description:m.team_name.slice(0,100),value:m.id})))])});
}

async function show(i,a,s,meetingId,page=0){
  const m=await a.meetings.get(meetingId);await a.permissionService.assert(s,'attendance.view',{teamId:m.team_id,meetingId});const rows=await a.attendance.rows(meetingId);const ar={present:'حاضر',absent:'غائب',late:'متأخر',excused:'معتذر'};
  const text=rows.map(r=>`• <@${r.user_id}> — **${ar[r.status]}** — ${Math.round((r.total_seconds??0)/60)} د${r.manually_overridden?' ✏️':''}`).join('\n')||'لا توجد بيانات.';const comps=[];
  if(await a.permissionService.has(s,'attendance.edit',{teamId:m.team_id,meetingId})&&rows.length){
    const guildOptions=await guildMemberOptions(s.guild,{includeBots:false});const byId=new Map(guildOptions.map(x=>[String(x.value),x]));
    const allOptions=rows.map(r=>{const base=byId.get(String(r.user_id));return base?{...base,description:`${base.description??''} • ${ar[r.status]}`.slice(0,100)}:{label:r.display_name.slice(0,100),description:ar[r.status],value:String(r.user_id)};});
    setSmartMemberContext(a,s.userId,{customId:`attendance:edit:${meetingId}`,options:allOptions,title:'تعديل حضور عضو',context:`attendance:${meetingId}`});
    const context=`attendance:${meetingId}`;const query=getMemberSearch(a,s.userId,context);const filteredOptions=filterMemberOptions(allOptions,query);const options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);const searchRows=memberSearchRows({openId:`attendance:member-search:${meetingId}`,clearId:`attendance:member-search-clear:${meetingId}`,query});comps.push(...searchRows);
    if(options.length){const p=pickerMenuPage(options,page);comps.push(stringSelect(`attendance:edit:${meetingId}`,`تعديل عضو — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems));const pager=[];if(p.page>0)pager.push(btn(`attendance:edit-page:${meetingId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));if(p.page+1<p.pages)pager.push(btn(`attendance:edit-page:${meetingId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));if(pager.length)comps.push(...rowsFromButtons(pager));
      return i.update({content:`تعديل الحضور — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}${smartMemberHint()}`,embeds:[e(`الحضور — ${m.name}`,text.slice(0,3900))],components:withNavigation(comps,'admin:attendance')});}
    return i.update({content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,embeds:[e(`الحضور — ${m.name}`,text.slice(0,3900))],components:withNavigation(comps,'admin:attendance')});
  }
  return i.update({embeds:[e(`الحضور — ${m.name}`,text.slice(0,3900))],components:withNavigation(comps,'admin:attendance')});
}

async function statusPick(i,a,s,meetingId,userId){const m=await a.meetings.get(meetingId);await a.permissionService.assert(s,'attendance.edit',{teamId:m.team_id,meetingId});return i.update({content:`تعديل <@${userId}>:`,embeds:[],components:withNavigation([stringSelect(`attendance:status:${meetingId}:${userId}`,'الحالة الجديدة',[{label:'حاضر',value:'present'},{label:'غائب',value:'absent'},{label:'متأخر',value:'late'},{label:'معتذر',value:'excused'}])],`attendance:view:${meetingId}`)});}
async function override(i,a,s,meetingId,userId,status){const m=await a.meetings.get(meetingId);await a.permissionService.assert(s,'attendance.edit',{teamId:m.team_id,meetingId});await a.attendanceService.override({guildId:s.guildId,meetingId,userId,status,actorId:s.userId,reason:'تعديل من لوحة Discord'});return i.update({content:'✅ تم تعديل الحالة وتسجيل القيمة السابقة في Audit Log.',components:withNavigation([],`attendance:view:${meetingId}`)});}
