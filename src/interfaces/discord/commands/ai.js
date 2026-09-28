import {AppError} from '../../../core/errors/AppError.js';
import {subjectFromInteraction} from '../context.js';

async function getSubject(i,a){
  const s=await subjectFromInteraction(i,a.env);

  if(!s?.member){
    throw new AppError(
      'AI_MEMBER_ONLY',
      'مساعد AI 967 متاح لأعضاء السيرفر فقط.'
    );
  }

  if(!a.aiAgentService){
    throw new AppError(
      'AI_AGENT_MISSING',
      'خدمة AI Agent غير مفعّلة.'
    );
  }

  if(!a.aiChatRoomService){
    throw new AppError(
      'AI_CHAT_MISSING',
      'خدمة قناة AI 967 غير مفعّلة.'
    );
  }

  return s;
}

export async function aiCommand(i,a){
  const s=await getSubject(i,a);

  if(!i.guildId){
    throw new AppError(
      'AI_GUILD_ONLY',
      'افتح AI 967 من داخل السيرفر.'
    );
  }

  const question=i.options?.getString?.('question')?.trim()||null;

  // /ai بدون سؤال = فتح قناة AI 967 العامة فقط.
  if(!question){
    return a.aiChatRoomService.openFromCommand(i,s,null);
  }

  // /ai مع سؤال = معالجة السؤال فورًا بدل إظهار رسالة مضللة تطلب من العضو
  // كتابة السؤال مرة ثانية داخل القناة.
  const result=await a.aiAgentService.respond(s,question);

  if(result?.kind==='confirmation'){
    const row=a.aiChatRoomService._confirmButtons?.(result.token);
    const payload={
      content:[
        '🤖 **AI 967**',
        result.text,
        '',
        '**هل تريد تنفيذ العملية؟**',
      ].join('\n'),
      components:row??[],
      embeds:[],
    };
    if(i.deferred||i.replied)return i.editReply(payload);
    return i.reply({...payload,ephemeral:Boolean(i.guildId)});
  }

  const payload={
    content:[
      '🤖 **AI 967**',
      String(result?.text??'لم أحصل على إجابة واضحة.'),
    ].join('\n'),
    embeds:[],
  };

  if(i.deferred||i.replied)return i.editReply(payload);
  return i.reply({...payload,ephemeral:Boolean(i.guildId)});
}

export async function handleAIInteraction(i,a,s,id){
  const subject=s??await getSubject(i,a);

  if(id==='ai:open'){
    return a.aiChatRoomService.openFromInteraction(i,subject);
  }

  if(id==='ai:room:new'){
    await a.aiChatRoomService.reset(subject);
    return a.aiChatRoomService.openFromInteraction(i,subject);
  }

  if(id==='ai:room:context'){
    const text=await a.aiChatRoomService.contextText(subject);
    return i.reply({
      content:text,
      ephemeral:Boolean(i.guildId),
    });
  }

  if(id.startsWith('ai:confirm:')){
    const token=id.slice('ai:confirm:'.length);
    const result=await a.aiAgentService.confirm(subject,token);

    return i.update({
      content:`✅ **تم التنفيذ**\n${result.summary}`,
      components:[],
      embeds:[],
    });
  }

  if(id.startsWith('ai:reject:')){
    const token=id.slice('ai:reject:'.length);
    const pending=a.aiAgentService.getPending(subject,token);

    if(pending){
      a.aiAgentService.pending.delete(
        `${subject.guildId}:${subject.userId}:${token}`
      );
    }

    return i.update({
      content:'✖️ **تم إلغاء العملية**\nلم يتم تغيير أي بيانات.',
      components:[],
      embeds:[],
    });
  }

  return false;
}
