export class AuditRepository {
  constructor(db){this.db=db;}
  async log({guildId,actorId,action,targetType,targetId=null,oldValue=null,newValue=null,metadata={}},client=this.db){
    await client.query(`INSERT INTO audit_logs(guild_id,actor_id,action,target_type,target_id,old_value,new_value,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[guildId,actorId,action,targetType,targetId,oldValue,newValue,metadata]);
  }
  async latest(guildId,limit=20){const {rows}=await this.db.query('SELECT * FROM audit_logs WHERE guild_id=$1 ORDER BY created_at DESC LIMIT $2',[guildId,limit]);return rows;}
}
