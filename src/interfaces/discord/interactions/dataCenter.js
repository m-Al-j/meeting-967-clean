import fs from 'node:fs/promises';
import path from 'node:path';
import {ButtonStyle} from 'discord.js';
import {e,btn,rowsFromButtons,stringSelect,withNavigation} from '../ui.js';
import {subjectFromInteraction} from '../context.js';
import {AppError} from '../../../core/errors/AppError.js';

const PAGE_SIZE=20;
const MAX_ATTACHMENT_BYTES=8*1024*1024;

function asNumber(value){return Number(value??0);}
function iso(value){return value?new Date(value).toISOString():'—';}
function bytes(value){
  let n=asNumber(value);
  if(!Number.isFinite(n)||n<=0)return '0 B';
  const units=['B','KB','MB','GB'];let index=0;
  while(n>=1024&&index<units.length-1){n/=1024;index+=1;}
  return `${n.toFixed(index?1:0)} ${units[index]}`;
}
function jsonFile(name,value){return {attachment:Buffer.from(JSON.stringify(value,null,2),'utf8'),name};}
function rowsText(rows,key='status'){
  if(!rows?.length)return 'لا يوجد';
  return rows.map(row=>`${row[key]}: ${asNumber(row.count)}`).join(' | ');
}
async function ownerSubject(interaction,app){
  const subject=await subjectFromInteraction(interaction,app.env);
  if(!app.permissionService.isOwner(subject.userId))throw new AppError('OWNER_ONLY','مركز البيانات متاح للـOwner فقط.');
  return subject;
}
async function optionalQuery(app,sql,params=[],fallback=[]){
  try{return (await app.db.query(sql,params)).rows;}
  catch(error){if(error?.code==='42P01'||error?.code==='42703')return fallback;throw error;}
}
async function oneCount(app,sql,guildId){
  const rows=await optionalQuery(app,sql,[guildId],[{count:0}]);
  return asNumber(rows[0]?.count);
}
async function liveCounts(app,guildId){
  const specs={
    members:'SELECT count(*)::int count FROM members WHERE guild_id=$1',
    activeMembers:'SELECT count(*)::int count FROM members WHERE guild_id=$1 AND active=true',
    teams:'SELECT count(*)::int count FROM teams WHERE guild_id=$1 AND active=true AND deleted_at IS NULL',
    teamMemberships:'SELECT count(*)::int count FROM team_members WHERE guild_id=$1 AND active=true',
    meetings:'SELECT count(*)::int count FROM meetings WHERE guild_id=$1',
    attendance:'SELECT count(*)::int count FROM attendance a JOIN meetings m ON m.id=a.meeting_id WHERE m.guild_id=$1',
    excuses:'SELECT count(*)::int count FROM excuses x JOIN meetings m ON m.id=x.meeting_id WHERE m.guild_id=$1',
    reports:'SELECT count(*)::int count FROM reports r JOIN meetings m ON m.id=r.meeting_id WHERE m.guild_id=$1',
    recordings:'SELECT count(*)::int count FROM recordings r JOIN meetings m ON m.id=r.meeting_id WHERE m.guild_id=$1',
    tasks:'SELECT count(*)::int count FROM meeting_tasks WHERE guild_id=$1',
    performanceReports:'SELECT count(*)::int count FROM member_performance_reports WHERE guild_id=$1',
    supportRequests:'SELECT count(*)::int count FROM support_requests WHERE guild_id=$1',
    auditEvents:'SELECT count(*)::int count FROM audit_logs WHERE guild_id=$1',
    archives:'SELECT count(*)::int count FROM data_archives WHERE guild_id=$1',
    backups:'SELECT count(*)::int count FROM backups WHERE guild_id=$1',
    permissionGrants:`SELECT (
      (SELECT count(*) FROM user_permissions WHERE guild_id=$1)+
      (SELECT count(*) FROM role_permissions WHERE guild_id=$1)+
      (SELECT count(*) FROM team_permissions WHERE guild_id=$1)
    )::int count`
  };
  const entries=await Promise.all(Object.entries(specs).map(async([key,sql])=>[key,await oneCount(app,sql,guildId)]));
  return Object.fromEntries(entries);
}

