import {randomUUID} from 'node:crypto';

export class OperationsRepository{
  constructor(db){this.db=db;}

  async commandCenter(guildId,client=this.db){
    const {rows}=await client.query(`
      SELECT
        (SELECT count(*)::int FROM meetings m WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND m.status='ongoing') AS meetings_ongoing,
        (SELECT count(*)::int FROM meetings m WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND m.status IN ('upcoming','postponed') AND m.scheduled_at>=now() AND m.scheduled_at<now()+interval '7 days') AS meetings_next_7d,
        (SELECT count(*)::int FROM meeting_tasks t WHERE t.guild_id=$1 AND t.status IN ('pending','in_progress')) AS tasks_open,
        (SELECT count(*)::int FROM meeting_tasks t WHERE t.guild_id=$1 AND t.status IN ('pending','in_progress') AND t.due_at IS NOT NULL AND t.due_at<now()) AS tasks_overdue,
        (SELECT count(*)::int FROM meeting_tasks t WHERE t.guild_id=$1 AND t.review_status='submitted') AS tasks_waiting_review,
        (SELECT count(*)::int FROM meeting_decisions d JOIN meetings m ON m.id=d.meeting_id WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND d.status IN ('open','in_progress')) AS decisions_open,
        (SELECT count(*)::int FROM meeting_decisions d JOIN meetings m ON m.id=d.meeting_id WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND d.status IN ('open','in_progress') AND d.due_at IS NOT NULL AND d.due_at<now()) AS decisions_overdue,
        (SELECT count(*)::int FROM meeting_decisions d JOIN meetings m ON m.id=d.meeting_id WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND d.status IN ('open','in_progress') AND d.owner_user_id IS NULL) AS decisions_unassigned,
        (SELECT count(*)::int FROM workflow_instances w WHERE w.guild_id=$1 AND w.status IN ('active','blocked')) AS workflows_active,
        (SELECT count(*)::int FROM workflow_instances w WHERE w.guild_id=$1 AND w.status IN ('active','blocked') AND w.due_at IS NOT NULL AND w.due_at<now()) AS workflows_overdue,
        (SELECT count(*)::int FROM workflow_instances w WHERE w.guild_id=$1 AND w.status='blocked') AS workflows_blocked,
        (SELECT count(*)::int FROM meeting_tasks t WHERE t.guild_id=$1 AND t.status='done' AND t.completed_at>=now()-interval '30 days') AS tasks_done_30d,
        (SELECT count(*)::int FROM meeting_tasks t WHERE t.guild_id=$1 AND t.created_at>=now()-interval '30 days' AND t.status<>'cancelled') AS tasks_total_30d,
        (SELECT count(*)::int FROM meeting_decisions d JOIN meetings m ON m.id=d.meeting_id WHERE m.guild_id=$1 AND d.status='implemented' AND d.completed_at>=now()-interval '30 days') AS decisions_done_30d,
        (SELECT count(*)::int FROM meeting_decisions d JOIN meetings m ON m.id=d.meeting_id WHERE m.guild_id=$1 AND d.created_at>=now()-interval '30 days' AND d.status<>'cancelled') AS decisions_total_30d
    `,[guildId]);
    return rows[0]??{};
  }

