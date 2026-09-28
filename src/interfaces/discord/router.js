import { ZodError } from 'zod';
import { AppError } from '../../core/errors/AppError.js';
import { setupCommand } from './commands/setup.js';
import { panelCommand } from './commands/panel.js';
import { healthCommand } from './commands/health.js';
import { aiCommand } from './commands/ai.js';
import { dispatchComponentInteraction } from './componentDispatcher.js';
import { acknowledgeEarly,safeInteraction } from './interactionReliability.js';
import { handleOwnerAccessCenterInteraction } from './ownerAccessCenter.js';
import { handleOwnerMeetingCenterInteraction } from './ownerMeetingCenter.js';

const commands={setup:setupCommand,panel:panelCommand,health:healthCommand,ai:aiCommand};

export async function routeInteraction(rawInteraction,app){
  const started=Date.now();
  let interaction=rawInteraction;
  try{
    if(rawInteraction.guildId&&String(rawInteraction.guildId)!==String(app.env.GUILD_ID)){
      throw new AppError('WRONG_GUILD','هذا البوت مخصص لسيرفر 967 المعتمد.');
    }
    // لا توجد أوامر بحث منفصلة؛ اختيار الأعضاء يتم من اللوحات نفسها.
    if(rawInteraction.isAutocomplete?.())return await rawInteraction.respond([]);

    // Discord requires an acknowledgement in roughly three seconds. Acknowledge
    // immediately before any database/member/permission work. Modal-opening
    // controls are the only exception because showModal itself is the ACK.
    await acknowledgeEarly(rawInteraction);
    interaction=safeInteraction(rawInteraction);

    if(!interaction.guildId){
      // operations967-production-personal-dm-v1.10.7
      // production-dm:server-member-access
      const guildId=String(app.env.GUILD_ID??'').trim();
      const guild=guildId?(interaction.client.guilds.cache.get(guildId)??await interaction.client.guilds.fetch(guildId).catch(()=>null)):null;
      const member=guild?(guild.members.cache.get(String(interaction.user.id))??await guild.members.fetch(String(interaction.user.id)).catch(()=>null)):null;
      if(!member)throw new AppError('DM_PRIVATE','خاص Operations 967 متاح لأعضاء سيرفر 967 فقط.');
    }

    // Owner-only meeting center.
    if((interaction.isButton()||interaction.isAnySelectMenu()||interaction.isModalSubmit()) && await handleOwnerMeetingCenterInteraction(interaction,app)) return;

    // operations967-special-channel-access-v1.10.13.1
    if((interaction.isButton()||interaction.isAnySelectMenu()||interaction.isModalSubmit()) && await handleOwnerAccessCenterInteraction(interaction,app)) return;

    if(interaction.isChatInputCommand()){
      const fn=commands[interaction.commandName];
      if(fn)return await fn(interaction,app);
    }

    if(interaction.isButton()||interaction.isAnySelectMenu()||interaction.isModalSubmit()){
      const handled=await dispatchComponentInteraction(interaction,app);
      if(handled!==false)return handled;
    }

    if(!rawInteraction.replied&&!rawInteraction.deferred)await rawInteraction.reply({content:'هذا التفاعل غير معروف أو انتهت صلاحيته.',ephemeral:Boolean(rawInteraction.guildId)});
    else await rawInteraction.editReply({content:'هذا التفاعل غير معروف أو انتهت صلاحيته.',components:[]}).catch(()=>{});
  }catch(error){
    await respondError(rawInteraction,error,app);
  }finally{
    const duration=Date.now()-started;
    if(duration>1500)app.logger.warn('slow interaction',{durationMs:duration,customId:rawInteraction.customId,command:rawInteraction.commandName,userId:rawInteraction.user?.id,deferred:rawInteraction.deferred,replied:rawInteraction.replied});
  }
}

async function respondError(i,error,app){
  app.logger.error('interaction error',{error:error?.stack??String(error),customId:i.customId,command:i.commandName,userId:i.user?.id});
  let msg='حدث خطأ غير متوقع. تم تسجيله.';
  if(error instanceof AppError)msg=error.userMessage+(Array.isArray(error.details)&&error.details.length?`\n- ${error.details.join('\n- ')}`:'');
  else if(error instanceof ZodError)msg='البيانات غير صحيحة: '+error.issues.map(x=>x.message).join('، ');
  else if(error?.code==='23505')msg='هذه العملية موجودة مسبقًا ولا يمكن تكرارها.';
  else if(error?.code==='P0001'&&String(error?.message??'').includes('EXCUSE_WINDOW_CLOSED'))msg='انتهت مهلة تقديم الاعتذار لهذا الاجتماع.';
  else if(error?.message==='قيمة غير صالحة'||error?.message==='منطقة زمنية غير صالحة')msg=error.message;
  else if(error?.code==='42703')msg='قاعدة البيانات تحتاج Migration أحدث. شغّل npm run migrate ثم أعد المحاولة.';
  else if(error?.code==='50001'||error?.code==='50013')msg='البوت لا يملك صلاحية كافية لقراءة بعض بيانات السيرفر.';
  else if(error?.code==='GUILD_MEMBER_FETCH_FAILED')msg='تعذر جلب أعضاء السيرفر. تأكد من تفعيل Server Members Intent ثم أعد تشغيل البوت.';
  else if(error?.code==='GUILD_ROLE_FETCH_FAILED')msg='تعذر جلب رتب السيرفر من Discord.';
  else if(error?.code===10062||error?.code==='InteractionNotReplied')msg='انتهت مهلة تفاعل Discord. أعد المحاولة؛ تم تسجيل السبب التقني.';
  try{
    if(i.isAutocomplete?.())return await i.respond([]).catch(()=>{});
    if(i.deferred)return await i.editReply({content:`❌ ${msg}`,components:[]});
    if(i.replied)return await i.followUp({content:`❌ ${msg}`,ephemeral:Boolean(i.guildId)});
    return await i.reply({content:`❌ ${msg}`,ephemeral:Boolean(i.guildId)});
  }catch{}
}
