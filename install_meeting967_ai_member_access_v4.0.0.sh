#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="4.0.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-member-access-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP/src/application/services" "$BACKUP/src/core/permissions" "$BACKUP/tests"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

for f in \
  src/application/services/AIAgentService.js \
  src/core/permissions/catalog.js
 do
  [ -f "$f" ] || die "الملف غير موجود: $f"
done

cp -a src/application/services/AIAgentService.js "$BACKUP/src/application/services/AIAgentService.js"
cp -a src/core/permissions/catalog.js "$BACKUP/src/core/permissions/catalog.js"
[ -f src/core/permissions/teamManager.js ] && cp -a src/core/permissions/teamManager.js "$BACKUP/src/core/permissions/teamManager.js"

say "============================================================"
say " Meeting 967 — AI Member Access v${VERSION}"
say " نظام وصول للبيانات حسب الصلاحية ونطاق الفريق"
say "============================================================"

say "🔐 إنشاء طبقة صلاحيات أعضاء AI..."
cat > src/application/services/AIMemberAccessService.js <<'JS'
import { AppError } from '../../core/errors/AppError.js';

const GLOBAL_VIEW = 'members.view';
const GLOBAL_MANAGE = 'members.manage';
const SENSITIVE_VIEW = 'members.view_sensitive';
const SUPER_ADMIN = 'system.super_admin';

const uniq = (xs) => [...new Set((xs ?? []).map(String))];

export class AIMemberAccessService {
  constructor({ db, permissionService, logger } = {}) {
    Object.assign(this, { db, permissionService, logger });
  }

  async isGlobalViewer(subject) {
    if (this.permissionService?.isOwner?.(subject.userId)) return true;
    if (await this.permissionService?.isSuperAdmin?.(subject)) return true;

    const globalView = await this.permissionService?.has?.(
      subject,
      GLOBAL_VIEW,
      {},
    ).catch(() => false);
    if (globalView) return true;

    const globalManage = await this.permissionService?.has?.(
      subject,
      GLOBAL_MANAGE,
      {},
    ).catch(() => false);
    return Boolean(globalManage);
  }

  async hasTeamView(subject, teamId) {
    if (!teamId) return false;
    if (await this.isGlobalViewer(subject)) return true;

    const context = { teamId: String(teamId) };
    const [view, manage, managerRow] = await Promise.all([
      this.permissionService?.has?.(subject, GLOBAL_VIEW, context).catch(() => false),
      this.permissionService?.has?.(subject, GLOBAL_MANAGE, context).catch(() => false),
      this.db.query(
        `SELECT 1 FROM team_managers
          WHERE guild_id=$1 AND team_id=$2 AND user_id=$3
          LIMIT 1`,
        [String(subject.guildId), String(teamId), String(subject.userId)],
      ).then((r) => Boolean(r.rows?.length)).catch(() => false),
    ]);
    return Boolean(view || manage || managerRow);
  }

  async hasSensitiveView(subject, teamId) {
    if (this.permissionService?.isOwner?.(subject.userId)) return true;
    if (await this.permissionService?.isSuperAdmin?.(subject)) return true;

    if (!teamId) {
      return Boolean(await this.permissionService?.has?.(
        subject,
        SENSITIVE_VIEW,
        {},
      ).catch(() => false));
    }

    return Boolean(await this.permissionService?.has?.(
      subject,
      SENSITIVE_VIEW,
      { teamId: String(teamId) },
    ).catch(() => false));
  }

