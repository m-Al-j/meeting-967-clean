import {z} from 'zod';
import {withTransaction} from '../../infrastructure/db/pool.js';
import {AppError} from '../../core/errors/AppError.js';

const kindSchema=z.enum(['problem','help']);
const statusSchema=z.enum(['open','in_progress','resolved','closed']);

export class SupportService{
  constructor({support,audit,logger,ownerUserId}){Object.assign(this,{support,audit,logger,ownerUserId});}
  async create({guildId,userId,kind,category='general',subject,description,context={},guild}){
    kind=kindSchema.parse(kind);
    subject=z.string().trim().min(2,'اكتب عنوانًا مختصرًا.').max(120).parse(subject);
    description=z.string().trim().min(5,'اشرح المشكلة أو المساعدة المطلوبة بشكل أوضح.').max(1800).parse(description);
    category=z.string().trim().max(60).parse(category||'general');
    const row=await withTransaction(async c=>{
      const created=await this.support.create({guildId,userId,kind,category,subject,description,context},c);
      await this.audit.log({guildId,actorId:userId,action:`support.${kind}.create`,targetType:'support_request',targetId:created.id,newValue:{kind,category,subject}},c);
      return created;
    });
    if(guild)await this.notifyOwner(row,guild).catch(error=>this.logger?.warn?.('support-owner-dm-failed',{requestId:row.id,error:error?.message??String(error)}));
    return row;
  }
  async notifyOwner(row,guild){
    const owner=await guild.client.users.fetch(String(this.ownerUserId));
    const type=row.kind==='problem'?'🚨 بلاغ مشكلة':'🆘 طلب مساعدة';
    const short=String(row.id).split('-')[0].toUpperCase();
    await owner.send(`${type} — **Meeting 967**\nرقم الطلب: **#${short}**\nمن: <@${row.user_id}>\nالعنوان: **${row.subject}**\n\n${row.description}\n\nافتح /panel ← مركز الدعم والبلاغات لمراجعة الطلب.`);
    return true;
  }
  async setStatus({requestId,status,ownerNote=null,actorId,guildId}){
    status=statusSchema.parse(status);
    if(String(actorId)!==String(this.ownerUserId))throw new AppError('OWNER_ONLY','إدارة طلبات الدعم متاحة للـOwner فقط.');
    const before=await this.support.get(requestId);if(!before||String(before.guild_id)!==String(guildId))throw new AppError('SUPPORT_NOT_FOUND','طلب الدعم غير موجود.');
    const row=await withTransaction(async c=>{
      const updated=await this.support.updateStatus(requestId,status,{ownerNote},c);
      await this.audit.log({guildId,actorId,action:'support.status',targetType:'support_request',targetId:requestId,oldValue:{status:before.status},newValue:{status}},c);
      return updated;
    });
    return row;
  }
}
