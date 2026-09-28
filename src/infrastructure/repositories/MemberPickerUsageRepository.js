export class MemberPickerUsageRepository {
  constructor(db){this.db=db;}

  async record({guildId,actorUserId,targetUserId,context=null}){
    await this.db.query(
      `INSERT INTO member_picker_usage(guild_id,actor_user_id,target_user_id,use_count,last_context,last_used_at)
       VALUES($1,$2,$3,1,$4,now())
       ON CONFLICT(guild_id,actor_user_id,target_user_id)
       DO UPDATE SET use_count=member_picker_usage.use_count+1,
                     last_context=EXCLUDED.last_context,
                     last_used_at=now()`,
      [guildId,actorUserId,targetUserId,context]
    );
  }

  async listForActor({guildId,actorUserId,targetUserIds=[]}){
    const ids=[...new Set((targetUserIds??[]).map(String).filter(Boolean))];
    const params=[guildId,actorUserId];
    let where='guild_id=$1 AND actor_user_id=$2';
    if(ids.length){params.push(ids);where+=' AND target_user_id = ANY($3::bigint[])';}
    const {rows}=await this.db.query(
      `SELECT target_user_id::text AS target_user_id,use_count,last_context,last_used_at
       FROM member_picker_usage
       WHERE ${where}
       ORDER BY last_used_at DESC
       LIMIT 500`,
      params
    );
    return rows;
  }
}
