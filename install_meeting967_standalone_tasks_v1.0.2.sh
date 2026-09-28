#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
VERSION="1.0.2"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/standalone-task-v${VERSION}-${STAMP}"
TMP="${PREFIX:-/data/data/com.termux/files/usr}/tmp/meeting967-standalone-task-${STAMP}"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }
cleanup(){ rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

TASKS="$ROOT/src/interfaces/discord/interactions/tasks.js"
PANEL="$ROOT/src/interfaces/discord/commands/panel.js"
RELIABILITY="$ROOT/src/interfaces/discord/interactionReliability.js"

[ -d "$ROOT" ] || die "لم أجد المشروع: $ROOT"
for f in "$TASKS" "$PANEL" "$RELIABILITY"; do
  [ -f "$f" ] || die "الملف غير موجود: $f"
done

mkdir -p "$BACKUP" "$TMP"
cp -a "$TASKS" "$BACKUP/tasks.js"
cp -a "$PANEL" "$BACKUP/panel.js"
cp -a "$RELIABILITY" "$BACKUP/interactionReliability.js"

say "============================================================"
say " Meeting 967 — Standalone Tasks v${VERSION}"
say " مهمة مستقلة في أي وقت — بصلاحية tasks.manage"
say "============================================================"

cat > "$TMP/standalone-functions.js" <<'JS'
async function standaloneCanManage(a,s,teamId){
  if(a.permissionService.isOwner?.(s.userId)) return true;
  return Boolean(await a.permissionService.has(s,'tasks.manage',{teamId}));
}

async function standaloneTaskTeamPicker(i,a,s,page=0){
  const teams=(await a.teams.list(s.guildId)).filter(t=>!t.deleted_at);
  const allowed=[];
  for(const team of teams){
    if(await standaloneCanManage(a,s,team.id)) allowed.push(team);
  }
  if(!allowed.length) throw new AppError('NO_TASK_TEAMS','ليس لديك صلاحية إدارة المهام في أي فريق.');

  const pageSize=20;
  const pages=Math.max(1,Math.ceil(allowed.length/pageSize));
  const safePage=Math.max(0,Math.min(Number(page)||0,pages-1));
  const slice=allowed.slice(safePage*pageSize,(safePage+1)*pageSize);

  const components=[
    stringSelect(
      'task:standalone-team-select',
      'اختر الفريق',
      slice.map(t=>({
        label:String(t.name).slice(0,100),
        description:'مهمة مستقلة — بدون اجتماع',
        value:String(t.id),
      }))
    )
  ];

  const pager=[];
  if(safePage>0) pager.push(btn('task:standalone-team-page:'+String(safePage-1),'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safePage+1<pages) pager.push(btn('task:standalone-team-page:'+String(safePage+1),'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length) components.push(...rowsFromButtons(pager));

  return i.update({
    embeds:[e('📝 إضافة مهمة مستقلة',[
      'المهمة لا تحتاج إلى اجتماع.',
      'اختر الفريق، ثم اكتب تفاصيل المهمة وحدد الشخص المكلّف.',
      'الصلاحية المطلوبة: **tasks.manage** على الفريق.',
      'الصفحة **'+String(safePage+1)+'/'+String(pages)+'** — الفرق المتاحة: **'+String(allowed.length)+'**',
    ].join('\n'))],
    components:withNavigation(components,'admin:tasks'),
  });
}

async function standaloneTaskDetailsModal(i,a,s,teamId){
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إضافة مهام لهذا الفريق.');
  const team=await a.teams.get(teamId);
  if(!team||String(team.guild_id)!==String(s.guildId)||team.deleted_at) throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');

  a.drafts.set('standalone-task:'+s.userId,{teamId});

  return i.showModal(
    new ModalBuilder()
      .setCustomId('task:standalone-details')
      .setTitle('إضافة مهمة مستقلة')
      .addComponents(
        input('title','عنوان المهمة'),
        input('due','الموعد النهائي YYYY-MM-DD HH:mm',TextInputStyle.Short,false),
        input('description','تفاصيل المهمة',TextInputStyle.Paragraph,false)
      )
  );
}

async function standaloneTaskDetailsSubmit(i,a,s){
  const d=a.drafts.get('standalone-task:'+s.userId);
  if(!d?.teamId) throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء المهمة. ابدأ من جديد.');
  if(!(await standaloneCanManage(a,s,d.teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إدارة المهام في هذا الفريق.');

  const settings=await a.guilds.getSettings(s.guildId);
  const raw=i.fields.getTextInputValue('due').trim();

  a.drafts.set('standalone-task:'+s.userId,{
    ...d,
    title:i.fields.getTextInputValue('title'),
    description:i.fields.getTextInputValue('description'),
    dueAt:raw?parseLocalDateTime(raw,settings.timezone):null,
  });

  await i.deferReply({ephemeral:Boolean(i.guildId)});
  return standaloneAssigneePicker(i,a,s,d.teamId,0,false);
}

async function standaloneAssigneePicker(i,a,s,teamId,page=0,update=false){
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إضافة مهام لهذا الفريق.');

  const team=await a.teams.get(teamId);
  if(!team||String(team.guild_id)!==String(s.guildId)||team.deleted_at) throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');

  const members=await a.teams.members(teamId);
  if(!members.length) throw new AppError('NO_MEMBERS','لا يوجد أعضاء في الفريق لإسناد هذه المهمة.');

  const guildOptions=await guildMemberOptions(s.guild,{includeBots:false});
  const byId=new Map(guildOptions.map(x=>[String(x.value),x]));
  const options=members.map(x=>byId.get(String(x.user_id))??{
    label:String(x.display_name??x.user_id).slice(0,100),
    description:'عضو في '+String(team.name).slice(0,80),
    value:String(x.user_id),
  });

  const p=pickerMenuPage(options,page);
  const components=[
    stringSelect(
      'task:standalone-assignee-select:'+String(teamId),
      'اختر المكلّف — '+String(p.start+1)+'-'+String(p.end)+' من '+String(p.total),
      p.menuItems
    )
  ];

  const pager=[];
  if(p.page>0) pager.push(btn('task:standalone-assignee-page:'+String(teamId)+':'+String(p.page-1),'السابق',ButtonStyle.Secondary,'⬅️'));
  if(p.page+1<p.pages) pager.push(btn('task:standalone-assignee-page:'+String(teamId)+':'+String(p.page+1),'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length) components.push(...rowsFromButtons(pager));

  const payload={
    content:'اختر الشخص المسؤول عن المهمة المستقلة — صفحة '+String(p.page+1)+'/'+String(p.pages)+'.',
    embeds:[],
    components:withNavigation(components,'admin:tasks'),
  };
  return update?i.update(payload):i.editReply(payload);
}

async function standaloneAssigneeSubmit(i,a,s,teamId){
  const d=a.drafts.get('standalone-task:'+s.userId);
  if(!d||String(d.teamId)!==String(teamId)) throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء المهمة. ابدأ من جديد.');
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إضافة مهام لهذا الفريق.');

  const members=await a.teams.members(teamId);
  if(!members.some(x=>String(x.user_id)===String(i.values[0]))){
    throw new AppError('ASSIGNEE_TEAM','المكلّف يجب أن يكون عضوًا في الفريق المحدد.');
  }

  const task=await a.taskService.create({
    guildId:s.guildId,
    teamId,
    meetingId:null,
    title:d.title,
    description:d.description,
    assigneeUserId:i.values[0],
    dueAt:d.dueAt,
    actorId:s.userId,
    guild:s.guild,
  });

  a.drafts.delete('standalone-task:'+s.userId);
  const team=await a.teams.get(teamId);

  return i.update({
    content:'✅ تم إنشاء المهمة المستقلة **'+String(task.title)+'** وإسنادها إلى <@'+String(task.assignee_user_id)+'>.'
      +'\n📁 الفريق: **'+String(team?.name??'غير محدد')+'**'
      +(task.due_at?'\n⏳ الموعد النهائي: <t:'+String(Math.floor(new Date(task.due_at).getTime()/1000))+':F>':'')
      +'\n🗓️ غير مرتبطة بأي اجتماع.',
    embeds:[],
    components:withNavigation([],'admin:tasks'),
  });
}
JS

cat > "$TMP/patch.mjs" <<'JS'
import fs from 'node:fs';

const [tasksPath,panelPath,reliabilityPath,payloadPath]=process.argv.slice(2);
let tasks=fs.readFileSync(tasksPath,'utf8');
let panel=fs.readFileSync(panelPath,'utf8');
let reliability=fs.readFileSync(reliabilityPath,'utf8');
const payload=fs.readFileSync(payloadPath,'utf8');

function need(condition,label){
  if(!condition) throw new Error(`لم أجد نقطة الربط: ${label}`);
}
function replaceOnce(source,needle,replacement,label){
  need(source.includes(needle),label);
  return source.replace(needle,replacement);
}

/* Add standalone functions once. */
if(!tasks.includes("async function standaloneTaskTeamPicker(")){
  const marker="async function meetingTaskPicker(i,a,s,page=0){";
  tasks=replaceOnce(tasks,marker,payload+'\n'+marker,'meetingTaskPicker');
}

/* Routes inside handleTasks. */
if(!tasks.includes("if(id==='task:add-standalone')")){
  const marker="  if(id==='task:add-meeting')return meetingTaskPicker(i,a,s,0);";
  tasks=replaceOnce(
    tasks,
    marker,
`  if(id==='task:add-standalone')return standaloneTaskTeamPicker(i,a,s,0);
  if(id.startsWith('task:standalone-team-page:'))return standaloneTaskTeamPicker(i,a,s,Number(id.split(':')[3]||0));
  if(id==='task:standalone-team-select')return standaloneTaskDetailsModal(i,a,s,i.values[0]);
  if(id==='task:standalone-details')return standaloneTaskDetailsSubmit(i,a,s);
  if(id.startsWith('task:standalone-assignee-page:')){const p=id.split(':');return standaloneAssigneePicker(i,a,s,p[2],Number(p[3]||0),true);}
  if(id.startsWith('task:standalone-assignee-select:')){const teamId=id.split(':')[3];return standaloneAssigneeSubmit(i,a,s,teamId);}
${marker}`,
    'handleTasks task:add-standalone'
  );
}

/* Reliability: team select opens a modal, so it must bypass automatic defer. */
if(!reliability.includes("id => id === 'task:standalone-team-select'")){
  const marker="  id => id.startsWith('meeting:task:') && !id.startsWith('meeting:task-submit:'),";
  reliability=replaceOnce(
    reliability,
    marker,
    "  id => id === 'task:standalone-team-select',\n"+marker,
    'interactionReliability'
  );
}

/* Panel: do not depend on an exact existing button line.
 * Find adminTasks() and inject the standalone button after const buttons=[...].
 */
if(!panel.includes("task:add-standalone")){
  const fnStart=panel.indexOf("async function adminTasks(");
  need(fnStart>=0,'adminTasks');

  const fnEnd=panel.indexOf("\nasync function ",fnStart+20);
  const end=fnEnd>=0?fnEnd:panel.length;
  let fn=panel.slice(fnStart,end);

  const buttonsMatch=fn.match(/const buttons=\[[\s\S]*?\n\s*\];/);
  need(buttonsMatch,'تعريف buttons داخل adminTasks');

  const buttonDecl=buttonsMatch[0];
  const replacement=buttonDecl+
`\n  if(access.isOwner||access.canManage){
    buttons.unshift(btn('task:add-standalone','إضافة مهمة مستقلة',ButtonStyle.Success,'📝'));
  }`;

  fn=fn.replace(buttonDecl,replacement);
  panel=panel.slice(0,fnStart)+fn+panel.slice(end);
}

/* Verify all route markers exist before writing. */
for(const x of [
  "async function standaloneTaskTeamPicker(",
  "if(id==='task:add-standalone')",
  "task:standalone-team-select",
  "task:standalone-assignee-select:",
  "meetingId:null"
]) need(tasks.includes(x),`tasks marker ${x}`);

need(panel.includes("task:add-standalone"),'panel task:add-standalone');
need(reliability.includes("id => id === 'task:standalone-team-select'"),'reliability task:standalone-team-select');

fs.writeFileSync(tasksPath,tasks);
fs.writeFileSync(panelPath,panel);
fs.writeFileSync(reliabilityPath,reliability);

console.log('✅ Patch applied');
JS

say "🧪 فحص ملفات الـPatch..."
node --check "$TMP/standalone-functions.js"
node --check "$TMP/patch.mjs"

say "🧩 تطبيق التعديل..."
node "$TMP/patch.mjs" "$TASKS" "$PANEL" "$RELIABILITY" "$TMP/standalone-functions.js"

say "🧪 فحص JavaScript بعد التطبيق..."
node --check "$TASKS"
node --check "$PANEL"
node --check "$RELIABILITY"

say "🔎 فحص الخصائص..."
grep -q "task:add-standalone" "$TASKS"
grep -q "task:standalone-team-select" "$TASKS"
grep -q "task:standalone-assignee-select:" "$TASKS"
grep -q "task:add-standalone" "$PANEL"
grep -q "task:standalone-team-select" "$RELIABILITY"
grep -q "meetingId:null" "$TASKS"

say "✅ Standalone Tasks v${VERSION} installed بنجاح."
say "📌 المهمة المستقلة لا تحتاج اجتماعًا."
say "📌 اختيار الفريق مطلوب."
say "📌 الإنشاء يتطلب tasks.manage على الفريق أو المالك."
say "🛟 Backup: $BACKUP"
say "الخطوة التالية: ./ops/botctl.sh restart ثم node scripts/deploy.js"
