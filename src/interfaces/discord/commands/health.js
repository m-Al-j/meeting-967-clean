import {AppError} from '../../../core/errors/AppError.js';
import {subjectFromInteraction} from '../context.js';

export async function healthCommand(interaction, app){
  const subject=await subjectFromInteraction(interaction,app.env);
  const allowed=app.permissionService.isOwner(subject.userId)||await app.permissionService.isSuperAdmin(subject);
  if(!allowed)throw new AppError('FORBIDDEN','فحص صحة النظام متاح للمالك أو Super Admin فقط.');

  const started=Date.now();
  const db=await app.db.query('SELECT now() AS now');
  await interaction.reply({content:`🟢 **Meeting 967 يعمل**\nDiscord: ${interaction.client.ws.ping}ms\nDB: ${Date.now()-started}ms\nالوقت: ${db.rows[0].now.toISOString()}`,ephemeral:Boolean(interaction.guildId)});
}
