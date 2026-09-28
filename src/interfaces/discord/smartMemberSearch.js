const key=userId=>`smart-member-context:${userId}`;

export function setSmartMemberContext(a,userId,{customId,options,title='اختيار عضو',context='member-picker'}){
  const safe=(options??[]).filter(x=>x?.value).map(x=>({label:String(x.label??x.value).slice(0,100),description:String(x.description??'').slice(0,100),value:String(x.value)}));
  a.drafts.set(key(userId),{customId:String(customId),title:String(title).slice(0,100),context:String(context).slice(0,120),options:safe});
  return safe.length;
}
export function getSmartMemberContext(a,userId){return a.drafts.get(key(userId));}
export function clearSmartMemberContext(a,userId){a.drafts.delete(key(userId));}
export async function rankMemberOptionsForPicker(a,userId,options,query=''){
  const list=Array.isArray(options)?options:[];
  if(!list.length||!a?.memberSuggestionService)return list;
  try{return await a.memberSuggestionService.suggestions({guildId:a.env.GUILD_ID,actorUserId:userId,options:list,query,limit:list.length});}
  catch{return list;}
}
export function smartMemberHint(){return '\n🔎 **الاقتراحات حسب الاسم فقط:** اكتب الاسم أو اليوزر، حتى حرفًا واحدًا مثل `م`، وستُرتب النتائج حسب أقرب تطابق للاسم/اليوزر فقط — بدون سجل مراسلات أو اختيارات سابقة.';}
export function isTrackedMemberSelectionId(id=''){
  id=String(id);
  return id==='perm:subject:user'||id==='perm:revoke-subject:user'||id==='perm:delivery-subject'||id==='perm:super-grant-subject'||id==='perm:super-revoke-subject'||id==='perm:dm-trial-grant-subject'||id==='perm:dm-trial-revoke-subject'||id.startsWith('team:add-user:')||id.startsWith('team:remove-user:')||id.startsWith('team:move-user:')||id.startsWith('task:assign-submit:')||id.startsWith('attendance:edit:');
}