  async teamByName(guildId, teamName) {
    const wanted = String(teamName ?? '').trim();
    if (!wanted) return null;
    const { rows } = await this.db.query(
      `SELECT id,name
         FROM teams
        WHERE guild_id=$1
          AND active=true
          AND deleted_at IS NULL
          AND lower(name)=lower($2)
        LIMIT 1`,
      [String(guildId), wanted],
    );
    if (rows[0]) return rows[0];

    const { rows: fuzzy } = await this.db.query(
      `SELECT id,name
         FROM teams
        WHERE guild_id=$1
          AND active=true
          AND deleted_at IS NULL
          AND (lower(name) LIKE lower($2) OR lower($2) LIKE '%' || lower(name) || '%')
        ORDER BY name
        LIMIT 10`,
      [String(guildId), `%${wanted}%`],
    );
    if (fuzzy.length === 1) return fuzzy[0];
    if (!fuzzy.length) throw new AppError('AI_TEAM_NOT_FOUND', `لم أجد فريقًا باسم ${wanted}.`);
    throw new AppError('AI_TEAM_AMBIGUOUS', `اسم الفريق غير واضح: ${fuzzy.map((x) => x.name).join('، ')}.`);
  }

  async accessibleTeamIds(subject) {
    if (await this.isGlobalViewer(subject)) {
      const { rows } = await this.db.query(
        `SELECT id FROM teams
          WHERE guild_id=$1 AND active=true AND deleted_at IS NULL
          ORDER BY name`,
        [String(subject.guildId)],
      );
      return rows.map((x) => String(x.id));
    }

    const { rows } = await this.db.query(
      `SELECT id FROM teams
        WHERE guild_id=$1 AND active=true AND deleted_at IS NULL
        ORDER BY name`,
      [String(subject.guildId)],
    );

    const ids = [];
    for (const row of rows) {
      if (await this.hasTeamView(subject, row.id)) ids.push(String(row.id));
    }
    return uniq(ids);
  }

  async memberTeams(guildId, userId) {
    const { rows } = await this.db.query(
      `SELECT t.id,t.name
         FROM team_members tm
         JOIN teams t ON t.id=tm.team_id
        WHERE tm.guild_id=$1
          AND tm.user_id=$2
          AND tm.active=true
          AND t.active=true
          AND t.deleted_at IS NULL
        ORDER BY t.name`,
      [String(guildId), String(userId)],
    );
    return rows.map((x) => ({ id: String(x.id), name: String(x.name) }));
  }

  async targetUser(subject, { memberName, userId } = {}) {
    const targetId = userId ? String(userId) : null;
    if (targetId && targetId === String(subject.userId)) {
      const { rows } = await this.db.query(
        `SELECT id,username,display_name
           FROM users
          WHERE id=$1
          LIMIT 1`,
        [targetId],
      );
      return rows[0] ?? { id: targetId, username: null, display_name: targetId };
    }

    const requestedName = String(memberName ?? '').trim();
    const accessible = await this.accessibleTeamIds(subject);

    // Ordinary members may always inspect themselves, but nothing else.
    if (!accessible.length) {
      const { rows } = await this.db.query(
        `SELECT id,username,display_name
           FROM users
          WHERE id=$1
          LIMIT 1`,
        [String(subject.userId)],
      );
      const self = rows[0] ?? { id: String(subject.userId), username: null, display_name: String(subject.userId) };
      const selfName = String(self.display_name ?? self.username ?? self.id).toLowerCase();
      if (requestedName && !selfName.includes(requestedName.toLowerCase()) && !String(self.username ?? '').toLowerCase().includes(requestedName.toLowerCase())) {
        throw new AppError('AI_MEMBER_FORBIDDEN', 'ليس لديك صلاحية الاطلاع على هذا العضو.');
      }
      return self;
    }

    const params = [String(subject.guildId), accessible];
    let where = `
      tm.guild_id=$1
      AND tm.team_id=ANY($2::uuid[])
      AND tm.active=true
      AND t.active=true
      AND t.deleted_at IS NULL`;

    if (requestedName) {
      params.push(`%${requestedName}%`);
      where += `
        AND (
          COALESCE(u.display_name,'') ILIKE $3
          OR COALESCE(u.username,'') ILIKE $3
        )`;
    }

    const { rows } = await this.db.query(
      `SELECT u.id,u.username,u.display_name,
              MIN(t.id::text) AS matched_team_id,
              MIN(t.name) AS matched_team_name
         FROM team_members tm
         JOIN teams t ON t.id=tm.team_id
         JOIN users u ON u.id=tm.user_id
        WHERE ${where}
        GROUP BY u.id,u.username,u.display_name
        ORDER BY COALESCE(u.display_name,u.username,u.id::text)
        LIMIT 12`,
      params,
    );

    if (targetId) {
      const direct = rows.find((x) => String(x.id) === targetId);
      if (direct) return direct;
    }

    if (!requestedName) throw new AppError('AI_MEMBER_NAME_REQUIRED', 'حدد اسم العضو المطلوب البحث عنه.');
    if (!rows.length) throw new AppError('AI_MEMBER_FORBIDDEN', 'لم أجد عضوًا يمكنك الاطلاع على بياناته ضمن نطاق صلاحياتك.');
    if (rows.length > 1) {
      return {
        ambiguous: true,
        candidates: rows.map((x) => ({
          userId: String(x.id),
          displayName: String(x.display_name ?? x.username ?? x.id),
          username: x.username ? String(x.username) : null,
          team: x.matched_team_name ? String(x.matched_team_name) : null,
        })),
      };
    }
    return rows[0];
  }