async function home(interaction,app,subject){
  const c=await liveCounts(app,subject.guildId);
  const text=[
    '**البيانات الدائمة المحفوظة**',
    `الأعضاء: **${c.activeMembers} نشط / ${c.members} إجمالي**`,
    `الفرق: **${c.teams}** | عضويات الفرق: **${c.teamMemberships}**`,
    `منح الصلاحيات: **${c.permissionGrants}**`,
    '',
    '**بيانات التشغيل الحالية**',
    `الاجتماعات: **${c.meetings}** | الحضور: **${c.attendance}** | الأعذار: **${c.excuses}**`,
    `التقارير: **${c.reports}** | التسجيلات: **${c.recordings}** | المهام: **${c.tasks}**`,
    `تقارير التقييم: **${c.performanceReports}** | طلبات الدعم: **${c.supportRequests}**`,
    '',
    '**الحماية والاسترجاع**',
    `الأرشيفات المغلقة: **${c.archives}** | النسخ الاحتياطية الحية: **${c.backups}**`,
    `أحداث السجل الحالية: **${c.auditEvents}**`,
    '',
    '> هذا المركز للمالك فقط. لا يوفر حذفًا أو استعادةً مباشرة حتى لا تضيع البيانات بالخطأ.'
  ].join('\n');
  const buttons=[
    btn('archive-docs:home','مستندات الأرشيف',ButtonStyle.Primary,'📚'),
    btn('data:members:0','سجلات الأعضاء',ButtonStyle.Primary,'👥'),
    btn('data:operations','بيانات التشغيل',ButtonStyle.Secondary,'📊'),
    btn('data:snapshots','الأرشيفات المغلقة',ButtonStyle.Secondary,'🗄️'),
    btn('archive-docs:section:catalog','تصدير الفهرس Word',ButtonStyle.Secondary,'⬇️'),
    btn('admin:archive','أرشيف الاجتماعات',ButtonStyle.Secondary,'🗂️'),
    btn('admin:backups','النسخ الاحتياطي',ButtonStyle.Secondary,'💾')
  ];
  return interaction.update({embeds:[e('🗄️ مركز البيانات — Meeting 967',text)],components:withNavigation(rowsFromButtons(buttons))});
}

async function operations(interaction,app,subject){
  const [meetings,attendance,excuses,tasks,outputs,c]=await Promise.all([
    optionalQuery(app,'SELECT status,count(*)::int count FROM meetings WHERE guild_id=$1 GROUP BY status ORDER BY status',[subject.guildId]),
    optionalQuery(app,'SELECT a.status,count(*)::int count FROM attendance a JOIN meetings m ON m.id=a.meeting_id WHERE m.guild_id=$1 GROUP BY a.status ORDER BY a.status',[subject.guildId]),
    optionalQuery(app,'SELECT x.status,count(*)::int count FROM excuses x JOIN meetings m ON m.id=x.meeting_id WHERE m.guild_id=$1 GROUP BY x.status ORDER BY x.status',[subject.guildId]),
    optionalQuery(app,'SELECT status,count(*)::int count FROM meeting_tasks WHERE guild_id=$1 GROUP BY status ORDER BY status',[subject.guildId]),
    optionalQuery(app,`SELECT report_status,recording_status,delivery_status,count(*)::int count
      FROM meeting_output_state o JOIN meetings m ON m.id=o.meeting_id
      WHERE m.guild_id=$1 GROUP BY report_status,recording_status,delivery_status
      ORDER BY report_status,recording_status,delivery_status`,[subject.guildId]),
    liveCounts(app,subject.guildId)
  ]);
  const outputText=outputs.length?outputs.slice(0,10).map(x=>`📄 ${x.report_status} | 🎙️ ${x.recording_status} | 📨 ${x.delivery_status}: ${x.count}`).join('\n'):'لا توجد حالات مخرجات.';
  const text=[
    `**الاجتماعات:** ${rowsText(meetings)}`,
    `**الحضور:** ${rowsText(attendance)}`,
    `**الأعذار:** ${rowsText(excuses)}`,
    `**المهام:** ${rowsText(tasks)}`,
    '',
    '**حالات المخرجات**',outputText,
    '',
    `الملفات المسجلة في القاعدة: تقارير **${c.reports}** | تسجيلات **${c.recordings}** | تقييمات **${c.performanceReports}**`,
    '> كل اجتماع جديد وحضوره وتقريره وتسجيله ومهامه يظهر هنا تلقائيًا.'
  ].join('\n');
  const buttons=[btn('admin:archive','الاجتماعات',2,'🗂️'),btn('admin:reports','التقارير',2,'📄'),btn('admin:recordings','التسجيلات',2,'🎙️'),btn('admin:tasks','المهام والتقييم',2,'📋')];
  return interaction.update({embeds:[e('📊 فهرس بيانات التشغيل',text.slice(0,3900))],components:withNavigation(rowsFromButtons(buttons),'admin:data-center')});
}

