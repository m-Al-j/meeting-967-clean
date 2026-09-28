import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AppError } from '../../../core/errors/AppError.js';
import { withTransaction } from '../../../infrastructure/db/pool.js';
import { guildMemberOptions } from '../guildPicker.js';
import { filterMemberOptions } from '../memberSearch.js';

const HOME_PAGE_SIZE = 20;
const managerDraftKey = (subject) => `team-manager:${String(subject.guildId)}:${String(subject.userId)}`;

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function ownerOnly(app, subject) {
  if (!app?.permissionService?.isOwner?.(String(subject.userId))) {
    throw new AppError('OWNER_ONLY', 'إدارة مسؤولي الفرق متاحة لمالك النظام فقط.');
  }
}

async function updateInteraction(i, payload) {
  if (!i.deferred && !i.replied) await i.deferUpdate();
  return i.editReply(payload);
}

async function getTeams(app, guildId) {
  const { rows } = await app.db.query(`
    SELECT t.id,t.name,tm.user_id AS manager_user_id
    FROM teams t
    LEFT JOIN team_managers tm
      ON tm.team_id=t.id AND tm.guild_id=t.guild_id
    WHERE t.guild_id=$1
      AND t.active=true
      AND t.deleted_at IS NULL
    ORDER BY t.name
  `, [String(guildId)]);
  return rows;
}

async function getTeam(app, teamId, guildId) {
  const { rows } = await app.db.query(`
    SELECT id,name,guild_id,active,deleted_at
    FROM teams
    WHERE id=$1 AND guild_id=$2 AND active=true AND deleted_at IS NULL
    LIMIT 1
  `, [String(teamId), String(guildId)]);
  return rows[0] ?? null;
}

async function getCurrentManager(app, teamId, guildId) {
  const { rows } = await app.db.query(`
    SELECT user_id
    FROM team_managers
    WHERE team_id=$1 AND guild_id=$2
    LIMIT 1
  `, [String(teamId), String(guildId)]);
  return rows[0]?.user_id ? String(rows[0].user_id) : null;
}

async function isActiveTeamMember(app, teamId, guildId, userId) {
  const { rowCount } = await app.db.query(`
    SELECT 1
    FROM team_members
    WHERE team_id=$1 AND guild_id=$2 AND user_id=$3 AND active=true
    LIMIT 1
  `, [String(teamId), String(guildId), String(userId)]);
  return rowCount > 0;
}

async function memberLabel(subject, userId) {
  const id = String(userId);
  const member = subject.guild?.members?.cache?.get(id)
    ?? await subject.guild?.members?.fetch(id).catch(() => null);
  if (!member) return `<@${id}>`;
  const username = member.user?.username ? `@${member.user.username}` : id;
  return `${member.displayName ?? member.user?.globalName ?? username} (${username})`;
}