  async findMember(subject, { memberName, teamName } = {}) {
    let teamId = null;
    let team = null;

    if (teamName) {
      team = await this.teamByName(subject.guildId, teamName);
      if (!await this.hasTeamView(subject, team.id)) {
        throw new AppError('AI_MEMBER_FORBIDDEN', 'ليس لديك صلاحية مشاهدة أعضاء هذا الفريق.');
      }
      teamId = String(team.id);
    }

    const accessible = teamId
      ? [teamId]
      : await this.accessibleTeamIds(subject);

    // Self lookup is always allowed.
    const self = await this.db.query(
      `SELECT id,username,display_name FROM users WHERE id=$1 LIMIT 1`,
      [String(subject.userId)],
    );
    const selfRow = self.rows[0];
    const wanted = String(memberName ?? '').trim().toLowerCase();
    if (selfRow && wanted && (
      String(selfRow.display_name ?? '').toLowerCase().includes(wanted) ||
      String(selfRow.username ?? '').toLowerCase().includes(wanted)
    )) {
      const ownTeams = await this.memberTeams(subject.guildId, selfRow.id);
      return { members: [{
        userId: String(selfRow.id),
        displayName: String(selfRow.display_name ?? selfRow.username ?? selfRow.id),
        username: selfRow.username ? String(selfRow.username) : null,
        teams: ownTeams,
        scope: 'self',
      }] };
    }

    if (!accessible.length) throw new AppError('AI_MEMBER_FORBIDDEN', 'ليس لديك صلاحية مشاهدة أعضاء آخرين.');

    const { rows } = await this.db.query(
      `SELECT u.id,u.username,u.display_name,t.id AS team_id,t.name AS team_name
         FROM team_members tm
         JOIN teams t ON t.id=tm.team_id
         JOIN users u ON u.id=tm.user_id
        WHERE tm.guild_id=$1
          AND tm.team_id=ANY($2::uuid[])
          AND tm.active=true
          AND t.active=true
          AND t.deleted_at IS NULL
          AND (
            COALESCE(u.display_name,'') ILIKE $3
            OR COALESCE(u.username,'') ILIKE $3
          )
        ORDER BY COALESCE(u.display_name,u.username,u.id::text)
        LIMIT 20`,
      [String(subject.guildId), accessible, `%${String(memberName ?? '').trim()}%`],
    );

    const grouped = new Map();
    for (const row of rows) {
      const id = String(row.id);
      const current = grouped.get(id) ?? {
        userId: id,
        displayName: String(row.display_name ?? row.username ?? id),
        username: row.username ? String(row.username) : null,
        teams: [],
      };
      current.teams.push({ id: String(row.team_id), name: String(row.team_name) });
      grouped.set(id, current);
    }
    return { members: [...grouped.values()].slice(0, 10) };
  }

