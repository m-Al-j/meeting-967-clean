const LEVELS = Object.freeze([
  { min: 0, key: 'new', label: 'مبتدئ', emoji: '🌱', roleColor: 0x7F8C8D },
  { min: 100, key: 'participant', label: 'مشارك', emoji: '🔹', roleColor: 0x3498DB },
  { min: 250, key: 'engaged', label: 'عضو متفاعل', emoji: '⚡', roleColor: 0x2ECC71 },
  { min: 500, key: 'active', label: 'عضو فاعل', emoji: '⭐', roleColor: 0xE67E22 },
  { min: 1000, key: 'distinguished', label: 'عضو متميز', emoji: '👑', roleColor: 0x9B59B6 },
]);

const WEEKLY_ROLE = Object.freeze({
  key: 'weekly',
  name: '🏆 عضو الأسبوع',
  color: 0xD4AF37,
});

export const ACHIEVEMENTS = Object.freeze([
  { key: 'points-100', label: 'بداية قوية', description: 'بلوغ 100 نقطة' },
  { key: 'points-500', label: 'عضو فاعل', description: 'بلوغ 500 نقطة' },
  { key: 'task-finisher-3', label: 'منجز', description: 'إتمام 3 مهام معتمدة' },
  { key: 'meeting-regular-5', label: 'ملتزم بالحضور', description: 'حضور 5 اجتماعات مؤهلة' },
  { key: 'supporter-3', label: 'مساند فعّال', description: 'تحقيق 3 أنشطة موثقة في فريق مساند' },
]);

export function levelForPoints(value=0) {
  const points=Number(value)||0;
  let current=LEVELS[0];
  for(const level of LEVELS) {
    if(points>=level.min) current=level;
    else break;
  }
  return current;
}

export class PointsService {
  constructor({db,audit,env,logger}) {
    Object.assign(this,{db,audit,env,logger});
    this.discordRoleSyncTimer=null;
    this.discordRoleSyncRunning=false;
  }

  async rules(guildId) {
    const {rows}=await this.db.query(`
      SELECT rule_key,points,enabled,description_ar
      FROM membership_point_rules
      WHERE guild_id=$1
      ORDER BY rule_key
    `,[guildId]);
    return Object.fromEntries(rows.map(x=>[
      x.rule_key,{points:Number(x.points),enabled:x.enabled,description:x.description_ar}
    ]));
  }

  async award({
    guildId,userId,amount,pointType='admin_adjustment',sourceType='admin',
    sourceId=null,teamId=null,assignmentType=null,eventKey,reason='تعديل نقاط',
    actorId=null,metadata={}
  }) {
    const value=Math.trunc(Number(amount));
    if(!Number.isFinite(value)||value===0) throw new Error('Invalid points amount');
    const key=String(eventKey||`manual:${guildId}:${userId}:${Date.now()}:${Math.random()}`);

    const {rows}=await this.db.query(`
      SELECT meeting967_add_points(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb
      ) AS id
    `,[
      guildId,userId,value,pointType,sourceType,sourceId,teamId,
      assignmentType,key,reason,actorId,JSON.stringify(metadata||{})
    ]);

    await this.audit?.log?.({
      guildId,actorId,action:'rewards.points.add',
      targetType:'user',targetId:String(userId),
      newValue:{amount:value,pointType,sourceType,sourceId,teamId,assignmentType,eventKey:key,reason}
    }).catch(()=>{});

    return rows[0]?.id||null;
  }