  async criticalAlerts(guildId,{limit=12}={},client=this.db){
    const {rows}=await client.query(`
      SELECT * FROM (
        SELECT 'task'::text AS kind,t.id::text AS id,t.title AS title,tm.name AS team_name,t.due_at,
          CASE WHEN t.due_at<now()-interval '7 days' THEN 4 WHEN t.due_at<now()-interval '2 days' THEN 3 ELSE 2 END AS severity,
          t.assignee_user_id AS owner_user_id
        FROM meeting_tasks t
        JOIN teams tm ON tm.id=t.team_id
        WHERE t.guild_id=$1 AND t.status IN ('pending','in_progress') AND t.due_at IS NOT NULL AND t.due_at<now()
        UNION ALL
        SELECT 'decision'::text,d.id::text,left(d.decision_text,180),tm.name,d.due_at,
          CASE d.priority WHEN 'critical' THEN 5 WHEN 'high' THEN 4 ELSE CASE WHEN d.due_at<now()-interval '7 days' THEN 4 ELSE 3 END END,
          d.owner_user_id
        FROM meeting_decisions d
        JOIN meetings m ON m.id=d.meeting_id
        JOIN teams tm ON tm.id=m.team_id
        WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND d.status IN ('open','in_progress')
          AND ((d.due_at IS NOT NULL AND d.due_at<now()) OR (d.owner_user_id IS NULL AND d.priority IN ('high','critical')))
        UNION ALL
        SELECT 'workflow'::text,w.id::text,w.title,COALESCE(tm.name,'بدون فريق'),w.due_at,
          CASE WHEN w.status='blocked' THEN 5 WHEN w.due_at<now()-interval '7 days' THEN 4 ELSE 3 END,
          w.owner_user_id
        FROM workflow_instances w
        LEFT JOIN teams tm ON tm.id=w.team_id
        WHERE w.guild_id=$1 AND w.status IN ('active','blocked') AND ((w.due_at IS NOT NULL AND w.due_at<now()) OR w.status='blocked')
      ) x
      ORDER BY severity DESC,due_at NULLS FIRST
      LIMIT $2`,[guildId,limit]);
    return rows;
  }

  async listDecisions(guildId,{limit=25,statuses=null,overdueOnly=false}={},client=this.db){
    const params=[guildId];
    let extra='';
    if(statuses?.length){params.push(statuses);extra+=` AND d.status=ANY($${params.length}::text[])`;}
    if(overdueOnly)extra+=` AND d.status IN ('open','in_progress') AND d.due_at IS NOT NULL AND d.due_at<now()`;
    params.push(limit);
    const {rows}=await client.query(`
      SELECT d.*,m.name AS meeting_name,m.team_id,t.name AS team_name,
        COALESCE(u.display_name,u.username,d.owner_user_id::text) AS owner_name,
        (SELECT count(*)::int FROM meeting_tasks mt WHERE mt.decision_id=d.id AND mt.status<>'cancelled') AS tasks_count,
        (SELECT count(*)::int FROM meeting_tasks mt WHERE mt.decision_id=d.id AND mt.status='done') AS tasks_done
      FROM meeting_decisions d
      JOIN meetings m ON m.id=d.meeting_id
      JOIN teams t ON t.id=m.team_id
      LEFT JOIN users u ON u.id=d.owner_user_id
      WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false${extra}
      ORDER BY CASE d.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        CASE WHEN d.status IN ('open','in_progress') AND d.due_at<now() THEN 0 ELSE 1 END,
        d.due_at NULLS LAST,d.created_at DESC
      LIMIT $${params.length}` ,params);
    return rows;
  }

  async getDecision(id,client=this.db){
    const {rows}=await client.query(`
      SELECT d.*,m.guild_id,m.name AS meeting_name,m.team_id,t.name AS team_name,
        COALESCE(u.display_name,u.username,d.owner_user_id::text) AS owner_name,
        (SELECT count(*)::int FROM meeting_tasks mt WHERE mt.decision_id=d.id AND mt.status<>'cancelled') AS tasks_count,
        (SELECT count(*)::int FROM meeting_tasks mt WHERE mt.decision_id=d.id AND mt.status='done') AS tasks_done
      FROM meeting_decisions d
      JOIN meetings m ON m.id=d.meeting_id
      JOIN teams t ON t.id=m.team_id
      LEFT JOIN users u ON u.id=d.owner_user_id
      WHERE d.id=$1`,[id]);
    return rows[0]??null;
  }

  async updateDecision(id,patch,client=this.db){
    const allowed=new Set(['owner_user_id','due_at','priority','status','evidence','completed_at']);
    const entries=Object.entries(patch).filter(([key])=>allowed.has(key));
    if(!entries.length)return this.getDecision(id,client);
    const values=entries.map(([,value])=>value);
    const sets=entries.map(([key],idx)=>`${key}=$${idx+2}`).join(',');
    const {rows}=await client.query(`UPDATE meeting_decisions SET ${sets},updated_at=now() WHERE id=$1 RETURNING *`,[id,...values]);
    return rows[0]??null;
  }

