#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="4.1.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-member-meetings-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP/src/application/services"

for f in src/application/services/AIAgentService.js src/application/services/AIMemberAccessService.js; do
  [ -f "$f" ] || { echo "❌ الملف غير موجود: $f"; exit 1; }
done

cp -a src/application/services/AIAgentService.js "$BACKUP/src/application/services/AIAgentService.js"
cp -a src/application/services/AIMemberAccessService.js "$BACKUP/src/application/services/AIMemberAccessService.js"

echo "============================================================"
echo " Meeting 967 — AI Member Meetings v${VERSION}"
echo " إضافة أداة اجتماعات العضو مع نفس نظام الصلاحيات"
echo "============================================================"

python - <<'PY'
from pathlib import Path

agent = Path("src/application/services/AIAgentService.js")
access = Path("src/application/services/AIMemberAccessService.js")

a = agent.read_text()
s = access.read_text()

if "name:'list_member_meetings'" not in a:
    marker = "  {\n    name:'list_meetings',"
    if marker not in a:
        raise SystemExit("❌ لم أجد declaration الخاصة بـ list_meetings")
    decl = """  {
    name:'list_member_meetings',
    description:'اعرض اجتماعات عضو معيّن وفق نطاق صلاحيات الطالب. استخدمها مباشرة عندما يسأل المستخدم عن اجتماعات عضو أو اجتماعات شخص معيّن، ولا تستخدم list_meetings العامة لهذا الغرض.',
    parameters:{
      type:'OBJECT',
      properties:{
        memberName:{type:'STRING',description:'اسم العضو أو اسم المستخدم أو معرف Discord'},
        status:{type:'STRING',enum:['all','upcoming','ongoing','past'],description:'فلتر الاجتماعات: الكل أو القادمة أو الجارية أو السابقة'},
        limit:{type:'INTEGER',description:'عدد النتائج بحد أقصى 20'},
      },
      required:['memberName'],
    },
  },
"""
    a = a.replace(marker, decl + marker, 1)

if "case 'list_member_meetings'" not in a:
    marker = "      case 'list_meetings':{"
    if marker not in a:
        raise SystemExit("❌ لم أجد case الخاصة بـ list_meetings")
    case = """      case 'list_member_meetings':{
        return await this.memberAccess.listMemberMeetings(subject,{
          memberName:args.memberName,
          status:args.status,
          limit:args.limit,
        });
      }

"""
    a = a.replace(marker, case + marker, 1)

if "عند السؤال عن اجتماعات عضو معيّن استخدم list_member_meetings" not in a:
    for anchor in ["قواعد:\n", "قواعد:\\n"]:
        if anchor in a:
            addition = (
                anchor +
                "- عند السؤال عن اجتماعات عضو معيّن استخدم list_member_meetings مباشرة بعد تمرير اسم العضو. "
                "لا تستخدم list_meetings العامة ولا تطلب teamName أولًا إلا عند الحاجة لتوضيح العضو.\n"
                "- صلاحية الوصول للاجتماعات تُحسم من طبقة AIMemberAccessService حسب صلاحيات الطالب ونطاق الفريق.\n"
            )
            a = a.replace(anchor, addition, 1)
            break

