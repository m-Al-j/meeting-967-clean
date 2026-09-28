const ROLE_CATALOG = Object.freeze([
  {
    key: 'ordinary',
    kind: 'baseline',
    name: '🔹 عضو عادي',
    color: 0x64748B,
    minPoints: 0
  },
  {
    key: 'new',
    kind: 'baseline',
    name: '🌱 عضو جديد',
    color: 0x22C55E,
    minPoints: 0
  },
  {
    key: 'participant',
    kind: 'rank',
    name: '🔹 مشارك',
    color: 0x3498DB,
    minPoints: 100
  },
  {
    key: 'engaged',
    kind: 'rank',
    name: '⚡ عضو متفاعل',
    color: 0x2ECC71,
    minPoints: 250
  },
  {
    key: 'active',
    kind: 'rank',
    name: '⭐ عضو فاعل',
    color: 0xE67E22,
    minPoints: 500
  },
  {
    key: 'distinguished',
    kind: 'rank',
    name: '👑 عضو متميز',
    color: 0x9B59B6,
    minPoints: 1000
  }
]);

const ROLE_NAME_ALIASES = Object.freeze({
  ordinary: Object.freeze([
    '🔹 عضو عادي',
    'عضو عادي',
    'عضوية عامة'
  ]),
  new: Object.freeze([
    '🌱 عضو جديد',
    'عضو جديد 🌱',
    'عضو جديد',
    '🌱 مبتدئ',
    'مبتدئ'
  ])
});

const DISABLED_ROLE_NAMES = Object.freeze([
  '🏆 عضو الأسبوع'
]);

function roleForMonthlyPoints(points, baselineKey) {
  const value = Math.max(0, Number(points) || 0);
  let selected = ROLE_CATALOG.find(x => x.key === baselineKey) ?? ROLE_CATALOG[0];

  for (const role of ROLE_CATALOG) {
    if (role.kind === 'rank' && value >= role.minPoints) {
      selected = role;
    }
  }

  return selected;
}

export class MembershipRoleService {
  constructor({ db, logger, env }) {
    Object.assign(this, { db, logger, env });
    this.timer = null;
    this.running = false;
  }

  roles() {
    return ROLE_CATALOG;
  }

  async policy(guildId) {
    const { rows } = await this.db.query(
      `SELECT guild_id,monthly_roles_enabled,activated_at,
              first_full_month_start,timezone
       FROM membership_role_policy
       WHERE guild_id=$1`,
      [String(guildId)]
    );
    return rows[0] ?? null;
  }

  async ensureRole(guild, definition) {
    let role = null;

    const { rows } = await this.db.query(
      `SELECT role_id
       FROM membership_membership_roles
       WHERE guild_id=$1 AND role_key=$2`,
      [String(guild.id), definition.key]
    );

    if (rows[0]?.role_id) {
      role =
        guild.roles.cache.get(String(rows[0].role_id)) ??
        await guild.roles.fetch(String(rows[0].role_id)).catch(() => null);
    }

    if (!role) {
      const names =
        definition.kind === 'baseline'
          ? (ROLE_NAME_ALIASES[definition.key] ?? [definition.name])
          : [definition.name];

      role = [...guild.roles.cache.values()].find(
        r => !r.managed && names.includes(r.name)
      ) ?? null;
    }

    if (!role) {
      role = await guild.roles.create({
        name: definition.name,
        color: definition.color,
        hoist: false,
        mentionable: false,
        reason: 'Meeting 967 — Monthly membership roles'
      });
    } else if (
      role.name !== definition.name ||
      role.color !== definition.color
    ) {
      await role.edit({
        name: definition.name,
        color: definition.color,
        reason: 'Meeting 967 — Monthly membership role alignment'
      });
    }

    await this.db.query(
      `INSERT INTO membership_membership_roles
       (guild_id,role_key,role_id,role_name,role_color,role_kind)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(guild_id,role_key)
       DO UPDATE SET
         role_id=EXCLUDED.role_id,
         role_name=EXCLUDED.role_name,
         role_color=EXCLUDED.role_color,
         role_kind=EXCLUDED.role_kind,
         updated_at=now()`,
      [
        String(guild.id),
        definition.key,
        String(role.id),
        definition.name,
        Number(definition.color),
        definition.kind
      ]
    );

    return role;
  }