  async profile(guildId,userId) {
    await this.db.query(`
      INSERT INTO membership_point_balances(guild_id,user_id,balance)
      VALUES($1,$2,0)
      ON CONFLICT(guild_id,user_id) DO NOTHING
    `,[guildId,userId]);

    const [balanceRows,periodRows,taskRows,attendanceRows,supportRows,achievementRows]=await Promise.all([
      this.db.query(`
        SELECT balance
        FROM membership_point_balances
        WHERE guild_id=$1 AND user_id=$2
      `,[guildId,userId]),
      this.db.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE created_at>=now()-interval '7 days'),0)::bigint weekly_points,
          COALESCE(SUM(amount) FILTER (WHERE created_at>=date_trunc('month',now())),0)::bigint monthly_points
        FROM membership_points_ledger
        WHERE guild_id=$1 AND user_id=$2
      `,[guildId,userId]),
      this.db.query(`
        SELECT
          COUNT(*) FILTER (WHERE review_status='approved')::int completed_tasks,
          COUNT(*) FILTER (WHERE review_status='submitted')::int pending_tasks
        FROM meeting_tasks
        WHERE guild_id=$1 AND assignee_user_id=$2
      `,[guildId,userId]),
      this.db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('present','late'))::int attended_meetings,
          COUNT(*) FILTER (WHERE status IN ('present','late') AND updated_at>=now()-interval '7 days')::int attended_this_week
        FROM attendance a
        WHERE a.user_id=$1
          AND EXISTS(
            SELECT 1 FROM meetings m
            WHERE m.id=a.meeting_id AND m.guild_id=$2 AND m.status='ended' AND COALESCE(m.is_test,false)=false
          )
      `,[userId,guildId]),
      this.db.query(`
        SELECT COUNT(*)::int support_activities
        FROM membership_points_ledger
        WHERE guild_id=$1 AND user_id=$2
          AND assignment_type='support'
          AND point_type IN ('attendance','task_completion','early_task','support_contribution','team_contribution')
      `,[guildId,userId]),
      this.db.query(`
        SELECT achievement_key,earned_at,metadata
        FROM membership_achievements
        WHERE guild_id=$1 AND user_id=$2
        ORDER BY earned_at DESC
      `,[guildId,userId]),
    ]);

    const balance=Number(balanceRows.rows[0]?.balance||0);
    const level=levelForPoints(balance);
    const period=periodRows.rows[0]||{};
    const tasks=taskRows.rows[0]||{};
    const attendance=attendanceRows.rows[0]||{};
    const support=Number(supportRows.rows[0]?.support_activities||0);

    await this.refreshAchievements(guildId,userId,{
      balance,
      completedTasks:Number(tasks.completed_tasks||0),
      attendedMeetings:Number(attendance.attended_meetings||0),
      supportActivities:support
    });

    const refreshed=await this.db.query(`
      SELECT achievement_key,earned_at,metadata
      FROM membership_achievements
      WHERE guild_id=$1 AND user_id=$2
      ORDER BY earned_at DESC
    `,[guildId,userId]);

    return {
      balance,
      weeklyPoints:Number(period.weekly_points||0),
      monthlyPoints:Number(period.monthly_points||0),
      level,
      completedTasks:Number(tasks.completed_tasks||0),
      pendingTasks:Number(tasks.pending_tasks||0),
      attendedMeetings:Number(attendance.attended_meetings||0),
      attendedThisWeek:Number(attendance.attended_this_week||0),
      supportActivities:support,
      achievements:refreshed.rows,
      achievementDefinitions:ACHIEVEMENTS,
    };
  }

  async refreshAchievements(guildId,userId,stats) {
    const unlocked=[];
    if(stats.balance>=100) unlocked.push('points-100');
    if(stats.balance>=500) unlocked.push('points-500');
    if(stats.completedTasks>=3) unlocked.push('task-finisher-3');
    if(stats.attendedMeetings>=5) unlocked.push('meeting-regular-5');
    if(stats.supportActivities>=3) unlocked.push('supporter-3');

    for(const key of unlocked) {
      await this.db.query(`
        INSERT INTO membership_achievements(id,guild_id,user_id,achievement_key,metadata)
        VALUES(gen_random_uuid(),$1,$2,$3,$4::jsonb)
        ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING
      `,[guildId,userId,key,JSON.stringify({earnedFrom:'automatic-points-profile-v1'})]);
    }
    return unlocked;
  }


  async ensureRankRole(guild,definition) {
    const desiredName = definition.roleName ?? (definition.emoji + ' ' + definition.label);
    let role;

    const { rows } = await this.db.query(
      `SELECT role_id
       FROM membership_rank_roles
       WHERE guild_id=$1 AND role_key=$2`,
      [String(guild.id), String(definition.key)]
    );

    if (rows[0]?.role_id) {
      role = guild.roles.cache.get(String(rows[0].role_id))
        ?? await guild.roles.fetch(String(rows[0].role_id)).catch(() => null);
    }

    if (!role) {
      role = [...guild.roles.cache.values()]
        .find(r => !r.managed && r.name === desiredName) ?? null;
    }

    if (!role) {
      role = await guild.roles.create({
        name: desiredName,
        color: definition.roleColor,
        hoist: false,
        mentionable: false,
        reason: 'Meeting 967 — Membership level roles'
      });
    } else if (role.name !== desiredName || role.color !== definition.roleColor) {
      await role.edit({
        name: desiredName,
        color: definition.roleColor,
        reason: 'Meeting 967 — Membership level role alignment'
      }).catch(() => null);
    }

    await this.db.query(
      `INSERT INTO membership_rank_roles
       (guild_id,role_key,role_id,role_name,role_color,role_kind)
       VALUES($1,$2,$3,$4,$5,'level')
       ON CONFLICT(guild_id,role_key)
       DO UPDATE SET
         role_id=EXCLUDED.role_id,
         role_name=EXCLUDED.role_name,
         role_color=EXCLUDED.role_color,
         role_kind='level',
         updated_at=now()`,
      [
        String(guild.id),
        String(definition.key),
        String(role.id),
        desiredName,
        Number(definition.roleColor)
      ]
    );

    return role;
  }

  async ensureWeeklyRole(guild) {
    let role;

    const { rows } = await this.db.query(
      `SELECT role_id
       FROM membership_rank_roles
       WHERE guild_id=$1 AND role_key=$2`,
      [String(guild.id), WEEKLY_ROLE.key]
    );

    if (rows[0]?.role_id) {
      role = guild.roles.cache.get(String(rows[0].role_id))
        ?? await guild.roles.fetch(String(rows[0].role_id)).catch(() => null);
    }

    if (!role) {
      role = [...guild.roles.cache.values()]
        .find(r => !r.managed && r.name === WEEKLY_ROLE.name) ?? null;
    }

    if (!role) {
      role = await guild.roles.create({
        name: WEEKLY_ROLE.name,
        color: WEEKLY_ROLE.color,
        hoist: false,
        mentionable: false,
        reason: 'Meeting 967 — Weekly member honor'
      });
    } else if (role.name !== WEEKLY_ROLE.name || role.color !== WEEKLY_ROLE.color) {
      await role.edit({
        name: WEEKLY_ROLE.name,
        color: WEEKLY_ROLE.color,
        reason: 'Meeting 967 — Weekly member honor alignment'
      }).catch(() => null);
    }

    await this.db.query(
      `INSERT INTO membership_rank_roles
       (guild_id,role_key,role_id,role_name,role_color,role_kind)
       VALUES($1,$2,$3,$4,$5,'weekly')
       ON CONFLICT(guild_id,role_key)
       DO UPDATE SET
         role_id=EXCLUDED.role_id,
         role_name=EXCLUDED.role_name,
         role_color=EXCLUDED.role_color,
         role_kind='weekly',
         updated_at=now()`,
      [
        String(guild.id),
        WEEKLY_ROLE.key,
        String(role.id),
        WEEKLY_ROLE.name,
        Number(WEEKLY_ROLE.color)
      ]
    );

    return role;
  }

  async syncDiscordRoles(guild) {
    if (!guild?.id || this.discordRoleSyncRunning) return;
    this.discordRoleSyncRunning=true;

    try {
      await guild.roles.fetch().catch(() => null);

      const levelRoles = new Map();
      for (const level of LEVELS) {
        levelRoles.set(level.key, await this.ensureRankRole(guild,level));
      }

      const weeklyRole = await this.ensureWeeklyRole(guild);

      const { rows: memberRows } = await this.db.query(
        `SELECT m.user_id,COALESCE(b.balance,0)::bigint AS balance
         FROM members m
         LEFT JOIN membership_point_balances b
           ON b.guild_id=m.guild_id AND b.user_id=m.user_id
         WHERE m.guild_id=$1 AND m.active=true
         ORDER BY m.user_id`,
        [String(guild.id)]
      );

      for (const row of memberRows) {
        const member = guild.members.cache.get(String(row.user_id))
          ?? await guild.members.fetch(String(row.user_id)).catch(() => null);
        if (!member || member.user?.bot) continue;

        const level = levelForPoints(Number(row.balance));
        const target = levelRoles.get(level.key);
        if (!target) continue;

        for (const role of levelRoles.values()) {
          if (String(role.id) !== String(target.id) &&
              member.roles.cache.has(String(role.id))) {
            await member.roles.remove(
              String(role.id),
              'Meeting 967 — Membership level update'
            ).catch(() => null);
          }
        }

        if (!member.roles.cache.has(String(target.id))) {
          await member.roles.add(
            String(target.id),
            'Meeting 967 — Membership level update'
          ).catch(() => null);
        }
      }

      const { rows: winnerRows } = await this.db.query(
        `SELECT user_id,SUM(amount)::bigint AS points
         FROM membership_points_ledger
         WHERE guild_id=$1
           AND created_at >= date_trunc('week', now())
           AND amount > 0
           AND point_type <> 'admin_adjustment'
         GROUP BY user_id
         ORDER BY points DESC, MIN(created_at) ASC, user_id ASC
         LIMIT 1`,
        [String(guild.id)]
      );

      const winner = winnerRows[0] ?? null;

      const weeklyMembers = guild.members.cache.filter(
        member => member.roles.cache.has(String(weeklyRole.id))
      );

      for (const member of weeklyMembers.values()) {
        if (!winner || String(member.id) !== String(winner.user_id)) {
          await member.roles.remove(
            String(weeklyRole.id),
            'Meeting 967 — Weekly member rotation'
          ).catch(() => null);
        }
      }

      if (winner) {
        const winnerMember = guild.members.cache.get(String(winner.user_id))
          ?? await guild.members.fetch(String(winner.user_id)).catch(() => null);

        if (winnerMember && !winnerMember.user?.bot) {
          if (!winnerMember.roles.cache.has(String(weeklyRole.id))) {
            await winnerMember.roles.add(
              String(weeklyRole.id),
              'Meeting 967 — Weekly member rotation'
            ).catch(() => null);
          }

          const weekRow = await this.db.query(
            `SELECT date_trunc('week', now()) AS week_start`
          );

          await this.db.query(
            `INSERT INTO membership_weekly_honors
             (guild_id,week_start,user_id,points)
             VALUES($1,$2,$3,$4)
             ON CONFLICT(guild_id,week_start)
             DO UPDATE SET
               user_id=EXCLUDED.user_id,
               points=EXCLUDED.points,
               awarded_at=now()`,
            [
              String(guild.id),
              weekRow.rows[0]?.week_start,
              String(winner.user_id),
              Number(winner.points || 0)
            ]
          );
        }
      }

      this.logger?.info?.('membership-rank-role-sync-complete',{
        guildId:String(guild.id),
        managedMembers:memberRows.length,
        levels:LEVELS.map(x=>({key:x.key,label:x.label,min:x.min})),
        weeklyWinner:winner?.user_id ? String(winner.user_id) : null,
        weeklyPoints:Number(winner?.points || 0)
      });
    } catch (error) {
      this.logger?.error?.('membership-rank-role-sync-failed',{
        guildId:String(guild.id),
        error:error?.stack??String(error)
      });
    } finally {
      this.discordRoleSyncRunning=false;
    }
  }

  startDiscordRoleSync(guild,intervalMs=15*60*1000) {
    if (this.discordRoleSyncTimer) return;

    const run=()=>this.syncDiscordRoles(guild).catch(error=>{
      this.logger?.error?.('membership-rank-role-sync-unhandled',{
        guildId:String(guild?.id??''),
        error:error?.stack??String(error)
      });
    });

    run();
    this.discordRoleSyncTimer=setInterval(run,intervalMs);
    this.discordRoleSyncTimer.unref?.();

    this.logger?.info?.('membership-rank-role-sync-started',{
      guildId:String(guild?.id??''),
      intervalMinutes:Math.round(intervalMs/60000)
    });
  }

  async recent(guildId,userId,limit=10) {
    const {rows}=await this.db.query(`
      SELECT amount,point_type,source_type,source_id,team_id,assignment_type,reason,created_at
      FROM membership_points_ledger
      WHERE guild_id=$1 AND user_id=$2
      ORDER BY created_at DESC
      LIMIT $3
    `,[guildId,userId,limit]);
    return rows;
  }
}