async function members(interaction,app,subject,pageValue){
  const total=await oneCount(app,'SELECT count(*)::int count FROM members WHERE guild_id=$1',subject.guildId);
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const page=Math.min(Math.max(0,Number(pageValue)||0),pages-1);
  const {rows}=await app.db.query(`SELECT u.id,u.username,u.display_name,m.active,m.joined_at,
      COALESCE(string_agg(DISTINCT t.name,'، ' ORDER BY t.name) FILTER (WHERE tm.active=true AND t.active=true),'بدون فريق') team_names
    FROM members m JOIN users u ON u.id=m.user_id
    LEFT JOIN team_members tm ON tm.guild_id=m.guild_id AND tm.user_id=m.user_id AND tm.active=true
    LEFT JOIN teams t ON t.id=tm.team_id AND t.active=true
    WHERE m.guild_id=$1
    GROUP BY u.id,u.username,u.display_name,m.active,m.joined_at
    ORDER BY m.active DESC,COALESCE(u.display_name,u.username,u.id::text)
    LIMIT $2 OFFSET $3`,[subject.guildId,PAGE_SIZE,page*PAGE_SIZE]);
  const lines=rows.map((row,index)=>`${page*PAGE_SIZE+index+1}. **${row.display_name??row.username??row.id}** — ${row.active?'نشط':'غير نشط'} — ${row.team_names}`);
  const components=[];
  if(rows.length)components.push(stringSelect('data:member-select','افتح سجل عضو',rows.map(row=>({label:String(row.display_name??row.username??row.id).slice(0,100),description:String(row.team_names).slice(0,100),value:String(row.id)}))));
  const pager=[];
  if(page>0)pager.push(btn(`data:members:${page-1}`,'السابق',2,'⬅️'));
  if(page+1<pages)pager.push(btn(`data:members:${page+1}`,'التالي',2,'➡️'));
  pager.push(btn('archive-docs:section:members','تصدير سجل الأعضاء Word',2,'⬇️'));
  components.push(...rowsFromButtons(pager));
  return interaction.update({embeds:[e(`👥 سجلات الأعضاء — ${page+1}/${pages}`,lines.join('\n').slice(0,3900)||'لا يوجد أعضاء محفوظون.')],components:withNavigation(components,'admin:data-center')});
}

