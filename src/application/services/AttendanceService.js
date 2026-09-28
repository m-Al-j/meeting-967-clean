import { withTransaction } from '../../infrastructure/db/pool.js';
import { deriveAttendance } from '../../core/attendance/state.js';
export class AttendanceService{
  constructor({attendance,excuses,audit}){this.attendance=attendance;this.excuses=excuses;this.audit=audit;}
  async joined(meeting,userId,at=new Date()){await this.attendance.openSession(meeting.id,userId,at);}
  async left(meeting,userId,at=new Date()){await this.attendance.closeSession(meeting.id,userId,at);}
  async finalize(meeting,settings,endedAt=new Date(),client=null){
    const run=async c=>{
      await this.attendance.closeAll(meeting.id,endedAt,c);
      const [rows,approvedResult]=await Promise.all([
        this.attendance.rows(meeting.id,c),
        c.query(`SELECT user_id FROM excuses WHERE meeting_id=$1 AND status='approved'`,[meeting.id])
      ]);
      const approved=new Set(approvedResult.rows.map(x=>String(x.user_id)));
      const duration=Math.max(1,Math.floor((endedAt-new Date(meeting.started_at??meeting.scheduled_at))/1000));
      const updates=[];
      for(const row of rows){
        const derived=deriveAttendance({excused:approved.has(String(row.user_id)),firstJoinAt:row.first_join_at,scheduledAt:meeting.scheduled_at,lateAfterMinutes:settings.late_after_minutes,totalSeconds:row.total_seconds,meetingDurationSeconds:duration});
        if(!row.manually_overridden)updates.push({user_id:String(row.user_id),status:derived.status,late_by_seconds:derived.lateBySeconds,presence_ratio:derived.presenceRatio,full_attendance:derived.fullAttendance});
      }
      if(this.attendance.setDerivedMany)await this.attendance.setDerivedMany(meeting.id,updates,c);
      else for(const x of updates)await this.attendance.setDerived(meeting.id,x.user_id,{status:x.status,lateBySeconds:x.late_by_seconds,presenceRatio:x.presence_ratio,fullAttendance:x.full_attendance},c);
      return this.attendance.rows(meeting.id,c);
    };
    return client?run(client):withTransaction(run);
  }
  async override({guildId,meetingId,userId,status,actorId,reason}){return withTransaction(async c=>{const result=await this.attendance.override({meetingId,userId,status,actorId,reason},c);await this.audit.log({guildId,actorId,action:'attendance.override',targetType:'attendance',targetId:`${meetingId}:${userId}`,oldValue:result.old,newValue:result.current,metadata:{reason}},c);return result.current;});}
}
