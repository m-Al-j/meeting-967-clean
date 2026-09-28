export class OutputRepository {
  constructor(db){this.db=db;}

  async ensure(meetingId,client=this.db){
    const {rows}=await client.query(`INSERT INTO meeting_output_state(meeting_id) VALUES($1)
      ON CONFLICT(meeting_id) DO UPDATE SET updated_at=meeting_output_state.updated_at RETURNING *`,[meetingId]);
    return rows[0];
  }

  async get(meetingId,client=this.db){
    const {rows}=await client.query('SELECT * FROM meeting_output_state WHERE meeting_id=$1',[meetingId]);
    return rows[0]??null;
  }

  async patch(meetingId,patch,client=this.db){
    const allowed=new Set(['report_status','recording_status','delivery_status','attempts','last_attempt_at','next_retry_at','last_error','owner_alerted_at','completed_at']);
    const entries=Object.entries(patch).filter(([k])=>allowed.has(k));
    if(!entries.length)return this.ensure(meetingId,client);
    await this.ensure(meetingId,client);
    const vals=entries.map(([,v])=>v);
    const sets=entries.map(([k],idx)=>`${k}=$${idx+2}`).join(',');
    const {rows}=await client.query(`UPDATE meeting_output_state SET ${sets},updated_at=now() WHERE meeting_id=$1 RETURNING *`,[meetingId,...vals]);
    return rows[0];
  }

  async receipt(meetingId,userId,client=this.db){
    const {rows}=await client.query('SELECT * FROM meeting_delivery_receipts WHERE meeting_id=$1 AND user_id=$2',[meetingId,userId]);
    return rows[0]??null;
  }

  async markReceipt(meetingId,userId,patch={},client=this.db){
    const report=patch.reportSent?new Date():null;
    const recording=patch.recordingSent?new Date():null;
    const decisions=patch.decisionsSent?new Date():null;
    const files=Number(patch.recordingFilesSent||0);
    const error=patch.lastError??null;
    const {rows}=await client.query(`INSERT INTO meeting_delivery_receipts(meeting_id,user_id,report_sent_at,recording_sent_at,decisions_sent_at,recording_files_sent,attempts,last_error)
      VALUES($1,$2,$3,$4,$5,$6,1,$7)
      ON CONFLICT(meeting_id,user_id) DO UPDATE SET
        report_sent_at=COALESCE(meeting_delivery_receipts.report_sent_at,EXCLUDED.report_sent_at),
        recording_sent_at=COALESCE(meeting_delivery_receipts.recording_sent_at,EXCLUDED.recording_sent_at),
        decisions_sent_at=COALESCE(meeting_delivery_receipts.decisions_sent_at,EXCLUDED.decisions_sent_at),
        recording_files_sent=GREATEST(meeting_delivery_receipts.recording_files_sent,EXCLUDED.recording_files_sent),
        attempts=meeting_delivery_receipts.attempts+1,
        last_error=EXCLUDED.last_error,
        updated_at=now()
      RETURNING *`,[meetingId,userId,report,recording,decisions,files,error]);
    return rows[0];
  }

  async recentForGuild(guildId,{limit=15}={}){
    const {rows}=await this.db.query(`SELECT s.*,m.name AS meeting_name,m.team_id,t.name AS team_name,m.ended_at
      FROM meeting_output_state s JOIN meetings m ON m.id=s.meeting_id JOIN teams t ON t.id=m.team_id
      WHERE m.guild_id=$1 ORDER BY COALESCE(m.ended_at,m.updated_at) DESC LIMIT $2`,[guildId,limit]);
    return rows;
  }
}