  async info(subject, { memberName, userId, teamName } = {}) {
    const requested = await this.targetUser(subject, { memberName, userId });
    if (requested?.ambiguous) return requested;

    const id = String(requested.id);
    const teams = await this.memberTeams(subject.guildId, id);
    const allowedTeamIds = await this.accessibleTeamIds(subject);
    const visibleTeams = teams.filter((t) => allowedTeamIds.includes(String(t.id)) || id === String(subject.userId));

    if (teamName) {
      const selected = await this.teamByName(subject.guildId, teamName);
      if (!visibleTeams.some((t) => String(t.id) === String(selected.id))) {
        throw new AppError('AI_MEMBER_FORBIDDEN', 'لا يمكنك الاطلاع على هذا العضو ضمن هذا الفريق.');
      }
    }

    if (!visibleTeams.length && id !== String(subject.userId)) {
      throw new AppError('AI_MEMBER_FORBIDDEN', 'ليس لديك صلاحية الاطلاع على هذا العضو.');
    }

    const canSensitiveGlobal = await this.hasSensitiveView(subject, null);
    const sensitiveByTeam = {};
    for (const team of visibleTeams) {
      sensitiveByTeam[String(team.id)] = await this.hasSensitiveView(subject, team.id);
    }

    const memberManage = {};
    for (const team of visibleTeams) {
      memberManage[String(team.id)] = Boolean(
        await this.permissionService?.has?.(subject, GLOBAL_MANAGE, { teamId: team.id }).catch(() => false),
      );
    }

    const result = {
      identity: {
        userId: id,
        displayName: String(requested.display_name ?? requested.username ?? id),
        username: requested.username ? String(requested.username) : null,
      },
      teams: visibleTeams.map((x) => ({ id: String(x.id), name: String(x.name) })),
      scope: id === String(subject.userId) ? 'self' : (canSensitiveGlobal || Object.values(memberManage).some(Boolean) ? 'managed' : 'team'),
      visibleSections: ['identity', 'teams'],
    };

    // Membership state is restricted to explicit sensitive access.
    if (canSensitiveGlobal || Object.values(sensitiveByTeam).some(Boolean)) {
      const { rows } = await this.db.query(
        `SELECT status,return_at,withdrawn_at,reactivation_requested_at,reactivation_status
           FROM membership_personal_states
          WHERE guild_id=$1 AND user_id=$2
          LIMIT 1`,
        [String(subject.guildId), id],
      );
      result.membership = rows[0] ? {
        status: String(rows[0].status ?? 'active'),
        returnAt: rows[0].return_at ?? null,
        withdrawnAt: rows[0].withdrawn_at ?? null,
        reactivationRequestedAt: rows[0].reactivation_requested_at ?? null,
        reactivationStatus: rows[0].reactivation_status ? String(rows[0].reactivation_status) : null,
      } : null;
      result.visibleSections.push('membership');
    }

    // Team-scoped operational data: only return data for teams the caller can inspect.
    const tasksTeams = [];
    const attendanceTeams = [];
    const performanceTeams = [];
    for (const team of visibleTeams) {
      if (await this.permissionService?.has?.(subject, 'tasks.view', { teamId: team.id }).catch(() => false)) tasksTeams.push(String(team.id));
      if (await this.permissionService?.has?.(subject, 'attendance.view', { teamId: team.id }).catch(() => false)) attendanceTeams.push(String(team.id));
      if (await this.permissionService?.has?.(subject, 'performance.view', { teamId: team.id }).catch(() => false)) performanceTeams.push(String(team.id));
    }

    if (tasksTeams.length) {
      const { rows } = await this.db.query(
        `SELECT mt.id,mt.title,mt.status,mt.review_status,mt.due_at,t.name AS team_name
           FROM meeting_tasks mt
           JOIN teams t ON t.id=mt.team_id
          WHERE mt.guild_id=$1
            AND mt.assignee_user_id=$2
            AND mt.team_id=ANY($3::uuid[])
          ORDER BY mt.due_at NULLS LAST,mt.created_at DESC
          LIMIT 20`,
        [String(subject.guildId), id, tasksTeams],
      );
      result.tasks = rows.map((x) => ({
        id: String(x.id), title: String(x.title), status: String(x.status),
        review: x.review_status ? String(x.review_status) : null,
        dueAt: x.due_at ?? null, team: String(x.team_name),
      }));
      result.visibleSections.push('tasks');
    }

    if (attendanceTeams.length) {
      const { rows } = await this.db.query(
        `SELECT COUNT(*)::int AS meetings,
                COUNT(*) FILTER (WHERE a.status='present')::int AS attended,
                COUNT(*) FILTER (WHERE a.status='late')::int AS late,
                COUNT(*) FILTER (WHERE a.status='absent')::int AS absent,
                COUNT(*) FILTER (WHERE a.status='excused')::int AS excused,
                COALESCE(AVG(a.presence_ratio),0)::numeric(8,4) AS avg_presence
           FROM attendance a
           JOIN meetings m ON m.id=a.meeting_id
          WHERE m.guild_id=$1
            AND a.user_id=$2
            AND m.team_id=ANY($3::uuid[])
            AND COALESCE(m.is_test,false)=false`,
        [String(subject.guildId), id, attendanceTeams],
      );
      const a = rows[0] ?? {};
      result.attendance = {
        meetings: Number(a.meetings ?? 0),
        attended: Number(a.attended ?? 0),
        late: Number(a.late ?? 0),
        absent: Number(a.absent ?? 0),
        excused: Number(a.excused ?? 0),
        averagePresence: Number(a.avg_presence ?? 0),
      };
      result.visibleSections.push('attendance');
    }

    if (performanceTeams.length && (canSensitiveGlobal || Object.values(sensitiveByTeam).some(Boolean))) {
      const { rows } = await this.db.query(
        `SELECT id,period_type,range_start,range_end,score,metrics,generated_at
           FROM member_performance_reports
          WHERE guild_id=$1
            AND user_id=$2
          ORDER BY generated_at DESC
          LIMIT 4`,
        [String(subject.guildId), id],
      );
      result.performance = rows.map((x) => ({
        id: String(x.id),
        periodType: x.period_type ? String(x.period_type) : null,
        rangeStart: x.range_start ?? null,
        rangeEnd: x.range_end ?? null,
        score: x.score == null ? null : Number(x.score),
        metrics: x.metrics ?? null,
        generatedAt: x.generated_at ?? null,
      }));
      result.visibleSections.push('performance');
    }

    if (canSensitiveGlobal) {
      const { rows } = await this.db.query(
        `SELECT COALESCE(SUM(amount) FILTER(WHERE amount>0 AND point_type<>'admin_adjustment'),0)::bigint AS points
           FROM membership_points_ledger
          WHERE guild_id=$1 AND user_id=$2`,
        [String(subject.guildId), id],
      );
      result.points = Number(rows[0]?.points ?? 0);
      result.visibleSections.push('points');
    }

    result.accessNote = id === String(subject.userId)
      ? 'هذه بياناتك الشخصية.'
      : 'تم عرض المعلومات التي تسمح بها صلاحياتك ونطاق الفرق فقط.';

    return result;
  }
}
JS

