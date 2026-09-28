import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

test('meeting leader permission and live task board are wired',()=>{
  const catalog=read('src/core/permissions/catalog.js');
  const service=read('src/application/services/TaskService.js');
  const meeting=read('src/application/services/MeetingService.js');
  assert.match(catalog,/meetings\.lead/);
  assert.match(service,/ensureMeetingBoard/);
  assert.match(service,/refreshMeetingBoard/);
  assert.match(meeting,/taskService\.ensureMeetingBoard/);
  assert.match(meeting,/taskService\.finalizeMeetingBoard/);
});

test('leader can assign one member, several members, or a whole team',()=>{
  const tasks=read('src/interfaces/discord/interactions/tasks.js');
  const service=read('src/application/services/TaskService.js');
  assert.match(tasks,/task:live-mode:\$\{meetingId\}:member/);
  assert.match(tasks,/task:live-mode:\$\{meetingId\}:members/);
  assert.match(tasks,/task:live-mode:\$\{meetingId\}:team/);
  assert.match(tasks,/task:live-assignees:/);
  assert.match(service,/createAssignmentGroup/);
  assert.match(service,/assignmentMode==='team'/);
});

test('grouped assignment notifications and status surfaces are persisted',()=>{
  const repo=read('src/infrastructure/repositories/TaskRepository.js');
  const service=read('src/application/services/TaskService.js');
  const migration=read('migrations/102_live_meeting_task_leader.sql');
  assert.match(repo,/task_assignment_groups/);
  assert.match(repo,/meeting_task_boards/);
  assert.match(service,/syncAssignmentGroup/);
  assert.match(service,/notifyGroupAssignees/);
  assert.match(service,/team_message_id/);
  assert.match(service,/voice_message_id/);
  assert.match(migration,/assignment_group_id/);
});

test('live board interactions use ephemeral flow and reports group assignees',()=>{
  const reliability=read('src/interfaces/discord/interactionReliability.js');
  const report=read('src/application/services/ReportService.js');
  assert.match(reliability,/id\.startsWith\('task:live-'\)/);
  assert.match(reliability,/deferReply\(\{ephemeral:Boolean\(interaction\.guildId\)\}\)/);
  assert.match(report,/assignment_group_id/);
  assert.match(report,/فريق \$\{entry\.targetTeamName\} كاملًا/);
});

test('overdue grouped assignments refresh their live surfaces',()=>{
  const autopilot=read('src/application/services/AutopilotService.js');
  assert.match(autopilot,/refreshGroups/);
  assert.match(autopilot,/taskService\.syncAssignmentGroup/);
  assert.match(autopilot,/taskService\.refreshMeetingBoard/);
});