async function home(i, app, subject, page = 0) {
  ownerOnly(app, subject);
  app.drafts.delete(managerDraftKey(subject));
  const teams = await getTeams(app, subject.guildId);
  const pages = Math.max(1, Math.ceil(teams.length / HOME_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(Number(page) || 0, pages - 1));
  const slice = teams.slice(safePage * HOME_PAGE_SIZE, (safePage + 1) * HOME_PAGE_SIZE);

  const components = [];
  if (slice.length) {
    components.push(row(
      new StringSelectMenuBuilder()
        .setCustomId('perm:team-manager-team')
        .setPlaceholder(`اختر الفريق — ${safePage + 1}/${pages}`)
        .addOptions(slice.map((team) => ({
          label: String(team.name).slice(0, 100),
          description: team.manager_user_id
            ? `المسؤول: <@${team.manager_user_id}>`.slice(0, 100)
            : 'لا يوجد مسؤول حالي',
          value: String(team.id),
        }))),
    ));
  }

  const pager = [];
  if (safePage > 0) pager.push(button(`perm:team-manager-page:${safePage - 1}`, 'السابق', ButtonStyle.Secondary));
  if (safePage + 1 < pages) pager.push(button(`perm:team-manager-page:${safePage + 1}`, 'التالي', ButtonStyle.Secondary));
  if (pager.length) components.push(row(...pager));

  components.push(row(button('admin:permissions', 'العودة إلى مركز الصلاحيات', ButtonStyle.Primary)));

  return updateInteraction(i, {
    content:
      `**مسؤولو الفرق**\n\n` +
      `من هنا يتم تعيين أو تغيير أو إزالة مسؤول كل فريق.\n` +
      `المسؤول يحصل تلقائيًا على حزمة الصلاحيات التشغيلية لذلك الفريق فقط.\n\n` +
      `الصفحة **${safePage + 1}/${pages}** • إجمالي الفرق: **${teams.length}**`,
    embeds: [],
    components,
  });
}

async function teamPage(i, app, subject, teamId, results = null, query = '') {
  ownerOnly(app, subject);
  const team = await getTeam(app, teamId, subject.guildId);
  if (!team) throw new AppError('TEAM_NOT_FOUND', 'الفريق غير موجود أو غير نشط.');

  const currentManager = await getCurrentManager(app, team.id, subject.guildId);
  app.drafts.set(managerDraftKey(subject), {
    teamId: String(team.id),
    guildId: String(subject.guildId),
    managerUserId: currentManager,
  });

  const components = [];
  if (Array.isArray(results)) {
    if (results.length) {
      components.push(row(
        new StringSelectMenuBuilder()
          .setCustomId('perm:team-manager-search-result')
          .setPlaceholder('اختر العضو لتعيينه مسؤولًا')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(results.slice(0, 25).map((m) => ({
            label: String(m.label ?? m.displayName ?? m.username ?? m.value).slice(0, 100),
            description: String(m.description ?? '').slice(0, 100) || 'عضو نشط في الفريق',
            value: String(m.value ?? m.id),
          }))),
      ));
    }
  }

  components.push(row(
    button('perm:team-manager-search', currentManager ? '🔎 تغيير مسؤول الفريق' : '🔎 تعيين مسؤول الفريق', ButtonStyle.Primary),
  ));

  if (currentManager) {
    components.push(row(
      button('perm:team-manager-revoke', 'إزالة مسؤول الفريق', ButtonStyle.Danger),
    ));
  }

  components.push(row(button('perm:team-manager-home', 'العودة', ButtonStyle.Secondary)));

  const currentLabel = currentManager ? await memberLabel(subject, currentManager) : 'لا يوجد مسؤول حالي';
  const resultText = Array.isArray(results)
    ? `\n\nنتائج البحث${query ? ` عن: **${String(query).slice(0, 60)}**` : ''}: **${results.length}** عضو متاح.`
    : '';

  return updateInteraction(i, {
    content:
      `**مسؤول الفريق: ${String(team.name).slice(0, 80)}**\n\n` +
      `المسؤول الحالي: **${currentLabel}**\n\n` +
      `ابحث بالاسم أو اليوزر ثم اختر العضو.\n` +
      `يشترط أن يكون الشخص عضوًا نشطًا داخل هذا الفريق، ويتم التحقق من ذلك من قاعدة البيانات قبل الحفظ.` +
      resultText,
    embeds: [],
    components,
  });
}

async function searchModal(i, app, subject) {
  ownerOnly(app, subject);
  const draft = app.drafts.get(managerDraftKey(subject));
  if (!draft?.teamId) throw new AppError('DRAFT_EXPIRED', 'انتهت جلسة مسؤول الفريق. ابدأ من جديد.');

  const modal = new ModalBuilder()
    .setCustomId('perm:team-manager-search-modal')
    .setTitle('البحث عن عضو');

  const input = new TextInputBuilder()
    .setCustomId('query')
    .setLabel('الاسم أو اليوزرنيم')
    .setPlaceholder('مثال: محمد أو @username')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(row(input));
  return i.showModal(modal);
}

async function searchMembers(i, app, subject, teamId, query) {
  const q = String(query ?? '').trim();
  if (!q) throw new AppError('EMPTY_SEARCH', 'اكتب اسمًا أو يوزرنيم للبحث.');

  const teamMembers = await app.teams.members(teamId);
  const teamMemberIds = new Set(teamMembers.map((m) => String(m.user_id)));
  const options = (await guildMemberOptions(subject.guild, { includeBots: false }))
    .filter((option) => teamMemberIds.has(String(option.value)));
  const filtered = filterMemberOptions(options, q).slice(0, 25);

  return teamPage(i, app, subject, teamId, filtered, q);
}

async function confirmAssign(i, app, subject) {
  ownerOnly(app, subject);
  const draft = app.drafts.get(managerDraftKey(subject));
  if (!draft?.teamId || !draft?.managerUserId) {
    throw new AppError('DRAFT_EXPIRED', 'انتهت جلسة التعيين. ابدأ من جديد.');
  }

  const team = await getTeam(app, draft.teamId, subject.guildId);
  if (!team) throw new AppError('TEAM_NOT_FOUND', 'الفريق غير موجود أو غير نشط.');

  if (!(await isActiveTeamMember(app, team.id, subject.guildId, draft.managerUserId))) {
    throw new AppError('NOT_ACTIVE_TEAM_MEMBER', 'لا يمكن تعيين هذا الشخص لأنه ليس عضوًا نشطًا في الفريق.');
  }

  const selectedLabel = await memberLabel(subject, draft.managerUserId);
  const currentManager = await getCurrentManager(app, team.id, subject.guildId);
  if (currentManager === String(draft.managerUserId)) {
    return updateInteraction(i, {
      content: `ℹ️ **${selectedLabel}** هو المسؤول الحالي لهذا الفريق بالفعل.`,
      embeds: [],
      components: [row(button('perm:team-manager-home', 'العودة', ButtonStyle.Primary))],
    });
  }

  return updateInteraction(i, {
    content:
      `**تأكيد تعيين مسؤول الفريق**\n\n` +
      `الفريق: **${String(team.name).slice(0, 100)}**\n` +
      `المسؤول الجديد: **${selectedLabel}**\n` +
      `المسؤول الحالي: **${currentManager ? `<@${currentManager}>` : 'لا يوجد'}**\n\n` +
      `سيتم استبدال المسؤول الحالي بهذا الشخص، وتُطبَّق حزمة مسؤول الفريق ضمن نطاق هذا الفريق فقط.`,
    embeds: [],
    components: [
      row(
        button('perm:team-manager-assign', '✅ تأكيد التعيين', ButtonStyle.Success),
        button('perm:team-manager-home', 'إلغاء', ButtonStyle.Secondary),
      ),
    ],
  });
}

async function assignManager(i, app, subject) {
  ownerOnly(app, subject);
  const draft = app.drafts.get(managerDraftKey(subject));
  if (!draft?.teamId || !draft?.managerUserId) {
    throw new AppError('DRAFT_EXPIRED', 'انتهت جلسة التعيين. ابدأ من جديد.');
  }

  const team = await getTeam(app, draft.teamId, subject.guildId);
  if (!team) throw new AppError('TEAM_NOT_FOUND', 'الفريق غير موجود أو غير نشط.');
  const userId = String(draft.managerUserId);

  if (!(await isActiveTeamMember(app, team.id, subject.guildId, userId))) {
    throw new AppError('NOT_ACTIVE_TEAM_MEMBER', 'لا يمكن تعيين هذا الشخص لأنه ليس عضوًا نشطًا في الفريق.');
  }

  const member = subject.guild?.members?.cache?.get(userId)
    ?? await subject.guild?.members?.fetch(userId).catch(() => null);
  if (!member || member.user?.bot) {
    throw new AppError('INVALID_MANAGER', 'لا يمكن تعيين حساب بوت أو عضو غير متاح من السيرفر.');
  }

  const previousManager = await getCurrentManager(app, team.id, subject.guildId);

  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO team_managers(team_id,guild_id,user_id,assigned_by,assigned_at,updated_at)
      VALUES($1,$2,$3,$4,NOW(),NOW())
      ON CONFLICT (team_id)
      DO UPDATE SET
        guild_id=EXCLUDED.guild_id,
        user_id=EXCLUDED.user_id,
        assigned_by=EXCLUDED.assigned_by,
        updated_at=NOW()
    `, [team.id, subject.guildId, userId, subject.userId]);

    await app.audit.log({
      guildId: subject.guildId,
      actorId: subject.userId,
      action: previousManager ? 'team.manager.changed' : 'team.manager.assigned',
      targetType: 'team',
      targetId: String(team.id),
      oldValue: { managerUserId: previousManager },
      newValue: { managerUserId: userId },
      metadata: { teamName: team.name },
    }, client);
  });

  app.permissions?.touchRevision?.();
  app.drafts.delete(managerDraftKey(subject));
  return teamPage(i, app, subject, team.id);
}

async function confirmRevoke(i, app, subject) {
  ownerOnly(app, subject);
  const draft = app.drafts.get(managerDraftKey(subject));
  if (!draft?.teamId) throw new AppError('DRAFT_EXPIRED', 'انتهت جلسة مسؤول الفريق. ابدأ من جديد.');

  const team = await getTeam(app, draft.teamId, subject.guildId);
  if (!team) throw new AppError('TEAM_NOT_FOUND', 'الفريق غير موجود أو غير نشط.');
  const currentManager = await getCurrentManager(app, team.id, subject.guildId);
  if (!currentManager) return teamPage(i, app, subject, team.id);

  const currentLabel = await memberLabel(subject, currentManager);
  return updateInteraction(i, {
    content:
      `**تأكيد إزالة مسؤول الفريق**\n\n` +
      `الفريق: **${String(team.name).slice(0, 100)}**\n` +
      `المسؤول الحالي: **${currentLabel}**\n\n` +
      `بعد الإزالة لن يكون للفريق مسؤول مخصص، وستتوقف عنه حزمة صلاحيات مسؤول الفريق.`,
    embeds: [],
    components: [
      row(
        button('perm:team-manager-revoke-confirm', '⛔ نعم، إزالة المسؤول', ButtonStyle.Danger),
        button('perm:team-manager-home', 'إلغاء', ButtonStyle.Secondary),
      ),
    ],
  });
}

async function revokeManager(i, app, subject) {
  ownerOnly(app, subject);
  const draft = app.drafts.get(managerDraftKey(subject));
  if (!draft?.teamId) throw new AppError('DRAFT_EXPIRED', 'انتهت جلسة مسؤول الفريق. ابدأ من جديد.');

  const team = await getTeam(app, draft.teamId, subject.guildId);
  if (!team) throw new AppError('TEAM_NOT_FOUND', 'الفريق غير موجود أو غير نشط.');
  const previousManager = await getCurrentManager(app, team.id, subject.guildId);
  if (!previousManager) return teamPage(i, app, subject, team.id);

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM team_managers WHERE team_id=$1 AND guild_id=$2`, [team.id, subject.guildId]);
    await app.audit.log({
      guildId: subject.guildId,
      actorId: subject.userId,
      action: 'team.manager.removed',
      targetType: 'team',
      targetId: String(team.id),
      oldValue: { managerUserId: previousManager },
      newValue: { managerUserId: null },
      metadata: { teamName: team.name },
    }, client);
  });

  app.permissions?.touchRevision?.();
  app.drafts.delete(managerDraftKey(subject));
  return teamPage(i, app, subject, team.id);
}