say "🧩 إضافة صلاحيات قراءة الأعضاء إلى catalog..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
const p='src/core/permissions/catalog.js';
let s=fs.readFileSync(p,'utf8');

const anchor="  'teams.view','teams.manage','members.manage',";
if(!s.includes(anchor)) throw new Error('catalog: لم أجد سطر teams/members');
const replacement="  'teams.view','teams.manage','members.view','members.view_sensitive','members.manage',";
s=s.replace(anchor,replacement);

// Add Arabic metadata so the new permissions appear correctly in the Permissions Center.
const metaAnchor="  'members.manage':{label:'إدارة الأعضاء',category:'teams',description:'يسمح بإدارة عضوية الأشخاص داخل الفرق وتحديث ارتباطاتهم التنظيمية.',risk:'عالية'},";
if(s.includes(metaAnchor)){
  const metaInsert=metaAnchor+"\n  'members.view':{label:'عرض الأعضاء',category:'teams',description:'يسمح بعرض بيانات الأعضاء الأساسية ضمن النطاق الممنوح فقط.',risk:'منخفضة'},"+"\n  'members.view_sensitive':{label:'عرض البيانات الحساسة للأعضاء',category:'teams',description:'يسمح بعرض بيانات عضوية حساسة مثل الحالة والنقاط ضمن النطاق الممنوح.',risk:'عالية'},";
  s=s.replace(metaAnchor,metaInsert);
}
fs.writeFileSync(p,s);
console.log('✅ catalog updated');
NODE

