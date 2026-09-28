#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
VERSION="1.0.0"
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
for f in "$TASKS" "$PANEL" "$RELIABILITY"; do [ -f "$f" ] || die "الملف غير موجود: $f"; done
mkdir -p "$BACKUP" "$TMP"
cp -a "$TASKS" "$BACKUP/tasks.js"
cp -a "$PANEL" "$BACKUP/panel.js"
cp -a "$RELIABILITY" "$BACKUP/interactionReliability.js"
say "============================================================"
say " Meeting 967 — Standalone Tasks v${VERSION}"
say " إضافة مهمة مستقلة من مركز المهام بدون ربط إجباري باجتماع"
say "============================================================"
cat > "$TMP/patch.mjs" <<'NODE'
import fs from 'node:fs';
const [tasksPath,panelPath,reliabilityPath]=process.argv.slice(2);
let tasks=fs.readFileSync(tasksPath,'utf8');
let panel=fs.readFileSync(panelPath,'utf8');
let reliability=fs.readFileSync(reliabilityPath,'utf8');
function replaceOnce(source,needle,replacement,label){
  if(!source.includes(needle)) throw new Error(`لم أجد نقطة الربط: ${label}`);
  return source.replace(needle,replacement);
}
if(!tasks.includes("task:standalone-team-select")){
  const marker="async function meetingTaskPicker(i,a,s,page=0){";
  if(!tasks.includes(marker)) throw new Error('لم أجد meetingTaskPicker في tasks.js');
  const block=String.raw`
async function standaloneCanManage(a,s,teamId){
  if(a.permissionService.isOwner?.(s.userId)) return true;
  return Boolean(await a.permissionService.has(s,'tasks.manage',{teamId}));
}
async function standaloneTaskTeamPicker(i,a,s,page=0){
  const teams=(await a.teams.list(s.guildId)).filter(t=>!t.deleted_at);
  const allowed=[];
  for(const team of teams) if(await standaloneCanManage(a,s,team.id)) allowed.push(team);
  if(!allowed.length) throw new AppError('NO_TASK_TEAMS','ليس لديك صلاحية إدارة المهام في أي فريق.');
  const pageSize=20, pages=Math.max(1,Math.ceil(allowed.length/pageSize));
  const safePage=Math.max(0,Math.min(Number(page)||0,pages-1));
  const slice=allowed.slice(safePage*pageSize,(safePage+1)*pageSize);
  const components=[stringSelect('task:standalone-team-select','اختر الفريق الذي تتبع له المهمة',slice.map(t=>({label:String(t.name).slice(0,100),description:'مهمة مستقلة — بدون اجتماع',value:String(t.id)})))];
  const pager=[];
  if(safePage>0)pager.push(btn(
    \\`task:standalone-team-page:\\${safePage-1}\\`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(safePage+1<pages)pager.push(btn(
    \\`task:standalone-team-page:\\${safePage+1}\\`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length)components.push(...rowsFromButtons(pager));
  return i.update({embeds:[e('➕ إضافة مهمة مستقلة',[
    'هذه المهمة لا تحتاج إلى اجتماع.',
    'اختر الفريق فقط، وبعدها أدخل تفاصيل المهمة واختر المكلّف.',
    \\`الصفحة **\\${safePage+1}/\\${pages}** — الفرق المتاحة: **\\${allowed.length}**\\`
  ].join('\\n'))],components:withNavigation(components,'admin:tasks')});
}
async function standaloneTaskDetailsModal(i,a,s,teamId){
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إضافة مهام لهذا الفريق.');
  const team=await a.teams.get(teamId);
  if(!team||String(team.guild_id)!==String(s.guildId)||team.deleted_at) throw new AppError('TEAM_NOT_FOUND','الفريق غير موجود.');
  a.drafts.set(\\`standalone-task:\\${s.userId}\\`,{teamId});
  return i.showModal(new ModalBuilder().setCustomId('task:standalone-details').setTitle('إضافة مهمة مستقلة').addComponents(
    input('title','عنوان المهمة'),
    input('due','الموعد النهائي YYYY-MM-DD HH:mm',TextInputStyle.Short,false),
    input('description','تفاصيل المهمة',TextInputStyle.Paragraph,false)
  ));
}
async function standaloneTaskDetailsSubmit(i,a,s){
  const d=a.drafts.get(\\`standalone-task:\\${s.userId}\\`);
  if(!d?.teamId) throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء المهمة. ابدأ من جديد.');
  if(!(await standaloneCanManage(a,s,d.teamId))) throw new AppError('FORBIDDEN','لم تعد لديك صلاحية إدارة المهام في هذا الفريق.');
  const settings=await a.guilds.getSettings(s.guildId), raw=i.fields.getTextInputValue('due').trim();
  a.drafts.set(\\`standalone-task:\\${s.userId}\\`,{...d,title:i.fields.getTextInputValue('title'),description:i.fields.getTextInputValue('description'),dueAt:raw?parseLocalDateTime(raw,settings.timezone):null});
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
  const allOptions=members.map(x=>byId.get(String(x.user_id))??{label:String(x.display_name??x.user_id).slice(0,100),description:`عضو في ${team.name}`.slice(0,100),value:String(x.user_id)});
  setSmartMemberContext(a,s.userId,{customId:`task:standalone-assignee-select:${teamId}`,options:allOptions,title:'إسناد المهمة المستقلة',context:`task:standalone-assign:${teamId}`});
  const context=`task:standalone-assign:${teamId}`, query=getMemberSearch(a,s.userId,context);
  const filteredOptions=filterMemberOptions(allOptions,query), options=await rankMemberOptionsForPicker(a,s.userId,filteredOptions,query);
  const searchRows=memberSearchRows({openId:`task:standalone-member-search:${teamId}`,clearId:`task:standalone-member-search-clear:${teamId}`,query});
  if(!options.length){const payload={content:`لا توجد نتائج مطابقة لـ **${query}**.${searchSummary(query,0,allOptions.length)}`,embeds:[],components:withNavigation(searchRows,'admin:tasks')};return update?i.update(payload):i.editReply(payload);}
  const p=pickerMenuPage(options,page), components=[...searchRows,stringSelect(`task:standalone-assignee-select:${teamId}`,`اختر المكلّف — ${p.start+1}-${p.end} من ${p.total}`,p.menuItems)];
  const pager=[];
  if(p.page>0)pager.push(btn(`task:standalone-assignee-page:${teamId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'⬅️'));
  if(p.page+1<p.pages)pager.push(btn(`task:standalone-assignee-page:${teamId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'➡️'));
  if(pager.length)components.push(...rowsFromButtons(pager));
  const payload={content:`اختر الشخص المسؤول عن المهمة المستقلة — صفحة ${p.page+1}/${p.pages}.${searchSummary(query,options.length,allOptions.length)}\\n🔎 البحث بالاسم أو اليوزر متاح.`,embeds:[],components:withNavigation(components,'admin:tasks')};
  return update?i.update(payload):i.editReply(payload);
}
async function standaloneAssigneeSubmit(i,a,s,teamId){
  const d=a.drafts.get(`standalone-task:${s.userId}`);
  if(!d||String(d.teamId)!==String(teamId)) throw new AppError('DRAFT_EXPIRED','انتهت جلسة إنشاء المهمة. ابدأ من جديد.');
  if(!(await standaloneCanManage(a,s,teamId))) throw new AppError('FORBIDDEN','ليس لديك صلاحية إضافة مهام لهذا الفريق.');
  const members=await a.teams.members(teamId);
  if(!members.some(x=>String(x.user_id)===String(i.values[0]))) throw new AppError('ASSIGNEE_TEAM','المكلّف يجب أن يكون عضوًا في الفريق المحدد.');
  const task=await a.taskService.create({guildId:s.guildId,teamId,meetingId:null,title:d.title,description:d.description,assigneeUserId:i.values[0],dueAt:d.dueAt,actorId:s.userId,guild:s.guild});
  a.drafts.delete(`standalone-task:${s.userId}`);
  const team=await a.teams.get(teamId);
  return i.update({content:`✅ تم إنشاء المهمة المستقلة **${task.title}** وإسنادها إلى <@${task.assignee_user_id}>.\\n📁 الفريق: **${team?.name??'غير محدد'}**${task.due_at?`\\n⏳ الموعد النهائي: <t:${Math.floor(new Date(task.due_at).getTime()/1000)}:F>`:''}\\n🗓️ لا توجد مهمة مرتبطة باجتماع.`,embeds:[],components:withNavigation([],'admin:tasks')});
}

`;
  tasks=tasks.replace(marker,block+marker);
}
if(!tasks.includes("if(id==='task:add-standalone')")){
  const marker="  if(id==='task:add-meeting')return meetingTaskPicker(i,a,s,0);";
  tasks=replaceOnce(tasks,marker,
`  if(id==='task:add-standalone')return standaloneTaskTeamPicker(i,a,s,0);\n  if(id.startsWith('task:standalone-team-page:'))return standaloneTaskTeamPicker(i,a,s,Number(id.split(':')[3]||0));\n  if(id==='task:standalone-team-select')return standaloneTaskDetailsModal(i,a,s,i.values[0]);\n  if(id==='task:standalone-details')return standaloneTaskDetailsSubmit(i,a,s);\n  if(id.startsWith('task:standalone-assignee-page:')){const p=id.split(':');return standaloneAssigneePicker(i,a,s,p[2],Number(p[3]||0),true);}\n  if(id.startsWith('task:standalone-assignee-select:')){const teamId=id.split(':')[3];const page=pickerPageValue(i.values?.[0]);if(page!==null)return standaloneAssigneePicker(i,a,s,teamId,page,true);return standaloneAssigneeSubmit(i,a,s,teamId);}\n${marker}`,'handleTasks routes');
}
if(!tasks.includes("task:standalone-member-search:")){
  const marker="  if(i.isAnySelectMenu?.()&&pickerSearchValue(i.values?.[0])&&id.startsWith('task:assign-submit:')){";
  tasks=replaceOnce(tasks,marker,`  if(i.isAnySelectMenu?.()&&pickerSearchValue(i.values?.[0])&&id.startsWith('task:standalone-assignee-select:')){\n    const teamId=id.split(':')[3];\n    const current=getMemberSearch(a,i.user.id,\`task:standalone-assign:\${teamId}\`);\n    return i.showModal(memberSearchModal(\`task:standalone-member-search-submit:\${teamId}\`,current,'بحث عن المكلّف'));\n  }\n\n${marker}`,'standalone search select');
}
if(!tasks.includes("task:standalone-member-search-submit:")){
  const marker="  if(id.startsWith('task:member-search:')){";
  tasks=replaceOnce(tasks,marker,`  if(id.startsWith('task:standalone-member-search-submit:')){\n    const teamId=id.split(':')[3];\n    setMemberSearch(a,s.userId,\`task:standalone-assign:\${teamId}\`,i.fields.getTextInputValue('query').trim());\n    return standaloneAssigneePicker(i,a,s,teamId,0,true);\n  }\n  if(id.startsWith('task:standalone-member-search-clear:')){\n    const teamId=id.split(':')[3];\n    clearMemberSearch(a,s.userId,\`task:standalone-assign:\${teamId}\`);\n    return standaloneAssigneePicker(i,a,s,teamId,0,true);\n  }\n\n${marker}`,'standalone search submit');
}
if(!panel.includes("task:add-standalone")){
  const marker="buttons.unshift(btn('task:add-meeting','إضافة مهمة من اجتماع',ButtonStyle.Success,'➕'));";
  panel=replaceOnce(panel,marker,"buttons.unshift(btn('task:add-standalone','إضافة مهمة مستقلة',ButtonStyle.Success,'📝'));\n    "+marker,'task panel button');
}
if(!reliability.includes("id === 'task:standalone-team-select'")){
  const marker="  id => id.startsWith('meeting:task:') && !id.startsWith('meeting:task-submit:'),";
  reliability=replaceOnce(reliability,marker,"  id => id === 'task:standalone-team-select',\n"+marker,'interaction modal opener');
}
fs.writeFileSync(tasksPath,tasks);
fs.writeFileSync(panelPath,panel);
fs.writeFileSync(reliabilityPath,reliability);
console.log('✅ Patch source generated successfully');
NODE
say "🧪 تطبيق التعديل وفحص JavaScript..."
node "$TMP/patch.mjs" "$TASKS" "$PANEL" "$RELIABILITY"
node --check "$TASKS"
node --check "$PANEL"
node --check "$RELIABILITY"
say "🔎 فحص الخصائص..."
grep -q "task:add-standalone" "$TASKS"
grep -q "task:standalone-team-select" "$TASKS"
grep -q "task:standalone-assignee-select:" "$TASKS"
grep -q "task:add-standalone" "$PANEL"
grep -q "task:standalone-team-select" "$RELIABILITY"
say "✅ Standalone Tasks v${VERSION} installed."
say "📌 المهمة أصبحت لا تحتاج اجتماعًا."
say "📌 اختيار الفريق ما زال مطلوبًا لأن نظام المهام مرتبط بالفريق."
say "📌 الصلاحية المطلوبة للإنشاء: tasks.manage ضمن الفريق أو نطاق عام/المالك."
say "🛟 Backup: $BACKUP"
say "الخطوة التالية: أعد تشغيل البوت ثم node scripts/deploy.js"
