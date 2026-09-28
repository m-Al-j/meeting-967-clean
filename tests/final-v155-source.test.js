import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

test('performance Word report uses mobile-safe Arabic layout',()=>{
  const s=read('src/application/services/MemberPerformanceService.js');
  assert.equal(s.includes('TableLayoutType.FIXED'),false);
  assert.equal(s.includes('width: { size: width'),false);
  assert.match(s,/rightToLeft:\s*true/);
  assert.match(s,/نظام التقييم والمتابعة/);
  assert.match(s,/سجل الاجتماعات والحضور/);
  assert.match(s,/سجل المهام والإنجاز/);
  assert.match(s,/قرار المراجع/);
  assert.match(s,/performance-967-v5-unified-clean/);
});

test('meeting Word report keeps clean layout and dates',()=>{
  const s=read('src/application/services/ReportService.js');
  assert.equal(s.includes('TableLayoutType.FIXED'),false);
  assert.match(s,/official-967-v6-approved-layout/);
  assert.match(s,/التاريخ الهجري/);
  assert.match(s,/formatDayName/);
  assert.match(s,/safeFilePart\(reportTitle\)/);
  assert.match(s,/نظام الاجتماعات والتوثيق/);
});

test('task audit and history semantics are installed',()=>{
  const s=read('src/application/services/TaskService.js');
  const r=read('src/infrastructure/repositories/TaskRepository.js');
  assert.match(s,/task\.created/);
  assert.match(s,/task\.submitted/);
  assert.match(s,/task\.approved/);
  assert.match(s,/task\.returned/);
  assert.match(r,/task_status_history/);
});