  async cleanupLegacyRoleDuplicates(guild, roleMap) {
    const canonicalIds = new Set(
      Object.values(roleMap)
        .filter(Boolean)
        .map(role => String(role.id))
    );

    const legacyNames = new Set([
      ...(ROLE_NAME_ALIASES.ordinary ?? []),
      ...(ROLE_NAME_ALIASES.new ?? [])
    ]);

    for (const role of guild.roles.cache.values()) {
      if (role.managed || canonicalIds.has(String(role.id))) continue;
      if (!legacyNames.has(role.name)) continue;

      for (const member of guild.members.cache.values()) {
        if (member.user?.bot) continue;
        if (!member.roles.cache.has(String(role.id))) continue;

        await member.roles.remove(
          String(role.id),
          'Meeting 967 — Remove legacy membership baseline role'
        ).catch(() => null);
      }
    }
  }

  async ensureRoles(guild) {
    const map = {};
    for (const definition of ROLE_CATALOG) {
      map[definition.key] = await this.ensureRole(guild, definition);
    }

    return map;
  }

  async ensureBaselineForMember(guild, member, activationAt) {
    if (!member || member.user?.bot) return null;

    const { rows } = await this.db.query(
      `SELECT baseline_key
       FROM membership_member_baselines
       WHERE guild_id=$1 AND user_id=$2`,
      [String(guild.id), String(member.id)]
    );

    if (rows[0]?.baseline_key) {
      return rows[0].baseline_key;
    }

    const joinedAt = Number(member.joinedTimestamp || 0);
    const activatedMs = new Date(activationAt).getTime();
    const baselineKey =
      joinedAt > 0 && joinedAt > activatedMs ? 'new' : 'ordinary';

    await this.db.query(
      `INSERT INTO membership_member_baselines
       (guild_id,user_id,baseline_key,created_at)
       VALUES($1,$2,$3,now())
       ON CONFLICT(guild_id,user_id) DO NOTHING`,
      [String(guild.id), String(member.id), baselineKey]
    );

    return baselineKey;
  }
  async latestAwardForUser(guildId, userId) {
    const { rows } = await this.db.query(
      `SELECT month_start,role_key,points
       FROM membership_monthly_rank_awards
       WHERE guild_id=$1 AND user_id=$2
       ORDER BY month_start DESC
       LIMIT 1`,
      [String(guildId), String(userId)]
    );
    return rows[0] ?? null;
  }

  async removeManagedMembershipRoles(member, roleMap) {
    for (const role of Object.values(roleMap)) {
      if (!role?.id) continue;
      if (member.roles.cache.has(String(role.id))) {
        await member.roles.remove(
          String(role.id),
          'Meeting 967 — Monthly membership replacement'
        ).catch(() => null);
      }
    }

    for (const role of member.guild.roles.cache.values()) {
      if (!role.managed && DISABLED_ROLE_NAMES.includes(role.name)) {
        if (member.roles.cache.has(String(role.id))) {
          await member.roles.remove(
            String(role.id),
            'Meeting 967 — Disabled weekly membership role'
          ).catch(() => null);
        }
      }
    }
  }

  async applyRoleKey(member, roleMap, roleKey) {
    const target = roleMap[roleKey];
    if (!target || !member || member.user?.bot) return false;

    const targetId = String(target.id);

    // لا نسحب الرتبة المطلوبة ثم نعيدها.
    // نزيل فقط رتب العضوية الأخرى، ونضيف الهدف إذا لم يكن موجودًا.
    for (const role of Object.values(roleMap)) {
      if (!role?.id) continue;

      const roleId = String(role.id);
      if (roleId === targetId) continue;

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(
          roleId,
          'Meeting 967 — Monthly membership replacement'
        ).catch(() => null);
      }
    }

    // الرتبة المطلوبة موجودة بالفعل: لا نرسل طلب Discord جديد.
    if (member.roles.cache.has(targetId)) {
      return true;
    }

    await member.roles.add(
      targetId,
      'Meeting 967 — Monthly membership status'
    ).catch(() => null);

