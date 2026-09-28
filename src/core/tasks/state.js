const STATES=new Set(['pending','in_progress','done','cancelled']);
export function assertTaskStatus(status){if(!STATES.has(status))throw new Error(`Invalid task status: ${status}`);return true;}
export function taskDisplayStatus(task,now=new Date()){
  if(task.status==='done')return 'done';
  if(task.status==='cancelled')return 'cancelled';
  if(task.review_status==='submitted')return 'submitted';
  if(task.review_status==='rejected')return 'rejected';
  if(task.due_at&&new Date(task.due_at).getTime()<new Date(now).getTime())return 'overdue';
  return task.status;
}
export function canAssigneeTransition(from,to){
  if(from==='pending'&&to==='in_progress')return true;
  if(from==='in_progress'&&to==='pending')return true;
  return false;
}
