export class AutomationRepository{
  constructor(db){this.db=db;}
  async get(meetingId,client=this.db){const {rows}=await client.query('SELECT * FROM meeting_automation WHERE meeting_id=$1',[meetingId]);return rows[0]??null;}
  async ensure(meetingId,client=this.db){await client.query('INSERT INTO meeting_automation(meeting_id) VALUES($1) ON CONFLICT(meeting_id) DO NOTHING',[meetingId]);return this.get(meetingId,client);}
  async patch(meetingId,patch,client=this.db){
    await this.ensure(meetingId,client);
    const allowed=new Set(['readiness_checked_at','readiness_ok','readiness_issues','reminder_sent_at','start_attempted_at','start_attempts','start_error','had_human','empty_since','no_show_alert_sent_at','ended_automatically_at','last_recovery_at']);
    const entries=Object.entries(patch).filter(([k])=>allowed.has(k));
    if(!entries.length)return this.get(meetingId,client);
    const values=entries.map(([,v])=>v);
    const sets=entries.map(([k],idx)=>`${k}=$${idx+2}`).join(',');
    const {rows}=await client.query(`UPDATE meeting_automation SET ${sets},updated_at=now() WHERE meeting_id=$1 RETURNING *`,[meetingId,...values]);
    return rows[0]??null;
  }
}
