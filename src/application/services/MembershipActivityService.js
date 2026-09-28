import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';

const DEFAULTS = Object.freeze({
  minimumAttendancePct: 40,
  minimumCompletedTasks: 3,
  minimumEvaluationDays: 7,
  primaryWeight: 0.70,
  supportWeight: 0.30,
});

const num = (v, fallback=0) => {
  const n=Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (v) => Math.round(num(v)*100)/100;

function weighted(primaryPct, supportPct, hasPrimary, hasSupport, primaryWeight, supportWeight){
  const parts=[];
  if(hasPrimary && primaryPct!=null) parts.push({value:num(primaryPct),weight:num(primaryWeight)});
  if(hasSupport && supportPct!=null) parts.push({value:num(supportPct),weight:num(supportWeight)});
  if(!parts.length) return null;
  const total=parts.reduce((s,x)=>s+x.weight,0);
  if(!total) return null;
  return parts.reduce((s,x)=>s+x.value*x.weight,0)/total;
}

function teamWeight(type, supportCount, primaryWeight, supportWeight){
  if(type==='primary') return num(primaryWeight,0.70);
  return num(supportWeight,0.30)/Math.max(1,Number(supportCount||1));
}

export { weighted as weightedSupportShare };

export class MembershipActivityService {
  constructor({db,audit,env,logger}){
    Object.assign(this,{db,audit,env,logger});
  }

  async timezone(guildId){
    try{
      const {rows}=await this.db.query('SELECT timezone FROM settings WHERE guild_id=$1',[guildId]);
      return rows[0]?.timezone || 'Asia/Aden';
    }catch{
      return 'Asia/Aden';
    }
  }

  async settings(guildId){
    await this.db.query(`
      INSERT INTO membership_activity_settings(guild_id)
      VALUES($1) ON CONFLICT(guild_id) DO NOTHING
    `,[guildId]);

    const {rows}=await this.db.query(`
      SELECT minimum_attendance_pct,minimum_completed_tasks,minimum_evaluation_days,
             primary_weight,support_weight,monthly_evaluation_enabled,notice_enabled
      FROM membership_activity_settings WHERE guild_id=$1
    `,[guildId]);

    const r=rows[0];
    if(!r) return {...DEFAULTS,monthlyEvaluationEnabled:true,noticeEnabled:true};

    return {
      minimumAttendancePct:num(r.minimum_attendance_pct,40),
      minimumCompletedTasks:Math.max(0,Math.trunc(num(r.minimum_completed_tasks,3))),
      minimumEvaluationDays:Math.max(0,Math.trunc(num(r.minimum_evaluation_days,7))),
      primaryWeight:num(r.primary_weight,.70),
      supportWeight:num(r.support_weight,.30),
      monthlyEvaluationEnabled:r.monthly_evaluation_enabled!==false,
      noticeEnabled:r.notice_enabled!==false,
    };
  }

  async ensureAssignments({guildId,userId,actorId=null}){
    const {rows:existing}=await this.db.query(`
      SELECT * FROM membership_team_assignments
      WHERE guild_id=$1 AND user_id=$2 AND active=true
      ORDER BY effective_from ASC,id ASC
    `,[guildId,userId]);

    const {rows:memberships}=await this.db.query(`
      SELECT tm.team_id,tm.joined_at
      FROM team_members tm
      JOIN teams t ON t.id=tm.team_id
      WHERE tm.guild_id=$1 AND tm.user_id=$2
        AND tm.active=true AND t.active=true AND t.deleted_at IS NULL
      ORDER BY tm.joined_at ASC,tm.team_id ASC
    `,[guildId,userId]);

    const keys=new Set(existing.map(x=>String(x.team_id)));
    const missing=memberships.filter(x=>!keys.has(String(x.team_id)));

    if(!missing.length) return existing;

    for(const [i,row] of memberships.entries()){
      if(keys.has(String(row.team_id))) continue;
      await this.db.query(`
        INSERT INTO membership_team_assignments
          (id,guild_id,user_id,team_id,assignment_type,effective_from,active,source,created_by)
        VALUES($1,$2,$3,$4,$5,$6,true,'service-inference',$7)
      `,[
        randomUUID(),guildId,userId,row.team_id,
        i===0?'primary':'support',row.joined_at,actorId
      ]);
    }

    const {rows:fresh}=await this.db.query(`
      SELECT * FROM membership_team_assignments
      WHERE guild_id=$1 AND user_id=$2 AND active=true
      ORDER BY effective_from ASC,id ASC
    `,[guildId,userId]);

    return fresh;
  }

  async setAssignment({guildId,userId,teamId,assignmentType,effectiveFrom=new Date(),actorId=null}){
    if(!['primary','support'].includes(assignmentType)) throw new Error('assignmentType must be primary or support');
    const at=new Date(effectiveFrom);
    if(Number.isNaN(at.getTime())) throw new Error('Invalid effectiveFrom');

    await this.db.query(`
      UPDATE membership_team_assignments
      SET active=false,
          effective_until=CASE
            WHEN effective_until IS NULL OR effective_until>$4 THEN $4
            ELSE effective_until
          END,
          updated_at=now()
      WHERE guild_id=$1 AND user_id=$2 AND team_id=$3
        AND active=true AND effective_from<$4
    `,[guildId,userId,teamId,at]);

    const {rows}=await this.db.query(`
      INSERT INTO membership_team_assignments
        (id,guild_id,user_id,team_id,assignment_type,effective_from,active,source,created_by)
      VALUES($1,$2,$3,$4,$5,$6,true,'admin',$7) RETURNING *
    `,[randomUUID(),guildId,userId,teamId,assignmentType,at,actorId]);

    await this.audit?.log?.({
      guildId,actorId,action:'membership.assignment.set',
      targetType:'member',targetId:String(userId),
      newValue:{teamId:String(teamId),assignmentType,effectiveFrom:at.toISOString()}
    }).catch(()=>{});

    return rows[0];
  }

  async memberBase({guildId,userId}){
    const {rows}=await this.db.query(`
      SELECT m.user_id,m.active,m.joined_at,
             COALESCE(u.display_name,u.username,m.user_id::text) display_name
      FROM members m LEFT JOIN users u ON u.id=m.user_id
      WHERE m.guild_id=$1 AND m.user_id=$2
    `,[guildId,userId]);
    return rows[0]??null;
  }

  async evaluateMember({guildId,userId,start,end,actorId=null}){
    const periodStart=new Date(start),periodEnd=new Date(end);
    if(Number.isNaN(periodStart.getTime())||Number.isNaN(periodEnd.getTime())||periodEnd<=periodStart)
      throw new Error('Invalid evaluation period');

    const member=await this.memberBase({guildId,userId});
    if(!member) return null;

    const settings=await this.settings(guildId);
    const assignments=await this.ensureAssignments({guildId,userId,actorId});
    if(!assignments.length){
      return this.persist({
        guildId,userId,periodStart,periodEnd,status:'insufficient_data',meetsMinimum:false,
        attendancePct:null,attended:0,eligible:0,completed:0,requiredTasks:0,eligibleDays:0,
        weightedAttendance:null,primaryAttendance:null,supportAttendance:null,
        metrics:{reason:'no-team-assignment',displayName:member.display_name}
      });
    }

    const memberStart=new Date(member.joined_at||periodStart);
    const effectiveBase=new Date(Math.max(periodStart.getTime(),memberStart.getTime()));
    const daysInPeriod=Math.max(1,Math.ceil((periodEnd-periodStart)/86400000));
    const eligibleDays=Math.max(
      0,
      Math.min(daysInPeriod,Math.ceil((periodEnd-effectiveBase)/86400000))
    );

    const requiredTasks=Math.min(
      settings.minimumCompletedTasks,
      Math.max(0,Math.ceil(settings.minimumCompletedTasks*(eligibleDays/daysInPeriod)))
    );

    const supports=assignments.filter(x=>x.assignment_type==='support');
    const supportCount=Math.max(1,supports.length);
    const teamResults=[];

    for(const assignment of assignments){
      const from=new Date(Math.max(
        periodStart.getTime(),
        effectiveBase.getTime(),
        new Date(assignment.effective_from).getTime()
      ));
      const until=new Date(Math.min(
        periodEnd.getTime(),
        assignment.effective_until?new Date(assignment.effective_until).getTime():periodEnd.getTime()
      ));
      if(until<=from) continue;

      const {rows:ar}=await this.db.query(`
        SELECT
          COUNT(*)::int eligible_meetings,
          COUNT(*) FILTER (
            WHERE COALESCE(a.status,'absent') IN ('present','late')
          )::int attended_meetings,
          COUNT(*) FILTER (
            WHERE COALESCE(a.status,'absent')='late'
          )::int late_meetings
        FROM meetings m
        JOIN meeting_member_snapshots s
          ON s.meeting_id=m.id AND s.user_id=$2
        LEFT JOIN attendance a
          ON a.meeting_id=m.id AND a.user_id=s.user_id
        WHERE m.guild_id=$1
          AND m.team_id=$3
          AND m.status='ended'
          AND COALESCE(m.ended_at,m.scheduled_at)>=$4
          AND COALESCE(m.ended_at,m.scheduled_at)<$5
          AND COALESCE(a.status,'absent')<>'excused'
      `,[guildId,userId,assignment.team_id,from,until]);

      const {rows:tr}=await this.db.query(`
        SELECT COUNT(*) FILTER (
          WHERE mt.review_status='approved'
        )::int completed_tasks,
        COUNT(*)::int tasks_seen
        FROM meeting_tasks mt
        WHERE mt.guild_id=$1
          AND mt.team_id=$2
          AND mt.assignee_user_id=$3
          AND mt.status<>'cancelled'
          AND COALESCE(mt.completed_at,mt.reviewed_at,mt.updated_at)>=$4
          AND COALESCE(mt.completed_at,mt.reviewed_at,mt.updated_at)<$5
      `,[guildId,assignment.team_id,userId,from,until]);

      const a=ar[0]||{},t=tr[0]||{};
      const eligible=Math.max(0,Number(a.eligible_meetings||0));
      const attended=Math.max(0,Number(a.attended_meetings||0));
      const attendancePct=eligible?(attended/eligible)*100:null;

      teamResults.push({
        teamId:String(assignment.team_id),
        assignmentType:assignment.assignment_type,
        weight:teamWeight(assignment.assignment_type,supportCount,settings.primaryWeight,settings.supportWeight),
        from:from.toISOString(),
        until:until.toISOString(),
        eligibleMeetings:eligible,
        attendedMeetings:attended,
        attendancePct:attendancePct==null?null:round2(attendancePct),
        lateMeetings:Number(a.late_meetings||0),
        completedTasks:Number(t.completed_tasks||0),
        tasksSeen:Number(t.tasks_seen||0),
      });
    }

    const primaryResult=teamResults.find(x=>x.assignmentType==='primary')||null;
    const supportResults=teamResults.filter(x=>x.assignmentType==='support');

    const supportAttendance=(()=>{
      const valid=supportResults.filter(x=>x.attendancePct!=null);
      if(!valid.length) return null;
      const weight=valid.reduce((s,x)=>s+x.weight,0);
      return weight?round2(valid.reduce((s,x)=>s+x.attendancePct*x.weight,0)/weight):null;
    })();

    const primaryAttendance=primaryResult?.attendancePct??null;
    const weightedAttendance=weighted(
      primaryAttendance,
      supportAttendance,
      primaryAttendance!=null,
      supportAttendance!=null,
      settings.primaryWeight,
      settings.supportWeight
    );

    const totalEligible=teamResults.reduce((s,x)=>s+x.eligibleMeetings,0);
    const totalAttended=teamResults.reduce((s,x)=>s+x.attendedMeetings,0);
    const completed=teamResults.reduce((s,x)=>s+x.completedTasks,0);
    const rawAttendance=totalEligible?(totalAttended/totalEligible)*100:null;

    const sufficientDays=eligibleDays>=settings.minimumEvaluationDays;
    const sufficientActivity=totalEligible>0||completed>0;
    const sufficient=sufficientDays&&sufficientActivity;

    const meets=Boolean(
      sufficient &&
      weightedAttendance!=null &&
      weightedAttendance>=settings.minimumAttendancePct &&
      completed>=requiredTasks
    );

    const status=!sufficient?'insufficient_data':meets?'meets_minimum':'needs_improvement';

    return this.persist({
      guildId,userId,periodStart,periodEnd,status,meetsMinimum:meets,
      attendancePct:rawAttendance==null?null:round2(rawAttendance),
      attended:totalAttended,eligible:totalEligible,completed,
      requiredTasks,eligibleDays,
      weightedAttendance:weightedAttendance==null?null:round2(weightedAttendance),
      primaryAttendance,supportAttendance,
      metrics:{
        displayName:member.display_name,
        rules:{
          minimumAttendancePct:settings.minimumAttendancePct,
          baseMinimumTasks:settings.minimumCompletedTasks,
          proratedTasks:true,
          minimumEvaluationDays:settings.minimumEvaluationDays,
          primaryWeight:settings.primaryWeight,
          supportWeight:settings.supportWeight,
          approvedExcusesExcluded:true,
          cancelledMeetingsExcluded:true,
          taskRequirementAppliesAcrossPrimaryAndSupport:true
        },
        eligibleDays,daysInPeriod,requiredTasks,
        totalEligibleMeetings:totalEligible,totalAttendedMeetings:totalAttended,
        rawAttendancePct:rawAttendance==null?null:round2(rawAttendance),
        completedTasks:completed,
        assignments:teamResults,
        fairness:{
          memberEligibilityStartsAt:effectiveBase.toISOString(),
          joinedMidPeriod:effectiveBase.getTime()>periodStart.getTime()
        }
      }
    });
  }

  async persist({guildId,userId,periodStart,periodEnd,status,meetsMinimum,attendancePct,
    attended,eligible,completed,requiredTasks,eligibleDays,weightedAttendance,
    primaryAttendance,supportAttendance,metrics}){
    const {rows}=await this.db.query(`
      INSERT INTO membership_activity_evaluations
        (id,guild_id,user_id,period_start,period_end,status,meets_minimum,
         attendance_pct,attended_meetings,eligible_meetings,completed_tasks,
         required_tasks,eligible_days,weighted_attendance_pct,
         primary_attendance_pct,support_attendance_pct,metrics,calculation_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
      ON CONFLICT(guild_id,user_id,period_start,period_end)
      DO UPDATE SET
        status=EXCLUDED.status,meets_minimum=EXCLUDED.meets_minimum,
        attendance_pct=EXCLUDED.attendance_pct,
        attended_meetings=EXCLUDED.attended_meetings,
        eligible_meetings=EXCLUDED.eligible_meetings,
        completed_tasks=EXCLUDED.completed_tasks,
        required_tasks=EXCLUDED.required_tasks,
        eligible_days=EXCLUDED.eligible_days,
        weighted_attendance_pct=EXCLUDED.weighted_attendance_pct,
        primary_attendance_pct=EXCLUDED.primary_attendance_pct,
        support_attendance_pct=EXCLUDED.support_attendance_pct,
        metrics=EXCLUDED.metrics,
        calculation_version=EXCLUDED.calculation_version,
        updated_at=now()
      RETURNING *
    `,[
      randomUUID(),guildId,userId,periodStart,periodEnd,status,meetsMinimum,
      attendancePct,attended,eligible,completed,requiredTasks,eligibleDays,
      weightedAttendance,primaryAttendance,supportAttendance,
      JSON.stringify(metrics||{}),'membership-activity-v1.0.1'
    ]);
    return rows[0]||null;
  }

  async evaluatePreviousMonth({guildId,actorId=null}){
    const zone=await this.timezone(guildId);
    const now=DateTime.now().setZone(zone);
    const start=now.startOf('month').minus({months:1});
    const end=now.startOf('month');
    const settings=await this.settings(guildId);

    if(!settings.monthlyEvaluationEnabled)
      return {enabled:false,evaluated:0,notices:0};

    const {rows}=await this.db.query(
      'SELECT user_id FROM members WHERE guild_id=$1 ORDER BY user_id',[guildId]
    );

    let evaluated=0,notices=0;
    for(const m of rows){
      const evaluation=await this.evaluateMember({
        guildId,userId:m.user_id,
        start:start.toUTC().toJSDate(),
        end:end.toUTC().toJSDate(),
        actorId
      });
      if(!evaluation) continue;
      evaluated++;
      if(evaluation.status==='needs_improvement' && settings.noticeEnabled){
        const result=await this.ensureNotice({
          evaluation,guildId,userId:m.user_id,
          displayName:evaluation.metrics?.displayName||String(m.user_id)
        });
        if(result.created) notices++;
      }
    }

    return {enabled:true,evaluated,notices,periodStart:start.toISO(),periodEnd:end.toISO()};
  }

  async ensureNotice({evaluation,guildId,userId,displayName}){
    const attendance=evaluation.weighted_attendance_pct??evaluation.attendance_pct;
    const tasks=evaluation.completed_tasks??0;
    const required=evaluation.required_tasks??3;

    const message=[
      `تنبيه متابعة العضوية — ${displayName}`,
      '',
      `خلال فترة التقييم الأخيرة بلغت نسبة الحضور المحتسبة ${attendance==null?'غير متاحة':`${attendance}%`} وتم اعتماد ${tasks} مهمة من أصل ${required} مهام مطلوبة.`,
      '',
      'يرجى رفع مستوى التفاعل خلال الفترة القادمة وإذا استمر هذا المستوى فقد تضطر إدارة الموارد البشرية إلى اتخاذ الإجراء المناسب وفق اللوائح التنظيمية.'
    ].join('\n');

    const {rows}=await this.db.query(`
      INSERT INTO membership_activity_notices
        (id,evaluation_id,guild_id,user_id,message)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(evaluation_id) DO NOTHING
      RETURNING *
    `,[randomUUID(),evaluation.id,guildId,userId,message]);

    return {created:Boolean(rows[0]),notice:rows[0]||null};
  }

  async pendingNotices(guildId,limit=100){
    const {rows}=await this.db.query(`
      SELECT n.*,e.period_start,e.period_end,
             COALESCE(u.display_name,u.username,n.user_id::text) display_name
      FROM membership_activity_notices n
      JOIN membership_activity_evaluations e ON e.id=n.evaluation_id
      LEFT JOIN users u ON u.id=n.user_id
      WHERE n.guild_id=$1 AND n.delivery_status='pending'
      ORDER BY n.created_at ASC LIMIT $2
    `,[guildId,limit]);
    return rows;
  }

  async markNotice(id,status){
    await this.db.query(`
      UPDATE membership_activity_notices
      SET delivery_status=$2,
          sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END
      WHERE id=$1
    `,[id,status]);
  }
}
