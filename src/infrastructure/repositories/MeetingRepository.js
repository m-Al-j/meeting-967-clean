import { randomUUID } from 'node:crypto';
export class MeetingRepository {
  constructor(db) { this.db=db; }
  async create({ guildId, teamId, name, description, scheduledAt, voiceChannelId, actorId }, client=this.db) {
    const id=randomUUID();
    const {rows}=await client.query(`INSERT INTO meetings(id,guild_id,team_id,name,description,scheduled_at,original_scheduled_at,voice_channel_id,status,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$6,$7,'upcoming',$8,$8) RETURNING *`,[id,guildId,teamId,name,description,scheduledAt,voiceChannelId,actorId]);
    return rows[0];
  }
  async get(id, client=this.db) {
    const {rows}=await client.query(`SELECT m.*, t.name AS team_name FROM meetings m JOIN teams t ON t.id=m.team_id WHERE m.id=$1`,[id]); return rows[0]??null;
  }
  async lock(id,client=this.db){const {rows}=await client.query(`SELECT m.*,t.name AS team_name FROM meetings m JOIN teams t ON t.id=m.team_id WHERE m.id=$1 FOR UPDATE OF m`,[id]);return rows[0]??null;}
  async listForGuild(guildId,{statuses=null,limit=25,includeTest=false}={}) {
    const params=[guildId]; let where='m.guild_id=$1';
    // test-lab-v1.9.3:repo-list-filter
    if(!includeTest)where+=' AND COALESCE(m.is_test,false)=false';
    if(statuses?.length){params.push(statuses); where+=` AND m.status=ANY($${params.length})`;}
    params.push(limit);
    const {rows}=await this.db.query(`SELECT m.*,t.name AS team_name FROM meetings m JOIN teams t ON t.id=m.team_id WHERE ${where} ORDER BY m.scheduled_at DESC LIMIT $${params.length}`,params); return rows;
  }
  async listForUser(guildId,userId,{future=true,limit=20}={}) {
    const op=future?'>=':'<';
    const {rows}=await this.db.query(`SELECT DISTINCT m.*,t.name AS team_name FROM meetings m JOIN teams t ON t.id=m.team_id JOIN team_members tm ON tm.team_id=m.team_id
      WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND tm.user_id=$2 AND tm.active=true AND ${future ? "(m.status='ongoing' OR m.scheduled_at >= now())" : "(m.status<>'ongoing' AND m.scheduled_at < now())"} AND m.status <> 'canceled'
      ORDER BY m.scheduled_at ${future?'ASC':'DESC'} LIMIT $3`,[guildId,userId,limit]); return rows;
  }
  async update(id, patch, actorId, client=this.db) {
    const allowed=new Set(['name','description','scheduled_at','voice_channel_id','status','started_at','ended_at','canceled_at','postponed_at','cancel_reason','postpone_note','summary','start_mode','end_reason']);
    const entries=Object.entries(patch).filter(([k])=>allowed.has(k));
    if(!entries.length) return this.get(id,client);
    const sets=entries.map(([k],i)=>`${k}=$${i+2}`).join(', '); const values=entries.map(([,v])=>v);
    const {rows}=await client.query(`UPDATE meetings SET ${sets},updated_by=$${entries.length+2},updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,[id,...values,actorId]); return rows[0];
  }
  async snapshotMembers(meetingId, teamId, client=this.db) {
    await client.query(`INSERT INTO meeting_member_snapshots(meeting_id,user_id,display_name,team_id)
      SELECT $1,u.id,COALESCE(u.display_name,u.username,u.id::text),$2 FROM team_members tm JOIN users u ON u.id=tm.user_id
      WHERE tm.team_id=$2 AND tm.active=true ON CONFLICT(meeting_id,user_id) DO NOTHING`,[meetingId,teamId]);
    await client.query(`INSERT INTO attendance(meeting_id,user_id,status)
      SELECT meeting_id,user_id,'absent' FROM meeting_member_snapshots WHERE meeting_id=$1 ON CONFLICT DO NOTHING`,[meetingId]);
  }
  async ordinal(meetingId){
    const {rows}=await this.db.query(`SELECT COUNT(*)::int AS number FROM meetings x
      JOIN meetings target ON target.id=$1
      WHERE x.team_id=target.team_id AND COALESCE(x.is_test,false)=false AND (x.scheduled_at < target.scheduled_at OR (x.scheduled_at = target.scheduled_at AND x.created_at <= target.created_at))`,[meetingId]);
    return Math.max(1,Number(rows[0]?.number||1));
  }

  async ongoingByChannel(guildId,channelId,excludeMeetingId=null){
    const params=[guildId,channelId];let extra='';
    if(excludeMeetingId){params.push(excludeMeetingId);extra=' AND id<>$3';}
    const {rows}=await this.db.query(`SELECT * FROM meetings WHERE guild_id=$1 AND voice_channel_id=$2 AND status='ongoing'${extra} ORDER BY started_at DESC LIMIT 1`,params);
    return rows[0]??null;
  }

  async autopilotCandidates(guildId,{horizonMinutes=30,graceMinutes=10}={}){
    const {rows}=await this.db.query(`SELECT m.*,t.name AS team_name FROM meetings m JOIN teams t ON t.id=m.team_id
      WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND m.status IN ('upcoming','postponed')
        AND m.scheduled_at <= now() + ($2::int * interval '1 minute')
        AND m.scheduled_at >= now() - ($3::int * interval '1 minute')
      ORDER BY m.scheduled_at ASC`,[guildId,horizonMinutes,graceMinutes]);return rows;
  }
  async ongoingForGuild(guildId){const {rows}=await this.db.query(`SELECT m.*,t.name AS team_name FROM meetings m JOIN teams t ON t.id=m.team_id WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND m.status='ongoing' ORDER BY m.started_at`,[guildId]);return rows;}
  async outputCandidates(guildId,{hours=168,limit=25}={}){const {rows}=await this.db.query(`SELECT m.*,t.name AS team_name FROM meetings m JOIN teams t ON t.id=m.team_id LEFT JOIN meeting_output_state s ON s.meeting_id=m.id WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND m.status='ended' AND m.ended_at IS NOT NULL AND m.ended_at >= now()-($2::int * interval '1 hour') AND (s.completed_at IS NULL OR s.report_status<>'ready' OR s.delivery_status<>'sent') ORDER BY m.ended_at ASC LIMIT $3`,[guildId,hours,limit]);return rows;}
  async decisions(meetingId){ const {rows}=await this.db.query(`SELECT d.*,COALESCE(u.display_name,u.username,d.owner_user_id::text) AS owner_name FROM meeting_decisions d LEFT JOIN users u ON u.id=d.owner_user_id WHERE d.meeting_id=$1 ORDER BY d.created_at`,[meetingId]); return rows; }
  async listDecisionsForGuild(guildId,{limit=30}={}){const {rows}=await this.db.query(`SELECT d.*,m.name AS meeting_name,m.team_id,t.name AS team_name FROM meeting_decisions d JOIN meetings m ON m.id=d.meeting_id JOIN teams t ON t.id=m.team_id WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND t.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT $2`,[guildId,limit]);return rows;}
  async recentDecisionsForTeam(teamId,{excludeMeetingId=null,limit=5}={}){const p=[teamId];let extra='';if(excludeMeetingId){p.push(excludeMeetingId);extra=` AND m.id<>$${p.length}`;}p.push(limit);const {rows}=await this.db.query(`SELECT d.*,m.name AS meeting_name,m.scheduled_at FROM meeting_decisions d JOIN meetings m ON m.id=d.meeting_id WHERE m.team_id=$1 AND COALESCE(m.is_test,false)=false${extra} ORDER BY d.created_at DESC LIMIT $${p.length}`,p);return rows;}
  async addDecision(meetingId,text,actorId,client=this.db){ const {randomUUID}=await import('node:crypto'); const id=randomUUID(); const {rows}=await client.query('INSERT INTO meeting_decisions(id,meeting_id,decision_text,created_by) VALUES($1,$2,$3,$4) RETURNING *',[id,meetingId,text,actorId]); return rows[0]; }
  async search(guildId,{query='',teamId=null,status=null,memberId=null,dateFrom=null,dateTo=null,limit=25}={}){
    const p=[guildId]; const wh=['m.guild_id=$1','COALESCE(m.is_test,false)=false'];
    if(query){p.push(`%${query}%`); wh.push(`(m.name ILIKE $${p.length} OR COALESCE(m.description,'') ILIKE $${p.length} OR t.name ILIKE $${p.length})`);}
    if(teamId){p.push(teamId); wh.push(`m.team_id=$${p.length}`);} if(status){p.push(status); wh.push(`m.status=$${p.length}`);}
    if(memberId){p.push(memberId); wh.push(`EXISTS(SELECT 1 FROM meeting_member_snapshots s WHERE s.meeting_id=m.id AND s.user_id=$${p.length})`);}
    if(dateFrom){p.push(dateFrom); wh.push(`m.scheduled_at >= $${p.length}`);} if(dateTo){p.push(dateTo); wh.push(`m.scheduled_at <= $${p.length}`);}
    p.push(limit); const {rows}=await this.db.query(`SELECT m.*,t.name team_name FROM meetings m JOIN teams t ON t.id=m.team_id WHERE ${wh.join(' AND ')} ORDER BY m.scheduled_at DESC LIMIT $${p.length}`,p); return rows;
  }
}