    return true;
  }

  async getMonthToEvaluate(guildId) {
    const { rows } = await this.db.query(
      `WITH p AS (
         SELECT activated_at,first_full_month_start,
                COALESCE(timezone,'Asia/Riyadh') AS timezone
         FROM membership_role_policy
         WHERE guild_id=$1
       )
       SELECT
         activated_at,
         first_full_month_start,
         (
           date_trunc(
             'month',
             now() AT TIME ZONE timezone
           ) - interval '1 month'
         ) AT TIME ZONE timezone AS month_start,
         date_trunc(
           'month',
           now() AT TIME ZONE timezone
         ) AT TIME ZONE timezone AS month_end
       FROM p`,
      [String(guildId)]
    );

    const row = rows[0] ?? null;
    if (!row) return null;

    if (
      new Date(row.month_start).getTime() <
      new Date(row.first_full_month_start).getTime()
    ) {
      return null;
    }

    return row;
  }

  async monthlyEvaluationExists(guildId, monthStart) {
    const { rowCount } = await this.db.query(
      `SELECT 1
       FROM membership_monthly_rank_awards
       WHERE guild_id=$1 AND month_start=$2
       LIMIT 1`,
      [String(guildId), monthStart]
    );
    return rowCount > 0;
  }

  async evaluateClosedMonth(guild, roleMap) {
    const policy = await this.policy(guild.id);
    if (!policy?.monthly_roles_enabled) return null;

    const month = await this.getMonthToEvaluate(guild.id);
    if (!month) return null;

    if (
      await this.monthlyEvaluationExists(
        guild.id,
        month.month_start
      )
    ) {
      return month.month_start;
    }

    const { rows } = await this.db.query(
      `SELECT
         b.user_id,
         b.baseline_key,
         COALESCE(SUM(l.amount) FILTER (
           WHERE l.created_at >= $2
             AND l.created_at < $3
             AND l.amount > 0
             AND l.point_type <> 'admin_adjustment'
         ),0)::bigint AS points
       FROM membership_member_baselines b
       JOIN members m
         ON m.guild_id=b.guild_id
        AND m.user_id=b.user_id
        AND m.active=true
       LEFT JOIN membership_points_ledger l
         ON l.guild_id=b.guild_id
        AND l.user_id=b.user_id
       WHERE b.guild_id=$1
       GROUP BY b.user_id,b.baseline_key
       ORDER BY b.user_id`,
      [
        String(guild.id),
        month.month_start,
        month.month_end
      ]
    );

    for (const row of rows) {
      const points = Number(row.points || 0);
      const selected = roleForMonthlyPoints(
        points,
        String(row.baseline_key || 'ordinary')
      );

      if (
        selected.kind === 'rank' &&
        String(row.baseline_key || 'ordinary') === 'new'
      ) {
        await this.db.query(
          `UPDATE membership_member_baselines
           SET baseline_key='ordinary',updated_at=now()
           WHERE guild_id=$1 AND user_id=$2`,
          [String(guild.id), String(row.user_id)]
        );
      }

      await this.db.query(
        `INSERT INTO membership_monthly_rank_awards
         (guild_id,month_start,user_id,points,role_key,evaluated_at)
         VALUES($1,$2,$3,$4,$5,now())
         ON CONFLICT(guild_id,month_start,user_id)
         DO UPDATE SET
           points=EXCLUDED.points,
           role_key=EXCLUDED.role_key,
           evaluated_at=now()`,
        [
          String(guild.id),
          month.month_start,
          String(row.user_id),
          points,
          selected.key
        ]
      );

      const member =
        guild.members.cache.get(String(row.user_id)) ??
        null;

      if (member && !member.user?.bot) {
        await this.applyRoleKey(member, roleMap, selected.key);
      }
    }

    this.logger?.info?.('membership-monthly-role-evaluation-complete', {
      guildId: String(guild.id),
      monthStart: month.month_start,
      monthEnd: month.month_end,
      evaluatedMembers: rows.length
    });

    return month.month_start;
  }

  async reconcileCurrentRoles(guild, roleMap, policy) {
    const { rows: activeRows } = await this.db.query(
      `SELECT user_id
       FROM members
       WHERE guild_id=$1 AND active=true`,
      [String(guild.id)]
    );

    const activeIds = new Set(
      activeRows.map(row => String(row.user_id))
    );

    for (const member of guild.members.cache.values()) {
      if (member.user?.bot) continue;
      if (!activeIds.has(String(member.id))) continue;

      const baselineKey = await this.ensureBaselineForMember(
        guild,
        member,
        policy.activated_at
      );

      const award = await this.latestAwardForUser(
        guild.id,
        member.id
      );

      if (award?.role_key) {
        await this.applyRoleKey(member, roleMap, award.role_key);
      } else {
        await this.applyRoleKey(
          member,
          roleMap,
          baselineKey || 'ordinary'
        );
      }
    }
  }
  async sync(guild) {
    if (this.running) return;
    this.running = true;

    try {
      const policy = await this.policy(guild.id);
      if (!policy?.monthly_roles_enabled) return;

      const roleMap = await this.ensureRoles(guild);

      await this.cleanupLegacyRoleDuplicates(guild, roleMap);

      const { rows: activeRows } = await this.db.query(
        `SELECT user_id
         FROM members
         WHERE guild_id=$1 AND active=true`,
        [String(guild.id)]
      );

      const activeIds = new Set(
        activeRows.map(row => String(row.user_id))
      );

      for (const member of guild.members.cache.values()) {
        if (member.user?.bot) continue;
        if (!activeIds.has(String(member.id))) continue;

        await this.ensureBaselineForMember(
          guild,
          member,
          policy.activated_at
        );
      }

      await this.evaluateClosedMonth(guild, roleMap);
      await this.reconcileCurrentRoles(guild, roleMap, policy);

      this.logger?.info?.('membership-monthly-role-sync-complete', {
        guildId: String(guild.id),
        roleKeys: Object.keys(roleMap)
      });
    } catch (error) {
      this.logger?.error?.('membership-monthly-role-sync-failed', {
        guildId: String(guild?.id ?? ''),
        error: error?.stack ?? String(error)
      });
    } finally {
      this.running = false;
    }
  }
  async handleNewMember(member) {
    if (!member || member.user?.bot) return;

    const policy = await this.policy(member.guild.id);
    if (!policy?.monthly_roles_enabled) return;

    // تأكد من وجود المستخدم والعضوية قبل إنشاء baseline
    await this.db.query(
      `INSERT INTO users(id,username,display_name)
       VALUES($1,$2,$3)
       ON CONFLICT(id) DO UPDATE SET
         username=EXCLUDED.username,
         display_name=EXCLUDED.display_name,
         updated_at=now()`,
      [
        String(member.id),
        member.user.username,
        member.displayName ??
          member.user.globalName ??
          member.user.username
      ]
    );

    await this.db.query(
      `INSERT INTO members(guild_id,user_id,active)
       VALUES($1,$2,true)
       ON CONFLICT(guild_id,user_id) DO UPDATE SET active=true`,
      [String(member.guild.id), String(member.id)]
    );

    const roleMap = await this.ensureRoles(member.guild);
    await this.cleanupLegacyRoleDuplicates(member.guild, roleMap);

    const baselineKey = await this.ensureBaselineForMember(
      member.guild,
      member,
      policy.activated_at
    );

    const award = await this.latestAwardForUser(
      member.guild.id,
      member.id
    );

    await this.applyRoleKey(
      member,
      roleMap,
      award?.role_key || baselineKey || 'new'
    );
  }
  start(guild, intervalMs = 15 * 60 * 1000) {
    if (this.timer) return;

    const run = () =>
      this.sync(guild).catch(error => {
        this.logger?.error?.('membership-monthly-role-sync-unhandled', {
          guildId: String(guild?.id ?? ''),
          error: error?.stack ?? String(error)
        });
      });

    run();
    this.timer = setInterval(run, intervalMs);
    this.timer.unref?.();

    this.logger?.info?.('membership-monthly-role-sync-started', {
      guildId: String(guild?.id ?? ''),
      intervalMinutes: Math.round(intervalMs / 60000)
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
