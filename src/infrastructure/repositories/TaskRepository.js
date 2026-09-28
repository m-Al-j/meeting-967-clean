import {randomUUID} from 'node:crypto';

export class TaskRepository{
  constructor(db){this.db=db;}

  async create({guildId,teamId,meetingId=null,decisionId=null,title,description='',assigneeUserId,dueAt=null,actorId,assignmentGroupId=null},client=this.db){
    const id=randomUUID();
    const {rows}=await client.query(`INSERT INTO meeting_tasks(id,guild_id,team_id,meeting_id,decision_id,title,description,assignee_user_id,due_at,created_by,assignment_group_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[id,guildId,teamId,meetingId,decisionId,title,description,assigneeUserId,dueAt,actorId,assignmentGroupId]);
    return rows[0];
  }

  async createGroup({guildId,meetingId,originTeamId,targetTeamId,assignmentMode,title,description='',dueAt=null,actorId,voiceChannelId},client=this.db){
    const id=randomUUID();
    const {rows}=await client.query(`INSERT INTO task_assignment_groups(
      id,guild_id,meeting_id,origin_team_id,target_team_id,assignment_mode,title,description,due_at,created_by,voice_channel_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[
      id,guildId,meetingId,originTeamId,targetTeamId,assignmentMode,title,description,dueAt,actorId,voiceChannelId
    ]);
    return rows[0];
  }

  async getGroup(id,client=this.db){
    const {rows}=await client.query(`SELECT g.*,ot.name AS origin_team_name,tt.name AS target_team_name,m.name AS meeting_name,m.status AS meeting_status
      FROM task_assignment_groups g
      JOIN teams ot ON ot.id=g.origin_team_id
      JOIN teams tt ON tt.id=g.target_team_id
      LEFT JOIN meetings m ON m.id=g.meeting_id
      WHERE g.id=$1`,[id]);
    return rows[0]??null;
  }

  async listGroupsForMeeting(meetingId,client=this.db){
    const {rows}=await client.query(`SELECT g.*,tt.name AS target_team_name
      FROM task_assignment_groups g
      JOIN teams tt ON tt.id=g.target_team_id
      WHERE g.meeting_id=$1
      ORDER BY g.created_at`,[meetingId]);
    return rows;
  }

  async listGroupTasks(groupId,client=this.db){
    const {rows}=await client.query(`SELECT mt.*,COALESCE(u.display_name,u.username,mt.assignee_user_id::text) AS assignee_name,
      t.name AS team_name,m.name AS meeting_name,m.team_id AS meeting_team_id
      FROM meeting_tasks mt
      JOIN teams t ON t.id=mt.team_id
      LEFT JOIN meetings m ON m.id=mt.meeting_id
      LEFT JOIN users u ON u.id=mt.assignee_user_id
      WHERE mt.assignment_group_id=$1
      ORDER BY COALESCE(u.display_name,u.username,mt.assignee_user_id::text),mt.created_at`,[groupId]);
    return rows;
  }

  async updateGroupMessages(groupId,patch,client=this.db){
    const allowed=new Set(['voice_message_id','team_channel_id','team_message_id']);
    const entries=Object.entries(patch).filter(([k,v])=>allowed.has(k)&&v!==undefined);
    if(!entries.length)return this.getGroup(groupId,client);
    const values=entries.map(([,v])=>v);
    const sets=entries.map(([k],idx)=>`${k}=$${idx+2}`).join(',');
    const {rows}=await client.query(`UPDATE task_assignment_groups SET ${sets},updated_at=now() WHERE id=$1 RETURNING *`,[groupId,...values]);
    return rows[0]??null;
  }

  async getBoard(meetingId,client=this.db){
    const {rows}=await client.query('SELECT * FROM meeting_task_boards WHERE meeting_id=$1',[meetingId]);
    return rows[0]??null;
  }

  async upsertBoard({meetingId,guildId,voiceChannelId,messageId=null},client=this.db){
    const {rows}=await client.query(`INSERT INTO meeting_task_boards(meeting_id,guild_id,voice_channel_id,message_id)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(meeting_id) DO UPDATE SET guild_id=EXCLUDED.guild_id,voice_channel_id=EXCLUDED.voice_channel_id,
        message_id=COALESCE(EXCLUDED.message_id,meeting_task_boards.message_id),updated_at=now()
      RETURNING *`,[meetingId,guildId,voiceChannelId,messageId]);
    return rows[0];
  }

  async setBoardMessage(meetingId,messageId,client=this.db){
    const {rows}=await client.query('UPDATE meeting_task_boards SET message_id=$2,updated_at=now() WHERE meeting_id=$1 RETURNING *',[meetingId,messageId]);
    return rows[0]??null;
  }

  async finalizeBoard(meetingId,client=this.db){
    const {rows}=await client.query('UPDATE meeting_task_boards SET finalized_at=COALESCE(finalized_at,now()),updated_at=now() WHERE meeting_id=$1 RETURNING *',[meetingId]);
    return rows[0]??null;
  }

  async get(id,client=this.db){
    const {rows}=await client.query(`SELECT mt.*,t.name AS team_name,m.name AS meeting_name,m.team_id AS meeting_team_id,
      COALESCE(u.display_name,u.username,mt.assignee_user_id::text) AS assignee_name,
      g.assignment_mode,g.target_team_id,g.origin_team_id,g.title AS group_title,g.voice_message_id,g.team_message_id,
      (SELECT ts.id FROM task_submissions ts WHERE ts.task_id=mt.id ORDER BY ts.submitted_at DESC LIMIT 1) AS latest_submission_id
      FROM meeting_tasks mt
      JOIN teams t ON t.id=mt.team_id
      LEFT JOIN meetings m ON m.id=mt.meeting_id
      LEFT JOIN users u ON u.id=mt.assignee_user_id
      LEFT JOIN task_assignment_groups g ON g.id=mt.assignment_group_id
      WHERE mt.id=$1`,[id]);
    return rows[0]??null;
  }

  async latestSubmission(taskId,client=this.db){const {rows}=await client.query('SELECT * FROM task_submissions WHERE task_id=$1 ORDER BY submitted_at DESC LIMIT 1',[taskId]);return rows[0]??null;}

  async addSubmission({taskId,submitterUserId,note='',attachments=[]},client=this.db){
    const id=randomUUID();
    const {rows}=await client.query(`INSERT INTO task_submissions(id,task_id,submitter_user_id,note,attachments) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *`,[id,taskId,submitterUserId,note,JSON.stringify(attachments)]);
    await client.query(`UPDATE meeting_tasks SET review_status='submitted',submitted_at=now(),reviewed_at=NULL,reviewed_by=NULL,review_note=NULL,status=CASE WHEN status='pending' THEN 'in_progress' ELSE status END,updated_at=now() WHERE id=$1`,[taskId]);
    return rows[0];
  }

  async review(id,{approved,reviewerUserId,note=''},client=this.db){
    const {rows}=await client.query(`UPDATE meeting_tasks SET review_status=$2,reviewed_at=now(),reviewed_by=$3,review_note=$4,status=$5,completed_at=$6,updated_at=now() WHERE id=$1 RETURNING *`,
      [id,approved?'approved':'rejected',reviewerUserId,note,approved?'done':'in_progress',approved?new Date():null]);return rows[0]??null;
  }

  async listForMeeting(meetingId,client=this.db){
    const {rows}=await client.query(`SELECT mt.*,COALESCE(u.display_name,u.username,mt.assignee_user_id::text) AS assignee_name,
      g.assignment_mode,g.target_team_id,tt.name AS assignment_target_team_name,g.origin_team_id
      FROM meeting_tasks mt
      LEFT JOIN users u ON u.id=mt.assignee_user_id
      LEFT JOIN task_assignment_groups g ON g.id=mt.assignment_group_id
      LEFT JOIN teams tt ON tt.id=g.target_team_id
      WHERE mt.meeting_id=$1 ORDER BY COALESCE(g.created_at,mt.created_at),mt.created_at`,[meetingId]);
    return rows;
  }

  async listForUser(guildId,userId,{limit=25,activeOnly=false}={},client=this.db){const p=[guildId,userId];let extra='';if(activeOnly)extra=" AND mt.status IN ('pending','in_progress')";p.push(limit);const {rows}=await client.query(`SELECT mt.*,t.name AS team_name,m.name AS meeting_name FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id LEFT JOIN meetings m ON m.id=mt.meeting_id WHERE mt.guild_id=$1 AND mt.assignee_user_id=$2 AND t.deleted_at IS NULL${extra} ORDER BY CASE WHEN mt.review_status='submitted' THEN 0 WHEN mt.status IN ('pending','in_progress') THEN 1 ELSE 2 END,mt.due_at NULLS LAST,mt.created_at DESC LIMIT $3`,p);return rows;}
  async listOpenForTeam(teamId,{limit=20}={},client=this.db){const {rows}=await client.query(`SELECT mt.*,COALESCE(u.display_name,u.username,mt.assignee_user_id::text) AS assignee_name FROM meeting_tasks mt LEFT JOIN users u ON u.id=mt.assignee_user_id WHERE mt.team_id=$1 AND mt.status IN ('pending','in_progress') ORDER BY CASE WHEN mt.review_status='submitted' THEN 0 ELSE 1 END,mt.due_at NULLS LAST,mt.created_at LIMIT $2`,[teamId,limit]);return rows;}
  async listForGuild(guildId,{limit=50,statuses=null}={},client=this.db){const p=[guildId];let extra='';if(statuses?.length){p.push(statuses);extra=` AND mt.status=ANY($${p.length})`;}p.push(limit);const {rows}=await client.query(`SELECT mt.*,t.name AS team_name,m.name AS meeting_name,m.team_id AS meeting_team_id,COALESCE(u.display_name,u.username,mt.assignee_user_id::text) AS assignee_name FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id LEFT JOIN meetings m ON m.id=mt.meeting_id LEFT JOIN users u ON u.id=mt.assignee_user_id WHERE mt.guild_id=$1 AND t.deleted_at IS NULL${extra} ORDER BY CASE WHEN mt.review_status='submitted' THEN 0 WHEN mt.status IN ('pending','in_progress') THEN 1 ELSE 2 END,mt.due_at NULLS LAST,mt.created_at DESC LIMIT $${p.length}`,p);return rows;}
  async listSubmittedForGuild(guildId,{limit=50}={},client=this.db){const {rows}=await client.query(`SELECT mt.*,t.name AS team_name,m.name AS meeting_name,m.team_id AS meeting_team_id,COALESCE(u.display_name,u.username,mt.assignee_user_id::text) AS assignee_name FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id LEFT JOIN meetings m ON m.id=mt.meeting_id LEFT JOIN users u ON u.id=mt.assignee_user_id WHERE mt.guild_id=$1 AND mt.review_status='submitted' AND t.deleted_at IS NULL ORDER BY mt.submitted_at LIMIT $2`,[guildId,limit]);return rows;}
  async updateStatus(id,status,client=this.db){const completed=status==='done'?new Date():null;const {rows}=await client.query(`UPDATE meeting_tasks SET status=$2,completed_at=$3,review_status=CASE WHEN $2='done' THEN 'approved' WHEN $2 IN ('pending','in_progress') AND review_status='approved' THEN 'not_submitted' ELSE review_status END,updated_at=now() WHERE id=$1 RETURNING *`,[id,status,completed]);return rows[0]??null;}
  async update(id,patch,client=this.db){const allowed=new Set(['title','description','assignee_user_id','due_at','meeting_id','decision_id']);const entries=Object.entries(patch).filter(([k])=>allowed.has(k));if(!entries.length)return this.get(id,client);const values=entries.map(([,v])=>v);const sets=entries.map(([k],idx)=>`${k}=$${idx+2}`).join(',');const {rows}=await client.query(`UPDATE meeting_tasks SET ${sets},updated_at=now() WHERE id=$1 RETURNING *`,[id,...values]);return rows[0]??null;}
  async dueForReminder(guildId,now=new Date(),client=this.db){const {rows}=await client.query(`SELECT mt.*,t.name AS team_name,m.name AS meeting_name,COALESCE(u.display_name,u.username,mt.assignee_user_id::text) AS assignee_name FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id LEFT JOIN meetings m ON m.id=mt.meeting_id LEFT JOIN users u ON u.id=mt.assignee_user_id WHERE mt.guild_id=$1 AND t.deleted_at IS NULL AND mt.status IN ('pending','in_progress') AND mt.review_status<>'submitted' AND mt.due_at IS NOT NULL AND mt.due_at <= $2::timestamptz + interval '24 hours' ORDER BY mt.due_at LIMIT 100`,[guildId,now]);return rows;}
  async reminderSent(taskId,key,client=this.db){const {rowCount}=await client.query('SELECT 1 FROM task_reminder_receipts WHERE task_id=$1 AND reminder_key=$2',[taskId,key]);return rowCount>0;}
  async markReminder(taskId,key,client=this.db){await client.query('INSERT INTO task_reminder_receipts(task_id,reminder_key) VALUES($1,$2) ON CONFLICT DO NOTHING',[taskId,key]);}
  async addHistory({taskId,actorUserId,eventType,fromStatus=null,toStatus=null,note='',metadata={}},client=this.db){
    const id=randomUUID();
    await client.query(`INSERT INTO task_status_history(id,task_id,actor_user_id,event_type,from_status,to_status,note,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[id,taskId,actorUserId,eventType,fromStatus,toStatus,note||null,JSON.stringify(metadata||{})]);
    return id;
  }
}
