import { e, btn, rowsFromButtons, textSelect } from '../ui.js';
import { ButtonStyle } from 'discord.js';
export async function setupCommand(interaction,app){
  if(String(interaction.user.id)!==String(app.env.OWNER_USER_ID))return interaction.reply({content:'⛔ أمر الإعداد متاح للـOwner فقط.',ephemeral:Boolean(interaction.guildId)});
  const guild=interaction.guild??await interaction.client.guilds.fetch(app.env.GUILD_ID);
  await app.guilds.ensure({guildId:guild.id,name:guild.name,ownerUserId:app.env.OWNER_USER_ID});await syncActor(interaction,app,guild);
  const s=await app.guilds.getSettings(guild.id);const teams=await app.teams.list(guild.id,{activeOnly:false});
  const embed=e('⚙️ إعداد Meeting 967',`تم ربط البوت بالسيرفر **${guild.name}**.\n\n**الفرق المستوردة:** ${teams.length}\nقناة التقارير: ${s.report_channel_id?`<#${s.report_channel_id}>`:'غير محددة'}\nقناة Audit: ${s.audit_channel_id?`<#${s.audit_channel_id}>`:'غير محددة'}\nالتسجيل: **تلقائي إلزامي**\nالبدء التلقائي للتسجيل: **مفعّل دائمًا**\n\n> 🔄 المزامنة مع رتب وقنوات وأعضاء Discord تعمل تلقائيًا عند تشغيل البوت وعند تغيّر بنية السيرفر.`);
  const buttons=rowsFromButtons([btn('admin:teams','عرض الفرق',ButtonStyle.Primary,'👥'),btn('setup:adminrole-picker','رتبة الإدارة',2,'🏷️'),btn('setup:done','إنهاء الإعداد',ButtonStyle.Success,'✅')]);
  await interaction.reply({embeds:[embed],components:[textSelect('setup:report','اختر قناة التقارير'),textSelect('setup:audit','اختر قناة Audit'),...buttons],ephemeral:Boolean(interaction.guildId)});
}
async function syncActor(interaction,app,guild){const m=interaction.member?.roles?.cache?interaction.member:await guild.members.fetch(interaction.user.id).catch(()=>null);await app.guilds.upsertUser({userId:interaction.user.id,username:interaction.user.username,displayName:m?.displayName??interaction.user.globalName??interaction.user.username});await app.guilds.ensureMember(guild.id,interaction.user.id);}