async function memberPackage(app,guildId,userId){
  const [profile,attendance,excuses,tasks,performance,permissions,support]=await Promise.all([
    optionalQuery(app,`SELECT u.id,u.username,u.display_name,u.updated_at,m.active,m.joined_at,
      COALESCE(json_agg(json_build_object('id',t.id,'name',t.name,'active',tm.active)) FILTER (WHERE t.id IS NOT NULL),'[]'::json) teams
      FROM members m JOIN users u ON u.id=m.user_id
      LEFT JOIN team_members tm ON tm.guild_id=m.guild_id AND tm.user_id=m.user_id
      LEFT JOIN teams t ON t.id=tm.team_id
      WHERE m.guild_id=$1 AND m.user_id=$2
      GROUP BY u.id,u.username,u.display_name,u.updated_at,m.active,m.joined_at`,[guildId,userId]),
    optionalQuery(app,`SELECT m.id meeting_id,m.name,m.scheduled_at,a.status,a.first_join_at,a.last_leave_at,a.total_seconds,a.presence_ratio,a.manually_overridden
      FROM attendance a JOIN meetings m ON m.id=a.meeting_id WHERE m.guild_id=$1 AND a.user_id=$2 ORDER BY m.scheduled_at DESC`,[guildId,userId]),
    optionalQuery(app,`SELECT m.id meeting_id,m.name,m.scheduled_at,x.status,x.reason,x.submitted_at,x.decided_at,x.decision_note
      FROM excuses x JOIN meetings m ON m.id=x.meeting_id WHERE m.guild_id=$1 AND x.user_id=$2 ORDER BY x.submitted_at DESC`,[guildId,userId]),
    optionalQuery(app,`SELECT id,team_id,meeting_id,title,description,due_at,status,review_status,submitted_at,reviewed_at,review_note,created_at,updated_at
      FROM meeting_tasks WHERE guild_id=$1 AND assignee_user_id=$2 ORDER BY created_at DESC`,[guildId,userId]),
    optionalQuery(app,`SELECT id,period_type,range_start,range_end,generated_at,file_path,score,metrics
      FROM member_performance_reports WHERE guild_id=$1 AND user_id=$2 ORDER BY generated_at DESC`,[guildId,userId]),
    optionalQuery(app,`SELECT permission_key,effect,scope_type,scope_id,granted_by,created_at
      FROM user_permissions WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC`,[guildId,userId]),
    optionalQuery(app,`SELECT id,request_type,subject,status,created_at,updated_at,closed_at
      FROM support_requests WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC`,[guildId,userId])
  ]);
  return {exportedAt:new Date().toISOString(),guildId:String(guildId),userId:String(userId),profile:profile[0]??null,attendance,excuses,tasks,performanceReports:performance,directPermissions:permissions,supportRequests:support};
}

async function memberDetail(interaction,app,subject,userId){
  const data=await memberPackage(app,subject.guildId,userId);
  if(!data.profile)throw new AppError('MEMBER_NOT_FOUND','سجل العضو غير موجود.');
  const p=data.profile;
  const attendance=Object.entries(data.attendance.reduce((acc,row)=>{acc[row.status]=(acc[row.status]??0)+1;return acc;},{})).map(([k,v])=>`${k}: ${v}`).join(' | ')||'لا يوجد';
  const tasks=Object.entries(data.tasks.reduce((acc,row)=>{acc[row.status]=(acc[row.status]??0)+1;return acc;},{})).map(([k,v])=>`${k}: ${v}`).join(' | ')||'لا يوجد';
  const teamNames=(Array.isArray(p.teams)?p.teams:[]).filter(x=>x.active).map(x=>x.name).join('، ')||'بدون فريق';
  const text=[
    `المعرف: \`${p.id}\``,
    `الحالة: **${p.active?'نشط':'غير نشط'}**`,
    `اسم المستخدم: **${p.username??'—'}**`,
    `الفرق: **${teamNames}**`,
    `تاريخ الحفظ: **${iso(p.joined_at)}**`,
    '',
    `الحضور: **${attendance}**`,
    `الأعذار: **${data.excuses.length}**`,
    `المهام: **${tasks}**`,
    `تقارير التقييم: **${data.performanceReports.length}**`,
    `الصلاحيات المباشرة: **${data.directPermissions.length}**`,
    `طلبات الدعم: **${data.supportRequests.length}**`
  ].join('\n');
  const buttons=[btn(`archive-docs:member:${p.id}`,'تنزيل سجل العضو Word',ButtonStyle.Primary,'⬇️'),btn('data:members:0','قائمة الأعضاء',2,'👥')];
  return interaction.update({embeds:[e(`👤 ${p.display_name??p.username??p.id}`,text)],components:withNavigation(rowsFromButtons(buttons),'admin:data-center')});
}