say "👥 تحديث حزمة مسؤول الفريق..."
if [ -f src/core/permissions/teamManager.js ]; then
  node --input-type=module <<'NODE'
import fs from 'node:fs';
const p='src/core/permissions/teamManager.js';
let s=fs.readFileSync(p,'utf8');
const old="  'members.manage',";
if(s.includes(old) && !s.includes("  'members.view',")){
  s=s.replace(old,"  'members.view',\n  'members.manage',");
}
fs.writeFileSync(p,s);
console.log('✅ team manager bundle updated');
NODE
fi

say "🧠 ربط طبقة الوصول مع AIAgentService..."
node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/application/services/AIAgentService.js';
let s=fs.readFileSync(p,'utf8');

if(!s.includes("AIMemberAccessService")){
  const markers=[
    "import { AICodebaseService } from './AICodebaseService.js';",
    "import {AICodebaseService} from './AICodebaseService.js';",
    "import {AppError} from '../../core/errors/AppError.js';",
  ];
  const marker=markers.find((x)=>s.includes(x));
  if(!marker)throw new Error('AIAgentService: import anchor غير موجود');
  const indentLine="\nimport { AIMemberAccessService } from './AIMemberAccessService.js';";
  s=s.replace(marker,marker+indentLine);
}

if(!s.includes('this.memberAccess')){
  const constructorAnchors=[
    '    this.codebase=new AICodebaseService({logger});',
    '    this.codebase = new AICodebaseService({logger});',
    '    this.pending=new Map();',
    '    this.pending = new Map();',
  ];
  const anchor=constructorAnchors.find((x)=>s.includes(x));
  if(!anchor)throw new Error('AIAgentService: لم أجد constructor anchor');
  const addition="\n    this.memberAccess=new AIMemberAccessService({db,permissionService,logger});";
  s=s.replace(anchor,anchor+addition);
}

// Make find_member team optional so the agent can search within the caller's scope.
{
  const re=/\{\s*\n?\s*name:'find_member',\n[\s\S]*?\n\s*\},\n\s*\{\n\s*name:'list_meetings',/;
  const m=s.match(re);
  if(!m)throw new Error('AIAgentService: find_member declaration غير موجودة بصيغة متوقعة');
  const block=m[0];
  const patched=block
    .replace(/description:'[^']*',/, "description:'ابحث عن عضو آخر ضمن نطاق صلاحياتك. teamName اختياري؛ إذا لم تحدده يستخدم النظام الفرق المسموح لك برؤية أعضائها.',")
    .replace(/required:\['teamName','memberName'\]/, "required:['memberName']");
  s=s.slice(0,m.index)+patched+s.slice(m.index+m[0].length);
}

// Add get_member_info declaration once.
if(!s.includes("name:'get_member_info'")){
  const marker="  {\n    name:'list_meetings',";
  const decl=`  {\n    name:'get_member_info',\n    description:'اعرض معلومات عضو آخر وفق صلاحيات الطالب ونطاق الفريق. لا تعرض أي بيانات خارج النطاق المسموح.',\n    parameters:{\n      type:'OBJECT',\n      properties:{\n        memberName:{type:'STRING',description:'اسم العضو أو اسم المستخدم'},\n        teamName:{type:'STRING',description:'اسم الفريق بشكل اختياري لتقييد النطاق'},\n      },\n      required:['memberName'],\n    },\n  },\n`;
  if(!s.includes(marker))throw new Error('AIAgentService: list_meetings declaration غير موجودة');
  s=s.replace(marker,decl+marker);
}

// Structurally replace the read-tool member case.
function methodSlice(source,name){
  const start=source.indexOf(`async ${name}(`);
  if(start<0)return null;
  const brace=source.indexOf('{',start);
  if(brace<0)return null;
  let depth=0,quote=null,esc=false,lineComment=false,blockComment=false,template=false;
  for(let i=brace;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(lineComment){if(ch==='\n')lineComment=false;continue;}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++;}continue;}
    if(quote){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===quote)quote=null;continue;}
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(ch==='`'){template=!template;continue;}
    if(template){if(ch==='{')depth++;else if(ch==='}')depth--;continue;}
    if(ch==='{' )depth++;
    else if(ch==='}') {depth--;if(depth===0)return {start,end:i+1};}
  }
  return null;
}

