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
      const normalizedRequested = requestedName.toLowerCase();
      const selfName = String(self.display_name ?? self.username ?? self.id).toLowerCase();
      const selfUsername = String(self.username ?? '').toLowerCase();
      const selfAliases = new Set(['انا','أنا','نفسي','حسابي','عضويتي','بياناتي','معلوماتي','myself','me','self']);
      const asksSelf = !requestedName || selfAliases.has(normalizedRequested) ||
        selfName.includes(normalizedRequested) || selfUsername.includes(normalizedRequested) ||
        normalizedRequested === String(self.id).toLowerCase();
      if (!asksSelf) {
        throw new AppError('AI_MEMBER_FORBIDDEN', 'ليس لديك صلاحية الاطلاع على هذا العضو.');
      }
      return self;
    }

    const global = await this.isGlobalViewer(subject);
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
    const selfAliases = new Set(['','انا','أنا','نفسي','حسابي','عضويتي','بياناتي','معلوماتي','myself','me','self']);
    if (selfRow && (selfAliases.has(wanted) || wanted === String(selfRow.id).toLowerCase() ||
      String(selfRow.display_name ?? '').toLowerCase().includes(wanted) ||
      String(selfRow.username ?? '').toLowerCase().includes(wanted))) {
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

    const search = `%${String(memberName ?? '').trim()}%`;
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
      if (row.team_id && row.team_name) {
        current.teams.push({ id: String(row.team_id), name: String(row.team_name) });
      }
      grouped.set(id, current);
    }
    return { members: [...grouped.values()].slice(0, 10) };
  }

  async listMemberMeetings(subject, { memberName, status = 'all', limit = 15 } = {}) {
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
