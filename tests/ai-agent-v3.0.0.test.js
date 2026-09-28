import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');

test('AI Agent service exists and exposes operational tools',()=>{
  const s=read('src/application/services/AIAgentService.js');
  assert.match(s,/class AIAgentService/);
  for(const name of ['create_task','update_task','set_task_status','create_meeting','reschedule_meeting','cancel_meeting','list_tasks','list_meetings']){
    assert.match(s,new RegExp(name));
  }
  assert.match(s,/new GoogleGenAI/);
});

test('write tools require confirmation before execution',()=>{
  const s=read('src/application/services/AIAgentService.js');
  assert.match(s,/WRITE_TOOLS/);
  assert.match(s,/buildPending/);
  assert.match(s,/storePending/);
  assert.match(s,/confirm\(subject,token\)/);
});

test('AI UI is separate and has conversation controls',()=>{
  const s=read('src/interfaces/discord/commands/ai.js');
  assert.match(s,/AI 967/);
  assert.match(s,/إرسال رسالة/);
  assert.match(s,/محادثة جديدة/);
  assert.match(s,/سياقي/);
  assert.match(s,/إغلاق/);
  assert.match(s,/ai:confirm:/);
  assert.match(s,/ai:reject:/);
});

test('AI routing and modal opener are wired',()=>{
  const misc=read('src/interfaces/discord/interactions/misc.js');
  const rel=read('src/interfaces/discord/interactionReliability.js');
  const router=read('src/interfaces/discord/router.js');
  assert.match(misc,/handleAIInteraction/);
  assert.match(rel,/id => id === 'ai:message'/);
  assert.match(router,/aiCommand/);
});

test('AI service is available from app container',()=>{
  const s=read('src/app.js');
  assert.match(s,/AIAgentService/);
  assert.match(s,/aiAgentService/);
});