const em=methodSlice(s,'executeReadTool');
if(!em)throw new Error('AIAgentService: executeReadTool غير موجود');
let body=s.slice(em.start,em.end);
const findStart=body.indexOf("      case 'find_member':{");
if(findStart<0)throw new Error('AIAgentService: find_member case غير موجود');
const nextCase=body.indexOf("      case 'list_meetings':{",findStart);
if(nextCase<0)throw new Error('AIAgentService: list_meetings case غير موجود');
const newCase=`      case 'find_member':{\n        const result=await this.memberAccess.findMember(subject,args);\n        return result;\n      }\n\n      case 'get_member_info':{\n        return await this.memberAccess.info(subject,{\n          memberName:args.memberName,\n          teamName:args.teamName,\n        });\n      }\n\n`;
body=body.slice(0,findStart)+newCase+body.slice(nextCase);
s=s.slice(0,em.start)+body+s.slice(em.end);

// Strengthen the agent's system rules around member access.
const rulesAnchor='قواعد:\\n';
if(s.includes(rulesAnchor) && !s.includes('صلاحيات العضو الآخر')){
  const addition=`قواعد:\\n- عند طلب معلومات عن عضو آخر استخدم get_member_info أو find_member. النظام هو الذي يقرر الوصول؛ لا ترفض الطلب بناءً على افتراض.\\n- العضو العادي يرى بياناته الشخصية فقط. من يملك members.view أو members.manage عالميًا يرى أعضاء السيرفر ضمن ذلك النطاق. ومن يملك الصلاحية على فريق محدد يرى أعضاء ذلك الفريق فقط.\\n- members.view_sensitive مخصصة للبيانات الحساسة مثل حالة العضوية والنقاط، ولا تُعرض إلا عند وجود الصلاحية المناسبة.\\n`;
  s=s.replace(rulesAnchor,addition);
}

fs.writeFileSync(p,s);
console.log('✅ AIAgentService patched');
NODE

say "🧪 فحص Syntax..."
node --check src/application/services/AIMemberAccessService.js
node --check src/application/services/AIAgentService.js
node --check src/core/permissions/catalog.js
[ -f src/core/permissions/teamManager.js ] && node --check src/core/permissions/teamManager.js

say "🧪 إنشاء اختبارات نطاق العضوية..."
cat > tests/ai-member-access-v4.test.js <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { AIMemberAccessService } from '../src/application/services/AIMemberAccessService.js';

function permissionService({ owner=false, globals=[], teams=[] }={}){
  return {
    isOwner: () => owner,
    isSuperAdmin: async () => false,
    has: async (_subject,key,ctx={}) => {
      if (globals.includes(key) && !ctx.teamId) return true;
      return teams.some((x) => String(x.teamId)===String(ctx.teamId) && x.permission===key);
    },
  };
}