async function exportMember(interaction,app,subject,userId){
  const data=await memberPackage(app,subject.guildId,userId);
  if(!data.profile)throw new AppError('MEMBER_NOT_FOUND','سجل العضو غير موجود.');
  const file=jsonFile(`meeting967-member-${userId}.json`,data);
  if(file.attachment.byteLength>MAX_ATTACHMENT_BYTES)throw new AppError('EXPORT_TOO_LARGE','سجل العضو أكبر من حد الإرسال؛ استخدم النسخة الاحتياطية المحلية.');
  return interaction.followUp({content:'✅ سجل العضو الكامل بصيغة JSON.',files:[file],ephemeral:Boolean(interaction.guildId)});
}

async function exportMembers(interaction,app,subject){
  const {rows}=await app.db.query(`SELECT u.id,u.username,u.display_name,m.active,m.joined_at,
      COALESCE(string_agg(DISTINCT t.name,'، ' ORDER BY t.name) FILTER (WHERE tm.active=true AND t.active=true),'') team_names
    FROM members m JOIN users u ON u.id=m.user_id
    LEFT JOIN team_members tm ON tm.guild_id=m.guild_id AND tm.user_id=m.user_id AND tm.active=true
    LEFT JOIN teams t ON t.id=tm.team_id AND t.active=true
    WHERE m.guild_id=$1 GROUP BY u.id,u.username,u.display_name,m.active,m.joined_at
    ORDER BY m.active DESC,COALESCE(u.display_name,u.username,u.id::text)`,[subject.guildId]);
  const payload={exportedAt:new Date().toISOString(),guildId:String(subject.guildId),members:rows};
  const file=jsonFile('meeting967-members.json',payload);
  if(file.attachment.byteLength>MAX_ATTACHMENT_BYTES)throw new AppError('EXPORT_TOO_LARGE','ملف الأعضاء أكبر من حد الإرسال؛ استخدم النسخة الاحتياطية المحلية.');
  return interaction.followUp({content:'✅ تم تصدير فهرس الأعضاء.',files:[file],ephemeral:Boolean(interaction.guildId)});
}

async function snapshots(interaction,app,subject){
  const rows=await optionalQuery(app,'SELECT * FROM data_archives WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 25',[subject.guildId]);
  const text=rows.map((row,index)=>`${index+1}. **${row.label}**\n   ${iso(row.created_at)} — ${bytes(row.total_bytes)} — ${row.status}`).join('\n')||'لا توجد أرشيفات مغلقة حتى الآن.';
  const components=[];
  if(rows.length)components.push(stringSelect('data:snapshot-select','افتح تفاصيل الأرشيف',rows.map(row=>({label:String(row.label).slice(0,100),description:`${iso(row.created_at).slice(0,10)} • ${bytes(row.total_bytes)}`.slice(0,100),value:String(row.id)}))));
  return interaction.update({embeds:[e('🗄️ الأرشيفات المغلقة',`${text.slice(0,3800)}\n\n> لا يوجد زر حذف هنا. الاسترجاع يتم يدويًا من النسخة بعد التحقق.`)],components:withNavigation(components,'admin:data-center')});
}

async function snapshotDetail(interaction,app,subject,archiveId){
  const rows=await optionalQuery(app,'SELECT * FROM data_archives WHERE id=$1 AND guild_id=$2',[archiveId,subject.guildId]);
  const row=rows[0];if(!row)throw new AppError('ARCHIVE_NOT_FOUND','الأرشيف غير موجود.');
  const c=row.counts??{};
  const text=[
    `النوع: **${row.archive_type}**`,
    `الحالة: **${row.status}**`,
    `الإنشاء: **${iso(row.created_at)}**`,
    `الحجم: **${bytes(row.total_bytes)}**`,
    `الاجتماعات المؤرشفة: **${asNumber(c.meetings)}**`,
    `التقارير: **${asNumber(c.reports)}** | التسجيلات: **${asNumber(c.recordings)}**`,
    `الأعضاء المحفوظون داخل النسخة: **${asNumber(c.members)}**`,
    '',
    `بصمة قاعدة البيانات: \`${String(row.database_sha256??'—').slice(0,32)}\``,
    `بصمة الملفات: \`${String(row.files_sha256??'—').slice(0,32)}\``,
    '',
    `مجلد الأرشيف:\n\`${path.dirname(row.manifest_path??row.database_dump_path??'—')}\``
  ].join('\n');
  const buttons=[];
  if(row.manifest_path)buttons.push(btn(`data:snapshot-manifest:${row.id}`,'تنزيل الفهرس',ButtonStyle.Primary,'⬇️'));
  buttons.push(btn('data:snapshots','كل الأرشيفات',2,'🗄️'));
  return interaction.update({embeds:[e(`🗄️ ${row.label}`,text.slice(0,3900))],components:withNavigation(rowsFromButtons(buttons),'admin:data-center')});
}

