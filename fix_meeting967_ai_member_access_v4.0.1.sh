#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-member-access-v4.0.1-$STAMP"
mkdir -p "$BACKUP/src/application/services"
cp -a src/application/services/AIMemberAccessService.js "$BACKUP/src/application/services/AIMemberAccessService.js"

python - <<'PY'
from pathlib import Path
p=Path('src/application/services/AIMemberAccessService.js')
s=p.read_text()

# 1) Replace the self detection block with robust self aliases + direct self ID handling.
old="""    const selfName = String(self.display_name ?? self.username ?? self.id).toLowerCase();
      if (requestedName && !selfName.includes(requestedName.toLowerCase()) && !String(self.username ?? '').toLowerCase().includes(requestedName.toLowerCase())) {
        throw new AppError('AI_MEMBER_FORBIDDEN', 'ليس لديك صلاحية الاطلاع على هذا العضو.');
      }
      return self;"""
new="""    const normalizedRequested = requestedName.toLowerCase();
      const selfName = String(self.display_name ?? self.username ?? self.id).toLowerCase();
      const selfUsername = String(self.username ?? '').toLowerCase();
      const selfAliases = new Set(['انا','أنا','نفسي','حسابي','عضويتي','بياناتي','معلوماتي','myself','me','self']);
      const asksSelf = !requestedName || selfAliases.has(normalizedRequested) ||
        selfName.includes(normalizedRequested) || selfUsername.includes(normalizedRequested) ||
        normalizedRequested === String(self.id).toLowerCase();
      if (!asksSelf) {
        throw new AppError('AI_MEMBER_FORBIDDEN', 'ليس لديك صلاحية الاطلاع على هذا العضو.');
      }
      return self;"""
if old not in s:
    raise SystemExit('self block not found')
s=s.replace(old,new,1)

# 2) In findMember, recognize self aliases even when the AI says "معلوماتي" etc.
old2="""    const wanted = String(memberName ?? '').trim().toLowerCase();
    if (selfRow && wanted && (
      String(selfRow.display_name ?? '').toLowerCase().includes(wanted) ||
      String(selfRow.username ?? '').toLowerCase().includes(wanted)
    )) {"""
new2="""    const wanted = String(memberName ?? '').trim().toLowerCase();
    const selfAliases = new Set(['','انا','أنا','نفسي','حسابي','عضويتي','بياناتي','معلوماتي','myself','me','self']);
    if (selfRow && (selfAliases.has(wanted) || wanted === String(selfRow.id).toLowerCase() ||
      String(selfRow.display_name ?? '').toLowerCase().includes(wanted) ||
      String(selfRow.username ?? '').toLowerCase().includes(wanted))) {"""
if old2 not in s:
    raise SystemExit('find self block not found')
s=s.replace(old2,new2,1)

# 3) Replace findMember query so global viewers can see registered server members even if they are not currently attached to a team.
old3="""    const { rows } = await this.db.query(
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
    );"""
new3="""    const search = `%${String(memberName ?? '').trim()}%`;
    const global = await this.isGlobalViewer(subject);
    const { rows } = global
      ? await this.db.query(
          `SELECT u.id,u.username,u.display_name,
                  NULL::text AS team_id,NULL::text AS team_name
             FROM members m
             JOIN users u ON u.id=m.user_id
            WHERE m.guild_id=$1
              AND m.active=true
              AND (
                COALESCE(u.display_name,'') ILIKE $2
                OR COALESCE(u.username,'') ILIKE $2
                OR u.id::text ILIKE $2
              )
            ORDER BY COALESCE(u.display_name,u.username,u.id::text)
            LIMIT 20`,
          [String(subject.guildId), search],
        )
      : await this.db.query(
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
                OR u.id::text ILIKE $3
              )
            ORDER BY COALESCE(u.display_name,u.username,u.id::text)
            LIMIT 20`,
          [String(subject.guildId), accessible, search],
        );"""
if old3 not in s:
    raise SystemExit('find query block not found')
s=s.replace(old3,new3,1)

# 4) Make global members without teams still return a useful member object.
old4="""      current.teams.push({ id: String(row.team_id), name: String(row.team_name) });"""
new4="""      if (row.team_id && row.team_name) {
        current.teams.push({ id: String(row.team_id), name: String(row.team_name) });
      }"""
s=s.replace(old4,new4)

# 5) In targetUser, global viewers should also be able to resolve a registered member without a team.
old5="""    const params = [String(subject.guildId), accessible];
    let where = `
      tm.guild_id=$1
      AND tm.team_id=ANY($2::uuid[])
      AND tm.active=true
      AND t.active=true
      AND t.deleted_at IS NULL`;"""
new5="""    const global = await this.isGlobalViewer(subject);
    if (global) {
      const search = `%${requestedName}%`;
      const { rows } = await this.db.query(
        `SELECT u.id,u.username,u.display_name,
                NULL::text AS matched_team_id,NULL::text AS matched_team_name
           FROM members m
           JOIN users u ON u.id=m.user_id
          WHERE m.guild_id=$1
            AND m.active=true
            AND (
              COALESCE(u.display_name,'') ILIKE $2
              OR COALESCE(u.username,'') ILIKE $2
              OR u.id::text ILIKE $2
            )
          ORDER BY COALESCE(u.display_name,u.username,u.id::text)
          LIMIT 12`,
        [String(subject.guildId), search],
      );
      if (!requestedName) throw new AppError('AI_MEMBER_NAME_REQUIRED', 'حدد اسم العضو المطلوب البحث عنه.');
      if (!rows.length) throw new AppError('AI_MEMBER_NOT_FOUND', 'لم أجد عضوًا بهذا الاسم في أعضاء السيرفر.');
      if (rows.length > 1) {
        return { ambiguous:true, candidates:rows.map(x=>({userId:String(x.id),displayName:String(x.display_name??x.username??x.id),username:x.username?String(x.username):null,team:null})) };
      }
      return rows[0];
    }

    const params = [String(subject.guildId), accessible];
    let where = `
      tm.guild_id=$1
      AND tm.team_id=ANY($2::uuid[])
      AND tm.active=true
      AND t.active=true
      AND t.deleted_at IS NULL`;"""
if old5 not in s:
    raise SystemExit('target global block not found')
s=s.replace(old5,new5,1)

p.write_text(s)
PY

node --check src/application/services/AIMemberAccessService.js
say() { printf '%s\n' "$*"; }
say ""
say "============================================================"
say " Meeting 967 — AI Member Access v4.0.1"
say " إصلاح البحث عن النفس + أعضاء الإدارة + الأعضاء بلا فريق"
say "============================================================"
say "✅ تم تحديث AIMemberAccessService.js"
say "✅ فحص JavaScript نجح"
say "📦 النسخة الاحتياطية: $BACKUP"
say ""
say "أعد تشغيل البوت:"
say "npm start"