  async listTemplates(client=this.db){
    const {rows}=await client.query(`SELECT * FROM workflow_templates WHERE active=true ORDER BY system_template DESC,name_ar`);
    return rows;
  }

  async listWorkflows(guildId,{limit=25,statuses=null}={},client=this.db){
    const params=[guildId];let extra='';
    if(statuses?.length){params.push(statuses);extra=` AND w.status=ANY($${params.length}::text[])`;}
    params.push(limit);
    const {rows}=await client.query(`
      SELECT w.*,wt.name_ar AS template_name,wt.description_ar AS template_description,wt.steps,
        COALESCE(tm.name,'بدون فريق') AS team_name,
        COALESCE(u.display_name,u.username,w.owner_user_id::text) AS owner_name
      FROM workflow_instances w
      JOIN workflow_templates wt ON wt.template_key=w.template_key
      LEFT JOIN teams tm ON tm.id=w.team_id
      LEFT JOIN users u ON u.id=w.owner_user_id
      WHERE w.guild_id=$1${extra}
      ORDER BY CASE w.status WHEN 'blocked' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
        CASE WHEN w.status IN ('active','blocked') AND w.due_at<now() THEN 0 ELSE 1 END,
        w.due_at NULLS LAST,w.updated_at DESC
      LIMIT $${params.length}` ,params);
    return rows;
  }

  async getWorkflow(id,client=this.db){
    const {rows}=await client.query(`
      SELECT w.*,wt.name_ar AS template_name,wt.description_ar AS template_description,wt.steps,
        COALESCE(tm.name,'بدون فريق') AS team_name,
        COALESCE(u.display_name,u.username,w.owner_user_id::text) AS owner_name
      FROM workflow_instances w
      JOIN workflow_templates wt ON wt.template_key=w.template_key
      LEFT JOIN teams tm ON tm.id=w.team_id
      LEFT JOIN users u ON u.id=w.owner_user_id
      WHERE w.id=$1`,[id]);
    return rows[0]??null;
  }

  async createWorkflow({guildId,templateKey,title,teamId=null,ownerUserId=null,dueAt=null,createdBy,metadata={}},client=this.db){
    const id=randomUUID();
    const {rows}=await client.query(`
      INSERT INTO workflow_instances(id,guild_id,template_key,title,team_id,owner_user_id,due_at,created_by,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
      [id,guildId,templateKey,title,teamId,ownerUserId,dueAt,createdBy,JSON.stringify(metadata??{})]);
    return rows[0];
  }

  async updateWorkflow(id,patch,client=this.db){
    const allowed=new Set(['title','team_id','owner_user_id','status','current_step','due_at','completed_at','metadata']);
    const entries=Object.entries(patch).filter(([key])=>allowed.has(key));
    if(!entries.length)return this.getWorkflow(id,client);
    const values=entries.map(([,value])=>value);
    const sets=entries.map(([key],idx)=>`${key}=$${idx+2}`).join(',');
    const {rows}=await client.query(`UPDATE workflow_instances SET ${sets},updated_at=now() WHERE id=$1 RETURNING *`,[id,...values]);
    return rows[0]??null;
  }

  async addWorkflowHistory({instanceId,stepIndex,stepName,eventType,actorUserId,note=null},client=this.db){
    const id=randomUUID();
    const {rows}=await client.query(`
      INSERT INTO workflow_step_history(id,instance_id,step_index,step_name,event_type,actor_user_id,note)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,instanceId,stepIndex,stepName,eventType,actorUserId,note]);
    return rows[0];
  }

  async workflowHistory(instanceId,{limit=15}={},client=this.db){
    const {rows}=await client.query(`SELECT * FROM workflow_step_history WHERE instance_id=$1 ORDER BY created_at DESC LIMIT $2`,[instanceId,limit]);
    return rows;
  }
}
