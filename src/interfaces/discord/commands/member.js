import {guildMemberOptions} from '../guildPicker.js';
import {getSmartMemberContext,clearSmartMemberContext} from '../smartMemberSearch.js';
import {resumeMemberSelection} from '../componentDispatcher.js';

const choiceName=option=>`${option.label}${option.description?`  ${option.description}`:''}`.slice(0,100);

export async function memberAutocomplete(i,a){
  try{
    if(!i.guildId){const allowed=await a.permissionService.canUseDm({guildId:a.env.GUILD_ID,userId:i.user.id});if(!allowed)return i.respond([]);}
    const pending=getSmartMemberContext(a,i.user.id);if(!pending?.options?.length)return i.respond([]);
    const focused=String(i.options.getFocused?.()??'');
    const ranked=await a.memberSuggestionService.suggestions({guildId:a.env.GUILD_ID,actorUserId:i.user.id,options:pending.options,query:focused,limit:25});
    return i.respond(ranked.map(option=>({name:choiceName(option),value:String(option.value)})));
  }catch(error){a.logger?.warn?.('member-autocomplete-failed',{error:error?.message??String(error),userId:i.user?.id});return i.respond([]).catch(()=>{});}
}

export async function memberCommand(i,a){
  const pending=getSmartMemberContext(a,i.user.id);
  if(!pending?.options?.length)return i.editReply({content:'افتح أولًا أي قائمة لاختيار عضو من `/panel`، وبعدها استخدم `/member` ليظهر البحث اللحظي في نفس القائمة.',components:[]});
  const raw=String(i.options.getString('name',true));
  let chosen=pending.options.find(x=>String(x.value)===raw);
  if(!chosen){
    const ranked=await a.memberSuggestionService.suggestions({guildId:a.env.GUILD_ID,actorUserId:i.user.id,options:pending.options,query:raw,limit:2});
    if(ranked.length===1)chosen=ranked[0];
  }
  if(!chosen)return i.editReply({content:'لم يتم اختيار عضو صالح من الاقتراحات. اكتب `/member` من جديد واختر الاسم من القائمة التي تظهر أثناء الكتابة.',components:[]});
  clearSmartMemberContext(a,i.user.id);
  await a.memberSuggestionService.recordSelection({guildId:a.env.GUILD_ID,actorUserId:i.user.id,targetUserId:chosen.value,context:pending.context});
  return resumeMemberSelection(i,a,{customId:pending.customId,userId:chosen.value});
}