async function manifest(interaction,app,subject,archiveId){
  const rows=await optionalQuery(app,'SELECT manifest_path FROM data_archives WHERE id=$1 AND guild_id=$2',[archiveId,subject.guildId]);
  const file=rows[0]?.manifest_path;if(!file)throw new AppError('MANIFEST_NOT_FOUND','فهرس الأرشيف غير موجود.');
  const project=path.resolve('.');const resolved=path.resolve(file);const relative=path.relative(project,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new AppError('UNSAFE_ARCHIVE_PATH','مسار الأرشيف خارج المشروع.');
  const stat=await fs.stat(resolved).catch(()=>null);
  if(!stat||!stat.isFile())throw new AppError('MANIFEST_NOT_FOUND','ملف الفهرس غير موجود على الجهاز.');
  if(stat.size>MAX_ATTACHMENT_BYTES)throw new AppError('MANIFEST_TOO_LARGE','ملف الفهرس أكبر من حد إرسال Discord.');
  return interaction.followUp({content:'✅ فهرس الأرشيف مع تفاصيل التحقق.',files:[{attachment:resolved,name:path.basename(resolved)}],ephemeral:Boolean(interaction.guildId)});
}

async function exportCatalog(interaction,app,subject){
  const [counts,snapshots]=await Promise.all([
    liveCounts(app,subject.guildId),
    optionalQuery(app,`SELECT id,archive_type,label,note,created_at,status,total_bytes,counts,preserved,database_sha256,files_sha256
      FROM data_archives WHERE guild_id=$1 ORDER BY created_at DESC`,[subject.guildId])
  ]);
  const payload={exportedAt:new Date().toISOString(),guildId:String(subject.guildId),counts,snapshots};
  return interaction.followUp({content:'✅ فهرس مركز البيانات.',files:[jsonFile('meeting967-data-catalog.json',payload)],ephemeral:Boolean(interaction.guildId)});
}

export async function handleDataCenter(interaction,app){
  const id=String(interaction.customId??'');
  const subject=await ownerSubject(interaction,app);
  if(id==='admin:data-center'||id==='data:home')return home(interaction,app,subject);
  if(id==='data:operations')return operations(interaction,app,subject);
  if(id==='data:members-export')return exportMembers(interaction,app,subject);
  if(id==='data:member-select')return memberDetail(interaction,app,subject,String(interaction.values?.[0]??''));
  if(id.startsWith('data:member-export:'))return exportMember(interaction,app,subject,id.slice('data:member-export:'.length));
  if(id.startsWith('data:member:'))return memberDetail(interaction,app,subject,id.slice('data:member:'.length));
  if(id.startsWith('data:members:'))return members(interaction,app,subject,id.slice('data:members:'.length));
  if(id==='data:snapshots')return snapshots(interaction,app,subject);
  if(id==='data:snapshot-select')return snapshotDetail(interaction,app,subject,String(interaction.values?.[0]??''));
  if(id.startsWith('data:snapshot-manifest:'))return manifest(interaction,app,subject,id.slice('data:snapshot-manifest:'.length));
  if(id.startsWith('data:snapshot:'))return snapshotDetail(interaction,app,subject,id.slice('data:snapshot:'.length));
  if(id==='data:export-catalog')return exportCatalog(interaction,app,subject);
  return false;
}