if "async listMemberMeetings(" not in s:
    marker = "  async info(subject, { memberName, userId, teamName } = {}) {"
    if marker not in s:
        raise SystemExit("❌ لم أجد method info() داخل AIMemberAccessService")
    method = r"""  async listMemberMeetings(subject, { memberName, status = 'all', limit = 15 } = {}) {
    const requestedName = String(memberName ?? '').trim();
    if (!requestedName) {
      throw new AppError('AI_MEMBER_NAME_REQUIRED', 'حدد اسم العضو المطلوب عرض اجتماعاته.');
    }

    const target = await this.targetUser(subject, {
      memberName: requestedName,
    });

    if (target?.ambiguous) return target;

    const targetUserId = String(target?.id ?? target?.userId ?? '').trim();
    if (!targetUserId) {
      throw new AppError('AI_MEMBER_NOT_FOUND', 'لم أستطع تحديد العضو المطلوب.');
    }

    const selfId = String(subject.userId);
    const isSelf = targetUserId === selfId;
    const global = await this.isGlobalViewer(subject);

    const targetTeams = await this.db.query(
      `SELECT tm.team_id AS id,t.name
         FROM team_members tm
         JOIN teams t ON t.id=tm.team_id
        WHERE tm.guild_id=$1
          AND tm.user_id=$2
          AND tm.active=true
          AND t.active=true
          AND t.deleted_at IS NULL
        ORDER BY t.name`,
      [String(subject.guildId), targetUserId],
    ).then(r => r.rows ?? []).catch(() => []);

    let allowedTeamIds = [];

    if (global) {
      allowedTeamIds = targetTeams.map(r => String(r.id));
    } else {
      for (const row of targetTeams) {
        if (await this.hasTeamView(subject, row.id)) {
          allowedTeamIds.push(String(row.id));
        }
      }

      if (!isSelf && !allowedTeamIds.length) {
        throw new AppError(
          'AI_MEMBER_FORBIDDEN',
          'لم أجد عضوًا يمكنك الاطلاع على اجتماعاته ضمن نطاق صلاحياتك.',
        );
      }
    }

    const requestedStatus = String(status ?? 'all').toLowerCase();
    const safeStatus = ['all','upcoming','ongoing','past'].includes(requestedStatus)
      ? requestedStatus
      : 'all';

    const limitNum = Math.min(Math.max(Number(limit) || 15, 1), 20);

    const params = [String(subject.guildId), targetUserId];
    let teamClause = '';

    if (!global) {
      if (allowedTeamIds.length) {
        params.push(allowedTeamIds);
        teamClause = ` AND m.team_id = ANY($${params.length}::uuid[])`;
      } else if (isSelf) {
        return {
          member: {
            userId: targetUserId,
            displayName: String(target.display_name ?? target.username ?? targetUserId),
            username: target.username ? String(target.username) : null,
          },
          meetings: [],
          count: 0,
        };
      }
    }

    let statusClause = '';
    if (safeStatus === 'upcoming') {
      statusClause = ` AND m.status IN ('upcoming','postponed') AND m.scheduled_at >= now()`;
    } else if (safeStatus === 'ongoing') {
      statusClause = ` AND m.status='ongoing'`;
    } else if (safeStatus === 'past') {
      statusClause = ` AND m.status='ended' AND m.scheduled_at < now()`;
    }

    params.push(limitNum);

    const { rows } = await this.db.query(
      `SELECT DISTINCT
          m.id,
          m.name,
          m.description,
          m.scheduled_at,
          m.started_at,
          m.ended_at,
          m.status,
          t.id AS team_id,
          t.name AS team_name,
          a.status AS attendance_status,
          a.total_seconds,
          a.presence_ratio
       FROM meetings m
       JOIN teams t ON t.id=m.team_id
       JOIN meeting_member_snapshots s
         ON s.meeting_id=m.id
        AND s.user_id=$2
       LEFT JOIN attendance a
         ON a.meeting_id=m.id
        AND a.user_id=$2
      WHERE m.guild_id=$1
        AND COALESCE(m.is_test,false)=false
        AND m.status <> 'canceled'
        ${teamClause}
        ${statusClause}
      ORDER BY m.scheduled_at DESC
      LIMIT $${params.length}`,
      params,
    );

    const canSensitive = isSelf || global || Boolean(
      await this.permissionService?.has?.(
        subject,
        SENSITIVE_VIEW,
        {},
      ).catch(() => false),
    );

    return {
      member: {
        userId: targetUserId,
        displayName: String(target.display_name ?? target.username ?? targetUserId),
        username: target.username ? String(target.username) : null,
      },
      meetings: rows.map(x => ({
        id: String(x.id),
        name: String(x.name),
        description: x.description ?? null,
        team: x.team_name ? String(x.team_name) : null,
        when: x.scheduled_at,
        startedAt: x.started_at ?? null,
        endedAt: x.ended_at ?? null,
        status: String(x.status),
        ...(canSensitive ? {
          attendance: x.attendance_status ? String(x.attendance_status) : null,
          totalSeconds: Number(x.total_seconds ?? 0),
          presenceRatio: x.presence_ratio == null ? null : Number(x.presence_ratio),
        } : {}),
      })),
      count: rows.length,
    };
  }

"""
    s = s.replace(marker, method + marker, 1)

agent.write_text(a)
access.write_text(s)
print("✅ تم تحديث AIAgentService.js و AIMemberAccessService.js")
PY

echo "🧪 فحص Syntax..."
node --check src/application/services/AIMemberAccessService.js
node --check src/application/services/AIAgentService.js

echo "🧪 تحقق من الربط..."
node --input-type=module <<'NODE'
import fs from 'node:fs';

const access=fs.readFileSync('src/application/services/AIMemberAccessService.js','utf8');
const agent=fs.readFileSync('src/application/services/AIAgentService.js','utf8');

for (const token of [
  'async listMemberMeetings(',
  "name:'list_member_meetings'",
  "case 'list_member_meetings'",
  'meeting_member_snapshots',
]) {
  if (!access.includes(token) && !agent.includes(token)) {
    throw new Error(`Missing token: ${token}`);
  }
}

console.log('✅ AI member-meeting wiring verified');
NODE

echo ""
echo "✅ التثبيت مكتمل"
echo "📦 النسخة الاحتياطية: $BACKUP"
echo ""
echo "أعد تشغيل البوت:"
echo "npm start"
echo ""
echo "اختبر:"
echo "اجتماعات فلان"
echo "ما هي اجتماعات فلان القادمة"
echo "اجتماعاتي السابقة"
