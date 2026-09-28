import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PERMISSIONS,permissionMeta,permissionsInCategory} from '../src/core/permissions/catalog.js';
import {OperationsRepository} from '../src/infrastructure/repositories/OperationsRepository.js';

test('operations permissions are documented in Arabic and discoverable',()=>{
  const keys=['operations.view','decisions.view','decisions.manage','workflows.view','workflows.manage'];
  for(const key of keys){
    assert.ok(PERMISSIONS.includes(key));
    const meta=permissionMeta(key);
    assert.equal(meta.category,'operations');
    assert.ok(meta.label.length>=8);
    assert.ok(meta.description.length>=20);
  }
  assert.equal(permissionsInCategory('operations').length,5);
});

test('migration is additive and contains decisions + workflows + permissions',()=>{
  const sql=fs.readFileSync(new URL('../migrations/103_operations_governance.sql',import.meta.url),'utf8');
  for(const token of [
    'ALTER TABLE meeting_decisions ADD COLUMN IF NOT EXISTS owner_user_id',
    'ALTER TABLE meeting_decisions ADD COLUMN IF NOT EXISTS due_at',
    'CREATE TABLE IF NOT EXISTS workflow_templates',
    'CREATE TABLE IF NOT EXISTS workflow_instances',
    'CREATE TABLE IF NOT EXISTS workflow_step_history',
    "'membership_onboarding'",
    "'project_lifecycle'",
    "'leadership_handover'",
    "'operations.view'",
    "'decisions.manage'",
    "'workflows.manage'"
  ])assert.ok(sql.includes(token),`missing ${token}`);
  assert.ok(!/DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE/i.test(sql),'migration must be non-destructive');
});

test('operations router and panel entry are wired',()=>{
  const dispatcher=fs.readFileSync(new URL('../src/interfaces/discord/componentDispatcher.js',import.meta.url),'utf8');
  const reliability=fs.readFileSync(new URL('../src/interfaces/discord/interactionReliability.js',import.meta.url),'utf8');
  const panel=fs.readFileSync(new URL('../src/interfaces/discord/commands/panel.js',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  assert.ok(dispatcher.includes('handleOperations'));
  assert.ok(reliability.includes("id==='admin:operations'||id.startsWith('ops:')"));
  assert.ok(panel.includes("id:'admin:operations'"));
  assert.ok(panel.includes("v2Button('admin:operations','مركز القيادة'"));
  assert.ok(app.includes('new OperationsRepository(pool)'));
  assert.ok(app.includes('new OperationsService({operations,audit,teams})'));
});

test('operations interaction contains decision accountability and workflow controls',()=>{
  const src=fs.readFileSync(new URL('../src/interfaces/discord/interactions/operations.js',import.meta.url),'utf8');
  for(const token of [
    'سجل القرارات والالتزامات','تعيين مسؤول','تم التنفيذ + دليل','التنبيهات الحرجة',
    'محرك مسارات العمل','بدء مسار','إنجاز الخطوة الحالية','تعطيل مؤقت','استئناف'
  ])assert.ok(src.includes(token),`missing ${token}`);
});

test('operations repository writes workflow lifecycle data with generated ids',async()=>{
  const calls=[];
  const db={async query(sql,args){calls.push({sql,args});return {rows:[{id:'row-1'}]};}};
  const repo=new OperationsRepository(db);
  const wf=await repo.createWorkflow({guildId:'1',templateKey:'project_lifecycle',title:'مشروع تجريبي',teamId:null,ownerUserId:'2',dueAt:null,createdBy:'3'});
  assert.equal(wf.id,'row-1');
  assert.match(calls[0].sql,/INSERT INTO workflow_instances/);
  await repo.addWorkflowHistory({instanceId:'wf',stepIndex:0,stepName:'البداية',eventType:'started',actorUserId:'3'});
  assert.match(calls[1].sql,/INSERT INTO workflow_step_history/);
});
