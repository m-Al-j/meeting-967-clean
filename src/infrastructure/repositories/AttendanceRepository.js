export class AttendanceRepository {
  constructor(db){this.db=db;}
  async openSession(meetingId,userId,joinedAt=new Date(),client=this.db){
    const open=await client.query('SELECT 1 FROM attendance_sessions WHERE meeting_id=$1 AND user_id=$2 AND left_at IS NULL',[meetingId,userId]);
    if(!open.rowCount) await client.query('INSERT INTO attendance_sessions(meeting_id,user_id,joined_at) VALUES($1,$2,$3)',[meetingId,userId,joinedAt]);
    await client.query(`UPDATE attendance SET first_join_at=COALESCE(first_join_at,$3),updated_at=now() WHERE meeting_id=$1 AND user_id=$2`,[meetingId,userId,joinedAt]);
  }
  async closeSession(meetingId,userId,leftAt=new Date(),client=this.db){
    await client.query(`UPDATE attendance_sessions SET left_at=$3,duration_seconds=GREATEST(0,EXTRACT(EPOCH FROM ($3-joined_at))::int)
      WHERE meeting_id=$1 AND user_id=$2 AND left_at IS NULL`,[meetingId,userId,leftAt]);
    await client.query(`UPDATE attendance SET last_leave_at=$3,total_seconds=COALESCE((SELECT SUM(duration_seconds) FROM attendance_sessions WHERE meeting_id=$1 AND user_id=$2),0),updated_at=now()
      WHERE meeting_id=$1 AND user_id=$2`,[meetingId,userId,leftAt]);
  }
  async closeAll(meetingId,leftAt=new Date(),client=this.db){
    await client.query(`UPDATE attendance_sessions
      SET left_at=$2,duration_seconds=GREATEST(0,EXTRACT(EPOCH FROM ($2-joined_at))::int)
      WHERE meeting_id=$1 AND left_at IS NULL`,[meetingId,leftAt]);
    await client.query(`UPDATE attendance a SET
      last_leave_at=COALESCE(a.last_leave_at,$2),
      total_seconds=COALESCE(s.total_seconds,0),updated_at=now()
      FROM (SELECT user_id,COALESCE(SUM(duration_seconds),0)::int total_seconds
            FROM attendance_sessions WHERE meeting_id=$1 GROUP BY user_id) s
      WHERE a.meeting_id=$1 AND a.user_id=s.user_id`,[meetingId,leftAt]);
  }
  async rows(meetingId,client=this.db){
    const {rows}=await client.query(`SELECT a.*,s.display_name FROM attendance a JOIN meeting_member_snapshots s ON s.meeting_id=a.meeting_id AND s.user_id=a.user_id WHERE a.meeting_id=$1 ORDER BY s.display_name`,[meetingId]); return rows;
  }
  async reportRows(meetingId,client=this.db){
    const {rows}=await client.query(`SELECT a.*,s.display_name,
      COALESCE((SELECT COUNT(*)::int FROM attendance_sessions x WHERE x.meeting_id=a.meeting_id AND x.user_id=a.user_id),0) AS join_count
      FROM attendance a JOIN meeting_member_snapshots s ON s.meeting_id=a.meeting_id AND s.user_id=a.user_id
      WHERE a.meeting_id=$1 ORDER BY s.display_name`,[meetingId]);
    return rows;
  }
  async setDerived(meetingId,userId,derived,client=this.db){
    await client.query(`UPDATE attendance SET status=$3,late_by_seconds=$4,presence_ratio=$5,full_attendance=$6,updated_at=now() WHERE meeting_id=$1 AND user_id=$2`,[meetingId,userId,derived.status,derived.lateBySeconds,derived.presenceRatio,derived.fullAttendance]);
  }
  async setDerivedMany(meetingId,updates,client=this.db){
    if(!updates?.length)return;
    await client.query(`UPDATE attendance a SET status=x.status,late_by_seconds=x.late_by_seconds,
      presence_ratio=x.presence_ratio,full_attendance=x.full_attendance,updated_at=now()
      FROM jsonb_to_recordset($2::jsonb) AS x(user_id bigint,status text,late_by_seconds int,presence_ratio numeric,full_attendance boolean)
      WHERE a.meeting_id=$1 AND a.user_id=x.user_id`,[meetingId,JSON.stringify(updates)]);
  }
  async override({meetingId,userId,status,actorId,reason},client=this.db){
    const {rows:oldRows}=await client.query('SELECT * FROM attendance WHERE meeting_id=$1 AND user_id=$2',[meetingId,userId]); const old=oldRows[0];
    const {rows}=await client.query(`UPDATE attendance SET original_status=COALESCE(original_status,status),status=$3,manually_overridden=true,overridden_by=$4,override_reason=$5,updated_at=now() WHERE meeting_id=$1 AND user_id=$2 RETURNING *`,[meetingId,userId,status,actorId,reason]);
    return {old,current:rows[0]};
  }
  async activeMeetingByChannel(guildId,channelId){ const {rows}=await this.db.query(`SELECT * FROM meetings WHERE guild_id=$1 AND voice_channel_id=$2 AND status='ongoing' ORDER BY started_at DESC LIMIT 1`,[guildId,channelId]); return rows[0]??null; }
}
