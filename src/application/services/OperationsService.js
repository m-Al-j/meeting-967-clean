import {withTransaction} from '../../infrastructure/db/pool.js';
import {AppError} from '../../core/errors/AppError.js';

const VALID_PRIORITIES=new Set(['low','normal','high','critical']);
const VALID_DECISION_STATUS=new Set(['open','in_progress','implemented','cancelled']);
const VALID_WORKFLOW_STATUS=new Set(['active','blocked','completed','cancelled']);

function cleanText(value,{min=0,max=1000,label='النص'}={}){
  const text=String(value??'').trim();
  if(text.length<min)throw new AppError('INVALID_TEXT',`${label} قصير جدًا.`);
  if(text.length>max)throw new AppError('INVALID_TEXT',`${label} يتجاوز الحد المسموح.`);
  return text;
}
function cleanDate(value){
  if(value===null||value===undefined||value==='')return null;
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))throw new AppError('INVALID_DATE','التاريخ أو الوقت غير صالح.');
  return date;
}
function workflowSteps(row){return Array.isArray(row?.steps)?row.steps:[];}

export class OperationsService{
  constructor({operations,audit,teams}){Object.assign(this,{operations,audit,teams});}

  commandCenter(guildId){return this.operations.commandCenter(guildId);}
  criticalAlerts(guildId,options){return this.operations.criticalAlerts(guildId,options);}
  listDecisions(guildId,options){return this.operations.listDecisions(guildId,options);}
  getDecision(id){return this.operations.getDecision(id);}
  listTemplates(){return this.operations.listTemplates();}
  listWorkflows(guildId,options){return this.operations.listWorkflows(guildId,options);}
  getWorkflow(id){return this.operations.getWorkflow(id);}
  workflowHistory(id,options){return this.operations.workflowHistory(id,options);}

  async updateDecision({decisionId,guildId,actorId,patch}){
    const before=await this.operations.getDecision(decisionId);
    if(!before||String(before.guild_id)!==String(guildId))throw new AppError('DECISION_NOT_FOUND','القرار غير موجود.');
    const next={};
    if(Object.hasOwn(patch,'ownerUserId'))next.owner_user_id=patch.ownerUserId?String(patch.ownerUserId):null;
    if(Object.hasOwn(patch,'dueAt'))next.due_at=cleanDate(patch.dueAt);
    if(Object.hasOwn(patch,'priority')){
      const priority=String(patch.priority);if(!VALID_PRIORITIES.has(priority))throw new AppError('INVALID_PRIORITY','أولوية القرار غير صالحة.');next.priority=priority;
    }
    if(Object.hasOwn(patch,'status')){
      const status=String(patch.status);if(!VALID_DECISION_STATUS.has(status))throw new AppError('INVALID_STATUS','حالة القرار غير صالحة.');
      next.status=status;next.completed_at=status==='implemented'?new Date():null;
    }
    if(Object.hasOwn(patch,'evidence'))next.evidence=cleanText(patch.evidence,{max:1800,label:'دليل التنفيذ'})||null;
    if(!Object.keys(next).length)return before;
    const after=await withTransaction(async client=>{
      const row=await this.operations.updateDecision(decisionId,next,client);
      await this.audit.log({guildId,actorId,action:'decision.update',targetType:'meeting_decision',targetId:decisionId,oldValue:before,newValue:row},client);
      return row;
    });
    return this.operations.getDecision(after.id);
  }

  async createWorkflow({guildId,templateKey,title='',teamId=null,ownerUserId=null,dueAt=null,actorId}){
    const templates=await this.operations.listTemplates();
    const template=templates.find(x=>x.template_key===templateKey);
    if(!template)throw new AppError('WORKFLOW_TEMPLATE_NOT_FOUND','قالب مسار العمل غير موجود أو غير مفعّل.');
    if(teamId){const team=await this.teams.get(teamId);if(!team||String(team.guild_id)!==String(guildId)||team.deleted_at)throw new AppError('TEAM_NOT_FOUND','الفريق المحدد غير موجود.');}
    const finalTitle=cleanText(title||template.name_ar,{min:2,max:180,label:'عنوان المسار'});
    const owner=ownerUserId?String(ownerUserId):String(actorId);
    const date=cleanDate(dueAt);
    const steps=workflowSteps(template);
    return withTransaction(async client=>{
      const row=await this.operations.createWorkflow({guildId,templateKey,title:finalTitle,teamId,ownerUserId:owner,dueAt:date,createdBy:actorId},client);
      if(steps.length)await this.operations.addWorkflowHistory({instanceId:row.id,stepIndex:0,stepName:String(steps[0]),eventType:'started',actorUserId:actorId},client);
      await this.audit.log({guildId,actorId,action:'workflow.created',targetType:'workflow',targetId:row.id,newValue:{templateKey,title:finalTitle,teamId,ownerUserId:owner,dueAt:date}},client);
      return row;
    });
  }

  async setWorkflowOwner({workflowId,guildId,actorId,ownerUserId}){
    const before=await this.#workflowInGuild(workflowId,guildId);
    const owner=ownerUserId?String(ownerUserId):null;
    await withTransaction(async client=>{
      await this.operations.updateWorkflow(workflowId,{owner_user_id:owner},client);
      const steps=workflowSteps(before);const idx=Math.min(Number(before.current_step||0),Math.max(steps.length-1,0));
      await this.operations.addWorkflowHistory({instanceId:workflowId,stepIndex:idx,stepName:String(steps[idx]??'المسار'),eventType:'owner_changed',actorUserId:actorId,note:owner?`المسؤول: ${owner}`:'إزالة المسؤول'},client);
      await this.audit.log({guildId,actorId,action:'workflow.owner_changed',targetType:'workflow',targetId:workflowId,oldValue:{ownerUserId:before.owner_user_id},newValue:{ownerUserId:owner}},client);
    });
    return this.operations.getWorkflow(workflowId);
  }