export async function handleTeamManagers(i, app, subject) {
  ownerOnly(app, subject);
  const id = String(i.customId ?? '');

  if (id === 'perm:team-manager-home') return home(i, app, subject);
  if (id.startsWith('perm:team-manager-page:')) return home(i, app, subject, Number(id.split(':')[2] ?? 0));

  if (id === 'perm:team-manager-team') {
    const teamId = String(i.values?.[0] ?? '');
    if (!teamId) throw new AppError('TEAM_NOT_SELECTED', 'اختر فريقًا أولًا.');
    return teamPage(i, app, subject, teamId);
  }

  if (id === 'perm:team-manager-search') return searchModal(i, app, subject);

  if (id === 'perm:team-manager-search-modal' && i.isModalSubmit?.()) {
    const draft = app.drafts.get(managerDraftKey(subject));
    if (!draft?.teamId) throw new AppError('DRAFT_EXPIRED', 'انتهت جلسة البحث. ابدأ من جديد.');
    const query = i.fields.getTextInputValue('query');
    return searchMembers(i, app, subject, draft.teamId, query);
  }

  if (id === 'perm:team-manager-search-result') {
    const draft = app.drafts.get(managerDraftKey(subject));
    if (!draft?.teamId) throw new AppError('DRAFT_EXPIRED', 'انتهت جلسة الاختيار. ابدأ من جديد.');
    const userId = String(i.values?.[0] ?? '');
    if (!/^\d+$/.test(userId)) throw new AppError('MEMBER_NOT_SELECTED', 'العضو المحدد غير صالح.');
    if (!(await isActiveTeamMember(app, draft.teamId, subject.guildId, userId))) {
      throw new AppError('NOT_ACTIVE_TEAM_MEMBER', 'العضو المحدد ليس عضوًا نشطًا في الفريق.');
    }
    draft.managerUserId = userId;
    app.drafts.set(managerDraftKey(subject), draft);
    return confirmAssign(i, app, subject);
  }

  if (id === 'perm:team-manager-assign') return assignManager(i, app, subject);
  if (id === 'perm:team-manager-revoke') return confirmRevoke(i, app, subject);
  if (id === 'perm:team-manager-revoke-confirm') return revokeManager(i, app, subject);

  return false;
}
