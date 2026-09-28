import {randomUUID} from 'node:crypto';
export class ExcuseRepository {
  constructor(db){this.db=db;}
  async submit({meetingId,userId,reason},client=this.db){const id=randomUUID(); const {rows}=await client.query(`INSERT INTO excuses(id,meeting_id,user_id,reason) VALUES($1,$2,$3,$4) RETURNING *`,[id,meetingId,userId,reason]); return rows[0];}
  async get(id){const {rows}=await this.db.query(`SELECT e.*,m.team_id,m.name meeting_name,m.scheduled_at,t.name team_name,COALESCE(u.display_name,u.username,u.id::text) member_name FROM excuses e JOIN meetings m ON m.id=e.meeting_id JOIN teams t ON t.id=m.team_id JOIN users u ON u.id=e.user_id WHERE e.id=$1`,[id]); return rows[0]??null;}
  async listPending(guildId,limit=25){const {rows}=await this.db.query(`SELECT e.*,m.team_id,m.name meeting_name,m.scheduled_at,t.name team_name,COALESCE(u.display_name,u.username,u.id::text) member_name FROM excuses e JOIN meetings m ON m.id=e.meeting_id JOIN teams t ON t.id=m.team_id JOIN users u ON u.id=e.user_id WHERE m.guild_id=$1 AND e.status='pending' ORDER BY e.submitted_at LIMIT $2`,[guildId,limit]);return rows;}
  async listForUser(guildId,userId,limit=20){const {rows}=await this.db.query(`SELECT e.*,m.name meeting_name,m.scheduled_at,t.name team_name FROM excuses e JOIN meetings m ON m.id=e.meeting_id JOIN teams t ON t.id=m.team_id WHERE m.guild_id=$1 AND e.user_id=$2 ORDER BY e.submitted_at DESC LIMIT $3`,[guildId,userId,limit]);return rows;}
  async approvedForMeeting(meetingId){
    const {rows}=await this.db.query(`SELECT e.*,COALESCE(u.display_name,u.username,u.id::text) member_name
      FROM excuses e JOIN users u ON u.id=e.user_id
      WHERE e.meeting_id=$1 AND e.status='approved' ORDER BY e.submitted_at`,[meetingId]);
    return rows;
  }
  async decide({id,status,actorId,note},client=this.db){const {rows}=await client.query(`UPDATE excuses SET status=$2,decided_by=$3,decided_at=now(),decision_note=$4 WHERE id=$1 RETURNING *`,[id,status,actorId,note]);return rows[0];}
}