function dbFor({teams=[],members=[]}={}){
  return {
    async query(sql, params){
      if(sql.includes('SELECT id FROM teams')) return {rows:teams.map(x=>({id:x.id}))};
      if(sql.includes('SELECT id,name') && sql.includes('FROM teams')) return {rows:teams.filter(x=>String(x.name).toLowerCase()===String(params[1]).toLowerCase()).map(x=>({id:x.id,name:x.name}))};
      if(sql.includes('FROM team_members') && sql.includes('JOIN teams t')){
        const userId=String(params[1]);
        return {rows:members.filter(x=>String(x.userId)===userId && x.active!==false).map(x=>({id:x.teamId,name:x.teamName}))};
      }
      if(sql.includes('FROM users')) return {rows:[{id:'u1',username:'self',display_name:'Self'}]};
      throw new Error(`Unhandled SQL in test: ${sql.slice(0,120)}`);
    }
  };
}

test('owner can access all member teams',async()=>{
  const s=new AIMemberAccessService({
    db:dbFor({teams:[{id:'t1',name:'A'},{id:'t2',name:'B'}]}),
    permissionService:permissionService({owner:true}),
  });
  assert.deepEqual(await s.accessibleTeamIds({guildId:'g',userId:'u1'}),['t1','t2']);
});

test('ordinary member has no other-member team scope',async()=>{
  const s=new AIMemberAccessService({
    db:dbFor({teams:[{id:'t1',name:'A'}]}),
    permissionService:permissionService(),
  });
  assert.deepEqual(await s.accessibleTeamIds({guildId:'g',userId:'u1'}),[]);
});

test('team scoped members.view exposes only the granted team',async()=>{
  const s=new AIMemberAccessService({
    db:dbFor({teams:[{id:'t1',name:'A'},{id:'t2',name:'B'}]}),
    permissionService:permissionService({teams:[{teamId:'t1',permission:'members.view'}]}),
  });
  assert.deepEqual(await s.accessibleTeamIds({guildId:'g',userId:'u1'}),['t1']);
});
JS

say "🧪 تشغيل اختبار AI Member Access..."
node --test tests/ai-member-access-v4.test.js

say "🧪 تحقق من الربط النهائي..."
node --input-type=module <<'NODE2'
import fs from 'node:fs';
const agent=fs.readFileSync('src/application/services/AIAgentService.js','utf8');
const catalog=fs.readFileSync('src/core/permissions/catalog.js','utf8');
const access=fs.readFileSync('src/application/services/AIMemberAccessService.js','utf8');
for (const token of [
  'AIMemberAccessService',
  'this.memberAccess',
  "name:'get_member_info'",
  "case 'get_member_info':",
  "case 'find_member':{",
  'members.view',
  'members.view_sensitive',
]) {
  if(!agent.includes(token) && !catalog.includes(token) && !access.includes(token)) throw new Error(`Missing AI member access token: ${token}`);
}
if(!catalog.includes("'members.view':{label:'عرض الأعضاء'")) throw new Error('members.view metadata missing');
if(!catalog.includes("'members.view_sensitive':{label:'عرض البيانات الحساسة للأعضاء'")) throw new Error('members.view_sensitive metadata missing');
console.log('✅ AI member permission wiring verified');
NODE2

say ""
say "✅ AI Member Access v${VERSION} تم تركيبه."
say "🛟 Backup: $BACKUP"
say ""
say "المنطق الجديد:"
say "  • Owner = وصول كامل للأعضاء."
say "  • members.view عالمي = مشاهدة أعضاء السيرفر."
say "  • members.manage = مشاهدة + إدارة ضمن النطاق الممنوح."
say "  • members.view على Team = مشاهدة أعضاء ذلك الفريق فقط."
say "  • مسؤول الفريق يستخدم نطاق team تلقائيًا حتى لو كان منح الصلاحية موروثًا من team manager."
say "  • العضو العادي = بياناته الشخصية فقط."
say "  • members.view_sensitive = البيانات الحساسة عند منحها صراحة."
say "  • لا يمكن تجاوز النطاق حتى لو عرف المستخدم اسم الفريق أو العضو."
say "  • get_member_info يعرض فقط الأقسام التي تسمح بها الصلاحيات."
say ""
say "أعد تشغيل البوت:"
say "npm start"