  async setWorkflowTeam({workflowId,guildId,actorId,teamId=null}){
    const before=await this.#workflowInGuild(workflowId,guildId);
    let target=null;
    if(teamId){
      const team=await this.teams.get(teamId);
      if(!team||String(team.guild_id)!==String(guildId)||team.deleted_at)throw new AppError('TEAM_NOT_FOUND','الفريق المحدد غير موجود.');
      target=team.id;
    }
    await withTransaction(async client=>{
      await this.operations.updateWorkflow(workflowId,{team_id:target},client);
      const steps=workflowSteps(before);const idx=Math.min(Number(before.current_step||0),Math.max(steps.length-1,0));
      await this.operations.addWorkflowHistory({instanceId:workflowId,stepIndex:idx,stepName:String(steps[idx]??'المسار'),eventType:'note',actorUserId:actorId,note:target?`تم ربط المسار بالفريق ${target}`:'تم تحويل المسار إلى نطاق عام'},client);
      await this.audit.log({guildId,actorId,action:'workflow.team_changed',targetType:'workflow',targetId:workflowId,oldValue:{teamId:before.team_id},newValue:{teamId:target}},client);
    });
    return this.operations.getWorkflow(workflowId);
  }

  async setWorkflowDue({workflowId,guildId,actorId,dueAt}){
    const before=await this.#workflowInGuild(workflowId,guildId);const date=cleanDate(dueAt);
    await withTransaction(async client=>{
      await this.operations.updateWorkflow(workflowId,{due_at:date},client);
      const steps=workflowSteps(before);const idx=Math.min(Number(before.current_step||0),Math.max(steps.length-1,0));
      await this.operations.addWorkflowHistory({instanceId:workflowId,stepIndex:idx,stepName:String(steps[idx]??'المسار'),eventType:'due_changed',actorUserId:actorId,note:date?date.toISOString():'بدون موعد'},client);
      await this.audit.log({guildId,actorId,action:'workflow.due_changed',targetType:'workflow',targetId:workflowId,oldValue:{dueAt:before.due_at},newValue:{dueAt:date}},client);
    });
    return this.operations.getWorkflow(workflowId);
  }

  async advanceWorkflow({workflowId,guildId,actorId,note=''}){
    const before=await this.#workflowInGuild(workflowId,guildId);
    if(before.status!=='active')throw new AppError('WORKFLOW_NOT_ACTIVE','لا يمكن إنجاز خطوة إلا عندما يكون المسار نشطًا.');
    const steps=workflowSteps(before);if(!steps.length)throw new AppError('WORKFLOW_NO_STEPS','هذا المسار لا يحتوي خطوات.');
    const index=Math.min(Number(before.current_step||0),steps.length-1);
    const isLast=index>=steps.length-1;
    const nextIndex=isLast?index:index+1;
    const nextStatus=isLast?'completed':'active';
    const completedAt=isLast?new Date():null;
    const cleanNote=cleanText(note,{max:900,label:'الملاحظة'});
    await withTransaction(async client=>{
      await this.operations.addWorkflowHistory({instanceId:workflowId,stepIndex:index,stepName:String(steps[index]),eventType:'completed',actorUserId:actorId,note:cleanNote||null},client);
      await this.operations.updateWorkflow(workflowId,{current_step:nextIndex,status:nextStatus,completed_at:completedAt},client);
      if(!isLast)await this.operations.addWorkflowHistory({instanceId:workflowId,stepIndex:nextIndex,stepName:String(steps[nextIndex]),eventType:'started',actorUserId:actorId},client);
      await this.audit.log({guildId,actorId,action:isLast?'workflow.completed':'workflow.step_completed',targetType:'workflow',targetId:workflowId,oldValue:{step:index,status:before.status},newValue:{step:nextIndex,status:nextStatus,note:cleanNote||null}},client);
    });
    return this.operations.getWorkflow(workflowId);
  }

  async setWorkflowStatus({workflowId,guildId,actorId,status,note=''}){
    if(!VALID_WORKFLOW_STATUS.has(String(status)))throw new AppError('INVALID_STATUS','حالة مسار العمل غير صالحة.');
    const before=await this.#workflowInGuild(workflowId,guildId);const nextStatus=String(status);
    const cleanNote=cleanText(note,{max:900,label:'الملاحظة'});
    const steps=workflowSteps(before);const idx=Math.min(Number(before.current_step||0),Math.max(steps.length-1,0));
    await withTransaction(async client=>{
      await this.operations.updateWorkflow(workflowId,{status:nextStatus,completed_at:nextStatus==='completed'?new Date():null},client);
      await this.operations.addWorkflowHistory({instanceId:workflowId,stepIndex:idx,stepName:String(steps[idx]??'المسار'),eventType:'status_changed',actorUserId:actorId,note:[`${before.status} → ${nextStatus}`,cleanNote].filter(Boolean).join(' • ')},client);
      await this.audit.log({guildId,actorId,action:'workflow.status_changed',targetType:'workflow',targetId:workflowId,oldValue:{status:before.status},newValue:{status:nextStatus,note:cleanNote||null}},client);
    });
    return this.operations.getWorkflow(workflowId);
  }

  async #workflowInGuild(id,guildId){
    const row=await this.operations.getWorkflow(id);
    if(!row||String(row.guild_id)!==String(guildId))throw new AppError('WORKFLOW_NOT_FOUND','مسار العمل غير موجود.');
    return row;
  }
}
