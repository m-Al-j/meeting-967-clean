import {randomUUID} from 'node:crypto';

export class SupportRepository{
  constructor(db){this.db=db;}
  async create({guildId,userId,kind,category='general',subject,description,context={}},client=this.db){
    const id=randomUUID();
    const {rows}=await client.query(`INSERT INTO support_requests(id,guild_id,user_id,kind,category,subject,description,context)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,[id,guildId,userId,kind,category,subject,description,JSON.stringify(context??{})]);
    return rows[0];
  }
  async get(id,client=this.db){
    const {rows}=await client.query(`SELECT sr.*,COALESCE(u.display_name,u.username,sr.user_id::text) AS requester_name,u.username AS requester_username
      FROM support_requests sr LEFT JOIN users u ON u.id=sr.user_id WHERE sr.id=$1`,[id]);
    return rows[0]??null;
  }
  async listForUser(guildId,userId,{limit=20}={},client=this.db){
    const {rows}=await client.query(`SELECT * FROM support_requests WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT $3`,[guildId,userId,limit]);
    return rows;
  }
  async listForGuild(guildId,{limit=50,statuses=null}={},client=this.db){
    const params=[guildId];let extra='';
    if(statuses?.length){params.push(statuses);extra=` AND sr.status=ANY($${params.length})`;}
    params.push(limit);
    const {rows}=await client.query(`SELECT sr.*,COALESCE(u.display_name,u.username,sr.user_id::text) AS requester_name,u.username AS requester_username
      FROM support_requests sr LEFT JOIN users u ON u.id=sr.user_id WHERE sr.guild_id=$1${extra}
      ORDER BY CASE sr.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END, sr.created_at DESC LIMIT $${params.length}`,params);
    return rows;
  }
  async updateStatus(id,status,{ownerNote=null}={},client=this.db){
    const resolved=['resolved','closed'].includes(status)?new Date():null;
    const {rows}=await client.query(`UPDATE support_requests SET status=$2,owner_note=COALESCE($3,owner_note),resolved_at=$4,updated_at=now() WHERE id=$1 RETURNING *`,[id,status,ownerNote,resolved]);
    return rows[0]??null;
  }
}
