import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

test('v1.10.12 task center exposes global lists and post-meeting create flow',()=>{
  const tasks=read('src/interfaces/discord/interactions/tasks.js');
  assert.match(tasks,/Operations 967 v1\.10\.12 — Task Center \+ Post-Meeting Assignments/);
  assert.match(tasks,/task:add-meeting/);
  assert.match(tasks,/task:all-page:/);
  assert.match(tasks,/task:assignees-page:/);
  assert.match(tasks,/task:assignee-select/);
  assert.match(tasks,/جميع المهام/);
  assert.match(tasks,/الأعضاء المكلفون/);
});

test('owner, task manager, task reviewer, and meeting leader can author meeting tasks',()=>{
  const tasks=read('src/interfaces/discord/interactions/tasks.js');
  assert.match(tasks,/isOwner/);
  assert.match(tasks,/'tasks\.manage'/);
  assert.match(tasks,/'tasks\.review'/);
  assert.match(tasks,/'meetings\.lead'/);
  assert.match(tasks,/canAuthorMeetingTask/);
});

test('ended meetings are accepted for late task assignment',()=>{
  const tasks=read('src/interfaces/discord/interactions/tasks.js');
  const service=read('src/application/services/TaskService.js');
  assert.match(tasks,/\['ongoing','ended'\]\.includes/);
  assert.match(tasks,/assertMeetingTaskWindow\(meeting\)/);
  assert.match(service,/Operations 967 v1\.10\.12 — post-meeting task assignment/);
  assert.match(service,/\['ongoing','ended'\]\.includes\(meeting\.status\)/);
  assert.doesNotMatch(service,/meeting\.status!==['"]ongoing['"]\)throw new AppError\(['"]MEETING_NOT_ONGOING/);
});

test('task center keeps review and performance controls',()=>{
  const tasks=read('src/interfaces/discord/interactions/tasks.js');
  assert.match(tasks,/task:review-queue/);
  assert.match(tasks,/task:perf-pick:week/);
  assert.match(tasks,/task:perf-pick:month/);
  assert.match(tasks,/task:filter/);
});

test('meeting leader can see the task administration section in panel',()=>{
  const panel=read('src/interfaces/discord/commands/panel.js');
  const entry=panel.match(/permissions:\[([^\]]+)\],id:'admin:tasks'/)?.[1]??'';
  assert.match(entry,/meetings\.lead/);
});
