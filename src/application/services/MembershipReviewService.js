import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { withTransaction } from '../../infrastructure/db/pool.js';
import { AppError } from '../../core/errors/AppError.js';
import { operationalDmDeliveryEnabled } from './memberDeliveryControl.js';
import { renderMembershipManagementReport } from './MembershipReportRenderer.js';

const CHOICES = Object.freeze({ CONTINUE: 'continue', FREEZE: 'freeze', WITHDRAW: 'withdraw' });
const STATUS = Object.freeze({ PENDING: 'pending', ACTIVE: 'active', COMPLETED: 'completed', INVALID: 'invalid' });
const CHOICE_AR = Object.freeze({ continue: 'استمرار العضوية', freeze: 'تجميد العضوية', withdraw: 'الانسحاب من العضوية' });
const STATUS_AR = Object.freeze({ pending: 'مجدول', active: 'تجميد فعّال', completed: 'مكتمل', invalid: 'تعذر التطبيق' });
const DEFAULT_FROZEN_ROLE = 'غير مفعل';
const DEFAULT_TEAM_ROLE_NAMES = Object.freeze(['الموارد البشرية','الفريق الإعلامي','الفريق التنفيذي','التقنية والبحث','الاداره والحوكمة']);

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function validId(value) { return /^\d{15,22}$/.test(String(value ?? '')); }
function normalizeRoleName(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, '');
}
function unix(value) { return Math.floor(new Date(value).getTime() / 1000); }

export function parseMembershipDate(input, zone) {
  const raw = clean(input, 80);
  if (!raw) throw new AppError('INVALID_DATE', 'أدخل التاريخ والوقت.');
  if (raw === 'الان' || raw === 'الآن') return DateTime.now().setZone(zone);
  for (const format of ['yyyy-MM-dd HH:mm', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd']) {
    const parsed = DateTime.fromFormat(raw, format, { zone, locale: 'en' });
    if (parsed.isValid) return parsed;
  }
  throw new AppError('INVALID_DATE', 'صيغة التاريخ غير صحيحة. استخدم YYYY-MM-DD HH:mm.');
}

export class MembershipReviewService {
  constructor({ db, audit, env, logger }) {
    Object.assign(this, { db, audit, env, logger });
    this.timer = null;
    this.running = false;
    this.guild = null;
  }

  async getSettings(guildId) {
    const { rows } = await this.db.query(
      `SELECT guild_id,membership_role_id,frozen_role_id,hr_role_id,updated_by,updated_at
       FROM membership_settings WHERE guild_id=$1`,
      [String(guildId)],
    );
    return rows[0] ?? null;
  }
  async canManage(subject) {
    if (!subject) return false;
    if (String(subject.userId) === String(this.env.OWNER_USER_ID)) return true;

    let settings = await this.getSettings(subject.guildId).catch(() => null);
    let hrRoleId = settings?.hr_role_id ? String(settings.hr_role_id) : null;
    const guild = subject.guild ?? this.guild ?? null;

    await guild?.roles?.fetch?.().catch(() => null);

    if (!hrRoleId && guild?.roles?.cache) {
      const hrRole=[...guild.roles.cache.values()].find(
        role=>normalizeRoleName(role.name)===normalizeRoleName('الموارد البشرية')
      );
      const generalRole=[...guild.roles.cache.values()].find(
        role=>normalizeRoleName(role.name)===normalizeRoleName('عضوية عامة')
      );

      const hasHrRole=Boolean(
        hrRole && (
          subject.member?.roles?.cache?.has?.(String(hrRole.id)) ||
          (Array.isArray(subject.roleIds) &&
           subject.roleIds.some(id=>String(id)===String(hrRole.id)))
        )
      );

      if(hasHrRole){
        hrRoleId=String(hrRole.id);

        await this.db.query(
          `INSERT INTO membership_settings(
             guild_id,membership_role_id,hr_role_id,updated_by,updated_at
           )
           VALUES($1,$2,$3,$4,now())
           ON CONFLICT(guild_id) DO UPDATE SET
             membership_role_id=COALESCE(EXCLUDED.membership_role_id,membership_settings.membership_role_id),
             hr_role_id=EXCLUDED.hr_role_id,
             updated_by=EXCLUDED.updated_by,
             updated_at=now()`,
          [
            String(subject.guildId),
            generalRole?String(generalRole.id):null,
            hrRoleId,
            String(subject.userId)
          ]
        ).catch(()=>{});
      }
    }

    if(!hrRoleId)return false;
    if(subject.member?.roles?.cache?.has?.(hrRoleId))return true;

    return Array.isArray(subject.roleIds) &&
      subject.roleIds.some(id=>String(id)===hrRoleId);
  }

  async assertManager(subject) {
    if (!await this.canManage(subject)) throw new AppError('FORBIDDEN', 'هذا القسم متاح للـOwner وفريق الموارد البشرية فقط.');
  }

  async roleById(guild, roleId) {
    if (!validId(roleId)) return null;
    return guild.roles.cache.get(String(roleId)) ?? await guild.roles.fetch(String(roleId)).catch(() => null);
  }

  teamRoles(guild) {
    const roles=[];
    for(const name of DEFAULT_TEAM_ROLE_NAMES){
      const normalized=normalizeRoleName(name);
      const matches=[...guild.roles.cache.values()].filter((role)=>normalizeRoleName(role.name)===normalized);
      if(matches.length>1)throw new AppError('DUPLICATE_TEAM_ROLE',`يوجد أكثر من رتبة باسم ${name}. يجب توحيد الرتبة قبل بدء مراجعة العضويات.`);
      if(matches[0])roles.push(matches[0]);
    }
    return roles;
  }

  async discoverTeamRoles(guild){
    await guild.roles.fetch().catch(()=>null);
    return this.teamRoles(guild);
  }

  async requireTeamRoles(guild){
    await guild.roles.fetch().catch(()=>null);
    const found=this.teamRoles(guild);
    const foundNames=new Set(found.map((role)=>normalizeRoleName(role.name)));
    const missing=DEFAULT_TEAM_ROLE_NAMES.filter((name)=>!foundNames.has(normalizeRoleName(name)));
    if(missing.length)throw new AppError('TEAM_ROLES_NOT_FOUND',`عضويات الفرق التالية غير موجودة: ${missing.join('، ')}`);
    return found;
  }

  assertManageableRole(role, guild, { allowManaged = true } = {}) {
    if (!role) throw new AppError('ROLE_NOT_FOUND', 'الرتبة المحددة غير موجودة.');
    if (role.isEveryone?.()) throw new AppError('UNSAFE_ROLE', 'لا يمكن استخدام رتبة @everyone.');
    if (!allowManaged && role.managed) throw new AppError('MANAGED_ROLE', 'هذه رتبة مُدارة من تكامل خارجي ولا يمكن للبوت تعديلها.');
    const botMember=guild.members?.me;
    if(botMember?.roles?.highest && role.comparePositionTo?.(botMember.roles.highest)>=0){
      throw new AppError('ROLE_HIERARCHY','رتبة مطلوبة أعلى من رتبة البوت. ارفع رتبة Meeting 967 فوق الرتبة التي سيديرها.');
    }
    return role;
  }
  async ensureFrozenRole(guild, actorId) {
    await guild.roles.fetch().catch(()=>null);

    const exactRole=(name)=>{
      const matches=[...guild.roles.cache.values()].filter(
        role=>normalizeRoleName(role.name)===normalizeRoleName(name)
      );
      if(matches.length>1){
        throw new AppError(
          'DUPLICATE_ROLE',
          `يوجد أكثر من رتبة باسم ${name}. يجب توحيد الرتبة قبل بدء مراجعة العضويات.`
        );
      }
      return matches[0]??null;
    };

    const frozen=exactRole(DEFAULT_FROZEN_ROLE);
    const general=exactRole('عضوية عامة');
    const hr=exactRole('الموارد البشرية');

    if(!frozen){
      throw new AppError(
        'FROZEN_ROLE_NOT_FOUND',
        'رتبة غير مفعل غير موجودة في السيرفر.'
      );
    }

    this.assertManageableRole(frozen,guild,{allowManaged:false});
    if(general)this.assertManageableRole(general,guild,{allowManaged:false});

    await this.db.query(
      `INSERT INTO membership_settings(
         guild_id,membership_role_id,frozen_role_id,hr_role_id,updated_by,updated_at
       )
       VALUES($1,$2,$3,$4,$5,now())
       ON CONFLICT(guild_id) DO UPDATE SET
         membership_role_id=COALESCE(EXCLUDED.membership_role_id,membership_settings.membership_role_id),
         frozen_role_id=EXCLUDED.frozen_role_id,
         hr_role_id=COALESCE(EXCLUDED.hr_role_id,membership_settings.hr_role_id),
         updated_by=EXCLUDED.updated_by,
         updated_at=now()`,
      [
        String(guild.id),
        general?String(general.id):null,
        String(frozen.id),
        hr?String(hr.id):null,
        String(actorId)
      ]
    );

    return frozen;
  }

  async setRole({ guildId, roleId, kind, actorId }) {
    const guild = this.guild;
    if (!guild || String(guild.id) !== String(guildId)) throw new AppError('GUILD_UNAVAILABLE', 'تعذر الوصول إلى السيرفر.');
    const role = await this.roleById(guild, roleId);
    this.assertManageableRole(role, guild, { allowManaged: kind === 'hr' });
    const column = kind === 'general' ? 'membership_role_id' : 'hr_role_id';
    await this.db.query(
      `INSERT INTO membership_settings(guild_id,${column},updated_by,updated_at)
       VALUES($1,$2,$3,now())
       ON CONFLICT(guild_id) DO UPDATE SET ${column}=EXCLUDED.${column},updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [String(guild.id), String(role.id), String(actorId)],
    );
    await this.audit?.log?.({
      guildId: String(guild.id), actorId: String(actorId), action: `membership.config.${kind}_role`,
      targetType: 'role', targetId: String(role.id), newValue: { name: role.name },
    }).catch(() => {});
    return role;
  }

  async campaign(guildId, { openOnly = false } = {}) {
    const { rows } = await this.db.query(
      `SELECT id,guild_id,channel_id,message_id,published_at,deadline_at,status,
              general_role_id,frozen_role_id,hr_role_id,created_by,closed_at,report_file_path,stats
       FROM membership_review_campaigns WHERE guild_id=$1 ${openOnly ? "AND status='open'" : ''}
       ORDER BY published_at DESC LIMIT 1`,
      [String(guildId)],
    );
    return rows[0] ?? null;
  }

  async openCampaign(guildId, campaignId) {
    const { rows } = await this.db.query(
      `SELECT * FROM membership_review_campaigns
       WHERE guild_id=$1 AND id=$2 AND status='open' AND deadline_at>now()`,
      [String(guildId), String(campaignId)],
    );
    if (!rows[0]) throw new AppError('CAMPAIGN_CLOSED', 'انتهت مهلة هذه الحملة أو لم تعد متاحة.');
    return rows[0];
  }
  async publish({ guild, channel, actorId, actorMember = null }) {
    const managerMember=actorMember??await this.memberInGuild(guild,actorId);

    await this.assertManager({
      userId:actorId,
      guildId:guild.id,
      member:managerMember,
      roleIds:managerMember?.roles?.cache
        ? [...managerMember.roles.cache.keys()]
        : []
    });

    if(!channel?.isTextBased?.()||channel.isDMBased?.()){
      throw new AppError(
        'BAD_CHANNEL',
        'يجب تنفيذ نشر الحملة من داخل قناة نصية في السيرفر.'
      );
    }

    const dmEnabled=await operationalDmDeliveryEnabled(this.db,guild.id);
    if(!dmEnabled){
      throw new AppError(
        'MEMBERSHIP_DM_DISABLED',
        'الإرسال الخاص للأعضاء متوقف حاليًا. فعّل الإرسال التشغيلي ثم أعد النشر.'
      );
    }

    await guild.roles.fetch().catch(()=>null);

    const exactRole=(name)=>{
      const matches=[...guild.roles.cache.values()].filter(
        role=>normalizeRoleName(role.name)===normalizeRoleName(name)
      );
      if(matches.length>1){
        throw new AppError(
          'DUPLICATE_ROLE',
          `يوجد أكثر من رتبة باسم ${name}. يجب توحيد الرتبة قبل بدء مراجعة العضويات.`
        );
      }
      return matches[0]??null;
    };

    const generalRole=exactRole('عضوية عامة');
    const hrRole=exactRole('الموارد البشرية');

    if(!generalRole){
      throw new AppError(
        'MEMBERSHIP_ROLE_NOT_FOUND',
        'رتبة عضوية عامة غير موجودة في السيرفر.'
      );
    }

    if(!hrRole){
      throw new AppError(
        'HR_ROLE_NOT_FOUND',
        'رتبة الموارد البشرية غير موجودة في السيرفر.'
      );
    }

    this.assertManageableRole(generalRole,guild,{allowManaged:false});

    const frozenRole=await this.ensureFrozenRole(guild,actorId);
    const teamRoles=await this.requireTeamRoles(guild);
    const supportMap=await this.supportRoles(guild);

    for(const role of teamRoles){
      this.assertManageableRole(role,guild,{allowManaged:false});
    }

    const existing=await this.campaign(guild.id,{openOnly:true});
    if(existing){
      throw new AppError(
        'CAMPAIGN_OPEN',
        `هناك حملة مفتوحة بالفعل وتنتهي <t:${unix(existing.deadline_at)}:F>.`
      );
    }

    const members=[...(await guild.members.fetch()).values()].filter(member=>{
      if(member.user.bot)return false;
      return member.roles.cache.has(String(generalRole.id))
        || teamRoles.some(role=>member.roles.cache.has(String(role.id)));
    });

    if(!members.length){
      throw new AppError(
        'NO_MEMBERS',
        'لم يتم العثور على أعضاء ضمن العضوية العامة أو عضويات الفرق المحددة.'
      );
    }

    const campaignId=randomUUID();
    const publishedAt=new Date();
    const deadlineAt=new Date(
      publishedAt.getTime()+5*24*60*60*1000
    );

    await withTransaction(async(client)=>{
      await client.query(
        `INSERT INTO membership_review_campaigns
          (id,guild_id,channel_id,published_at,deadline_at,status,
           general_role_id,frozen_role_id,hr_role_id,created_by)
         VALUES($1,$2,$3,$4,$5,'open',$6,$7,$8,$9)`,
        [
          campaignId,
          String(guild.id),
          String(channel.id),
          publishedAt,
          deadlineAt,
          String(generalRole.id),
          String(frozenRole.id),
          String(hrRole.id),
          String(actorId)
        ]
      );

      for(const member of members){
        const memberTeamRoles=teamRoles.filter(
          role=>member.roles.cache.has(String(role.id))
        );
        const memberSupportRoles=supportMap
          .filter(item=>member.roles.cache.has(String(item.support.id)))
          .map(item=>item.support);

        await client.query(
          `INSERT INTO membership_campaign_members
            (
              campaign_id,guild_id,user_id,display_name,username,
              was_active_at_publish,team_role_ids,team_role_names,
              support_role_ids,support_role_names,dm_status
            )
           VALUES(
              $1,$2,$3,$4,$5,$6,
              $7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,'pending'
           )
           ON CONFLICT(campaign_id,user_id) DO NOTHING`,
          [
            campaignId,
            String(guild.id),
            String(member.id),
            clean(
              member.displayName ||
              member.user.globalName ||
              member.user.username,
              200
            ),
            clean(member.user.username,120),
            Boolean(
              member.roles.cache.has(String(generalRole.id)) ||
              memberTeamRoles.length
            ),
            JSON.stringify(
              memberTeamRoles.map(role=>String(role.id))
            ),
            JSON.stringify(
              memberTeamRoles.map(role=>role.name)
            ),
            JSON.stringify(
              memberSupportRoles.map(role=>String(role.id))
            ),
            JSON.stringify(
              memberSupportRoles.map(role=>role.name)
            )
          ]
        );
      }
    });

    const dmContent=[
      '📢 إعلان تنظيمي من فريق الموارد البشرية',
      '',
      'في إطار تنظيم العضويات وتحديث قوائم الأعضاء داخل السيرفر، ونظراً لطبيعة العمل التطوعي ومراعاةً لظروف واهتمامات الجميع، يجري العمل على تحديث بيانات الفريق خلال الفترة الحالية.',
      '',
      'نرجو من جميع الأعضاء تحديد موقفهم من الاستمرار باختيار أحد الخيارات التالية:',
      '',
      '🟢 استمرار العضوية',
      'أرغب في الاستمرار والمشاركة في مهام وأنشطة الفريق.',
      '',
      '🟡 تجميد العضوية',
      'أرغب في تجميد عضويتي مؤقتاً بسبب الظروف الحالية، مع إمكانية العودة لاحقاً.',
      '',
      '🔴 الانسحاب من العضوية',
      'أرغب في إنهاء عضويتي والانسحاب من الفريق.',
      '',
      '⚠️ ملاحظة:',
      'نظراً لعدم تفاعل بعض الأعضاء مؤخراً، سيتم تحديث حالة الحسابات غير المتفاعلة أو التي لا ترد خلال المهلة المحددة، وذلك لتنظيم سير العمل وضمان دقة السجلات.',
      '',
      '⏳ المهلة المتاحة: 5 أيام من تاريخ نشر هذا الإعلان.',
      '',
      'نشكر لجميع الأعضاء تعاونهم وجهودهم التطوعية السابقة والحالية.',
      '',
      'فريق الموارد البشرية — 967'
    ].join('\\n');

  const components=[{
      type:1,
      components:[
        {
          type:2,
          style:3,
          custom_id:`membership:choice:continue:${campaignId}`,
          label:'استمرار العضوية',
          emoji:{name:'🟢'}
        },
        {
          type:2,
          style:2,
          custom_id:`membership:freeze:${campaignId}`,
          label:'تجميد العضوية',
          emoji:{name:'🟡'}
        },
        {
          type:2,
          style:4,
          custom_id:`membership:choice:withdraw:${campaignId}`,
          label:'الانسحاب',
          emoji:{name:'🔴'}
        }
      ]
    }];

    let dmSent=0;
    let dmFailed=0;

    for(let offset=0;offset<members.length;offset+=5){
      const chunk=members.slice(offset,offset+5);

      const results=await Promise.all(chunk.map(async(member)=>{
        try{
          await member.send({
            content:dmContent,
            components
          });
          return {member,ok:true,error:null};
        }catch(error){
          return {
            member,
            ok:false,
            error:clean(
              error?.message??String(error),
              1000
            )
          };
        }
      }));

      for(const result of results){
        if(result.ok){
          dmSent++;
          await this.db.query(
            `UPDATE membership_campaign_members
             SET dm_status='sent',dm_sent_at=now(),dm_error=NULL
             WHERE campaign_id=$1 AND user_id=$2`,
            [campaignId,String(result.member.id)]
          ).catch(()=>{});
        }else{
          dmFailed++;
          await this.db.query(
            `UPDATE membership_campaign_members
             SET dm_status='failed',dm_error=$3
             WHERE campaign_id=$1 AND user_id=$2`,
            [campaignId,String(result.member.id),result.error]
          ).catch(()=>{});
        }
      }
    }

    await this.db.query(
      `UPDATE membership_review_campaigns
       SET stats=stats || $2::jsonb,updated_at=now()
       WHERE id=$1`,
      [
        campaignId,
        JSON.stringify({
          dmTotal:members.length,
          dmSent,
          dmFailed
        })
      ]
    );

    await this.audit?.log?.({
      guildId:String(guild.id),
      actorId:String(actorId),
      action:'membership.review.published',
      targetType:'membership_campaign',
      targetId:campaignId,
      newValue:{
        channelId:String(channel.id),
        totalMembers:members.length,
        deadlineAt:deadlineAt.toISOString(),
        generalRoleId:String(generalRole.id),
        frozenRoleId:String(frozenRole.id),
        hrRoleId:String(hrRole.id),
        teamRoles:teamRoles.map(
          role=>({id:String(role.id),name:role.name})
        ),
        dmTotal:members.length,
        dmSent,
        dmFailed
      }
    }).catch(()=>{});

    return {
      campaignId,
      totalMembers:members.length,
      dmSent,
      dmFailed,
      deadlineAt
    };
  }

  async response({ guild, interaction, campaignId, choice }) {
    const campaign = await this.openCampaign(guild.id, campaignId);
    const userId = String(interaction.user.id);
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) throw new AppError('MEMBER_NOT_FOUND', 'حساب العضو غير موجود في السيرفر.');

    const snapshot = await this.db.query(`SELECT * FROM membership_campaign_members WHERE campaign_id=$1 AND user_id=$2`, [campaign.id,userId]);
    if (!snapshot.rowCount) throw new AppError('NOT_IN_CAMPAIGN', 'هذا الحساب ليس ضمن قائمة أعضاء الحملة.');
    if (![CHOICES.CONTINUE,CHOICES.WITHDRAW].includes(choice)) throw new AppError('INVALID_CHOICE', 'الخيار غير صحيح.');
    const previous = await this.db.query(`SELECT * FROM membership_reviews WHERE campaign_id=$1 AND user_id=$2`, [campaign.id,userId]);

    if (choice===CHOICES.CONTINUE) await this.applyContinue({guild,member,campaign,actorId:userId,review:previous.rows[0]??null,snapshot:snapshot.rows[0]});
    else await this.applyWithdraw({guild,member,campaign,actorId:userId});

    await this.db.query(
      `INSERT INTO membership_reviews
        (campaign_id,guild_id,user_id,choice,responded_at,status,applied_at,metadata)
       VALUES($1,$2,$3,$4,now(),'completed',now(),$5::jsonb)
       ON CONFLICT(campaign_id,user_id)
       DO UPDATE SET choice=EXCLUDED.choice,responded_at=now(),status='completed',applied_at=now(),
                     freeze_start_at=NULL,return_at=NULL,reason=NULL,metadata=EXCLUDED.metadata`,
      [campaign.id,String(guild.id),userId,choice,JSON.stringify({source:'button'})],
    );
    await this.audit?.log?.({guildId:String(guild.id),actorId:userId,action:`membership.response.${choice}`,targetType:'membership_campaign',targetId:campaign.id,newValue:{choice}}).catch(() => {});
    return choice===CHOICES.CONTINUE ? '✅ تم تسجيل استمرار عضويتك وتفعيل العضوية.' : '✅ تم تسجيل انسحابك وسحب رتبة العضوية العامة.';
  }

  async freezeModal({ guild, interaction, campaignId, startInput, returnInput, reasonInput }) {
    const campaign = await this.openCampaign(guild.id, campaignId);
    const userId = String(interaction.user.id);
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) throw new AppError('MEMBER_NOT_FOUND', 'حساب العضو غير موجود في السيرفر.');

    const settings = await this.guildSettings(guild.id);
    const start = parseMembershipDate(startInput, settings.timezone);
    const returnAt = parseMembershipDate(returnInput, settings.timezone);
    const now = DateTime.now().setZone(settings.timezone);
    if (returnAt <= start) throw new AppError('BAD_FREEZE_RANGE', 'تاريخ العودة يجب أن يكون بعد تاريخ بدء التجميد.');
    if (returnAt <= now) throw new AppError('BAD_RETURN_DATE', 'تاريخ العودة يجب أن يكون في المستقبل.');
    const reason = clean(reasonInput,500);
    if (!reason) throw new AppError('REASON_REQUIRED', 'سبب التجميد مطلوب.');

    const startsNow = start <= now;
    const teamRoles = await this.managedTeamRoles(guild);
    const teamRoleIds = teamRoles.filter((role)=>member.roles.cache.has(String(role.id))).map((role)=>String(role.id));
    const teamRoleNames = teamRoles.filter((role)=>member.roles.cache.has(String(role.id))).map((role)=>role.name);
    const supports=await this.supportRoles(guild);
    if (startsNow) await this.applyFreeze({guild,member,campaign,actorId:userId});
    else await this.ensureGeneralMembershipState(guild,member,campaign.general_role_id,true);

    await this.db.query(
      `INSERT INTO membership_reviews
        (campaign_id,guild_id,user_id,choice,freeze_start_at,return_at,reason,responded_at,status,applied_at,metadata)
       VALUES($1,$2,$3,'freeze',$4,$5,$6,now(),$7,$8,$9::jsonb)
       ON CONFLICT(campaign_id,user_id)
       DO UPDATE SET choice='freeze',freeze_start_at=EXCLUDED.freeze_start_at,return_at=EXCLUDED.return_at,
                     reason=EXCLUDED.reason,responded_at=now(),status=EXCLUDED.status,applied_at=EXCLUDED.applied_at,
                     metadata=EXCLUDED.metadata`,
      [campaign.id,String(guild.id),userId,start.toUTC().toJSDate(),returnAt.toUTC().toJSDate(),reason,startsNow?STATUS.ACTIVE:STATUS.PENDING,startsNow?new Date():null,JSON.stringify({
        source:'freeze_modal',
        timezone:settings.timezone,
        teamRoleSnapshot:{
          ids:teamRoleIds,
          names:teamRoleNames
        },
        supportRoleSnapshot:{
          ids:supports
            .filter(item=>member.roles.cache.has(String(item.support.id)))
            .map(item=>String(item.support.id)),
          names:supports
            .filter(item=>member.roles.cache.has(String(item.support.id)))
            .map(item=>item.support.name)
        }
      })],
    );
    await this.audit?.log?.({guildId:String(guild.id),actorId:userId,action:'membership.response.freeze',targetType:'membership_campaign',targetId:campaign.id,newValue:{start:start.toISO(),returnAt:returnAt.toISO(),reason}}).catch(() => {});
    return `✅ تم تسجيل طلب التجميد\n📅 البداية: <t:${unix(start.toJSDate())}:F>\n🔓 العودة: <t:${unix(returnAt.toJSDate())}:F>`;
  }

  async guildSettings(guildId) {
    try { const {rows}=await this.db.query('SELECT timezone FROM settings WHERE guild_id=$1',[String(guildId)]); return {timezone:rows[0]?.timezone||'Asia/Aden'}; }
    catch { return {timezone:'Asia/Aden'}; }
  }

  async memberInGuild(guild,userId) { return guild.members.cache.get(String(userId)) ?? await guild.members.fetch(String(userId)).catch(() => null); }

  async upsertMemberState(guildId,userId,active,client=this.db) {
    await client.query(`INSERT INTO members(guild_id,user_id,active) VALUES($1,$2,$3)
      ON CONFLICT(guild_id,user_id) DO UPDATE SET active=EXCLUDED.active`, [String(guildId),String(userId),Boolean(active)]);
  }

  async safeRoleAdd(member,roleId) { if(!roleId) throw new AppError('ROLE_NOT_FOUND','رتبة مطلوبة غير موجودة.'); if(!member.roles.cache.has(String(roleId))) await member.roles.add(String(roleId),'Meeting 967 — Membership Workflow'); }
  async safeRoleRemove(member,roleId) { if(roleId && member.roles.cache.has(String(roleId))) await member.roles.remove(String(roleId),'Meeting 967 — Membership Workflow'); }

  async ensureGeneralMembershipState(guild,member,roleId,keepGeneral=true) {
    const generalRole=await this.roleById(guild,roleId);
    this.assertManageableRole(generalRole,guild,{allowManaged:false});
    if(keepGeneral) await this.safeRoleAdd(member,generalRole.id); else await this.safeRoleRemove(member,generalRole.id);
  }

  parseRoleSnapshot(value) {
    if (Array.isArray(value)) return value.map(String);
    try { const parsed=JSON.parse(String(value??'[]')); return Array.isArray(parsed)?parsed.map(String):[]; }
    catch { return []; }
  }

  async managedTeamRoles(guild) {
    const roles=await this.requireTeamRoles(guild);
    for(const role of roles)this.assertManageableRole(role,guild,{allowManaged:false});
    return roles;
  }

  async restoreTeamRoles(guild,member,review=null,snapshot=null) {
    let ids=this.parseRoleSnapshot(review?.team_role_ids??snapshot?.team_role_ids);
    let names=this.parseRoleSnapshot(review?.team_role_names??snapshot?.team_role_names);
    if(!ids.length&&!names.length){
      let metadata=review?.metadata??{};
      if(typeof metadata==='string'){try{metadata=JSON.parse(metadata)}catch{metadata={};}}
      ids=this.parseRoleSnapshot(metadata?.teamRoleSnapshot?.ids);
      names=this.parseRoleSnapshot(metadata?.teamRoleSnapshot?.names);
    }
    const roles=await this.managedTeamRoles(guild);
    const wanted=new Set(ids);
    if(!wanted.size&&names.length)for(const role of roles)if(names.includes(role.name))wanted.add(String(role.id));
    for(const role of roles)if(wanted.has(String(role.id)))await this.safeRoleAdd(member,role.id);
  }

  async removeTeamRoles(guild,member) {
    const roles=await this.managedTeamRoles(guild);
    for(const role of roles)await this.safeRoleRemove(member,role.id);
  }
  async applyContinue({guild,member,campaign,actorId,review=null,snapshot=null}) {
    await this.ensureGeneralMembershipState(
      guild,member,campaign.general_role_id,true
    );
    await this.safeRoleRemove(member,campaign.frozen_role_id);
    await this.restoreTeamRoles(guild,member,review,snapshot);

    let supportIds=this.parseRoleSnapshot(
      review?.support_role_ids
    );
    let supportNames=this.parseRoleSnapshot(
      review?.support_role_names
    );

    if(!supportIds.length&&!supportNames.length){
      let metadata=review?.metadata??{};
      if(typeof metadata==='string'){
        try{metadata=JSON.parse(metadata)}catch{metadata={};}
      }
      supportIds=this.parseRoleSnapshot(
        metadata?.supportRoleSnapshot?.ids
      );
      supportNames=this.parseRoleSnapshot(
        metadata?.supportRoleSnapshot?.names
      );
    }

    if(supportIds.length||supportNames.length){
      const supports=await this.supportRoles(guild);
      const wanted=new Set(supportIds);

      if(!wanted.size&&supportNames.length){
        for(const item of supports){
          if(supportNames.includes(item.support.name)){
            wanted.add(String(item.support.id));
          }
        }
      }

      for(const item of supports){
        if(wanted.has(String(item.support.id))){
          await this.safeRoleAdd(member,item.support.id);
        }
      }
    }

    await this.upsertMemberState(guild.id,member.id,true);

    await this.audit?.log?.({
      guildId:String(guild.id),
      actorId:String(actorId),
      action:'membership.status.continue',
      targetType:'user',
      targetId:String(member.id)
    }).catch(()=>{});
  }
  async applyWithdraw({guild,member,campaign,actorId}) {
    await this.ensureGeneralMembershipState(
      guild,member,campaign.general_role_id,false
    );
    await this.safeRoleRemove(member,campaign.frozen_role_id);
    await this.removeTeamRoles(guild,member);

    const supports=await this.supportRoles(guild);
    for(const item of supports){
      await this.safeRoleRemove(member,item.support.id);
    }

    await this.upsertMemberState(guild.id,member.id,false);

    await this.audit?.log?.({
      guildId:String(guild.id),
      actorId:String(actorId),
      action:'membership.status.withdraw',
      targetType:'user',
      targetId:String(member.id)
    }).catch(()=>{});
  }
  async applyFreeze({guild,member,campaign,actorId}) {
    const roles=await this.managedTeamRoles(guild);

    const teamRoleIds=roles.filter(
      role=>member.roles.cache.has(String(role.id))
    ).map(role=>String(role.id));

    const teamRoleNames=roles.filter(
      role=>member.roles.cache.has(String(role.id))
    ).map(role=>role.name);

    const supports=await this.supportRoles(guild);

    const supportRoleIds=supports.filter(
      item=>member.roles.cache.has(String(item.support.id))
    ).map(item=>String(item.support.id));

    const supportRoleNames=supports.filter(
      item=>member.roles.cache.has(String(item.support.id))
    ).map(item=>item.support.name);

    await this.ensureGeneralMembershipState(
      guild,member,campaign.general_role_id,false
    );
    await this.removeTeamRoles(guild,member);

    for(const item of supports){
      await this.safeRoleRemove(member,item.support.id);
    }

    await this.safeRoleAdd(member,campaign.frozen_role_id);
    await this.upsertMemberState(guild.id,member.id,false);

    await this.audit?.log?.({
      guildId:String(guild.id),
      actorId:String(actorId),
      action:'membership.status.freeze',
      targetType:'user',
      targetId:String(member.id),
      newValue:{
        teamRoleIds,
        teamRoleNames,
        supportRoleIds,
        supportRoleNames
      }
    }).catch(()=>{});

    return {
      teamRoleIds,
      teamRoleNames,
      supportRoleIds,
      supportRoleNames
    };
  }

  async processScheduledFreezes(guild) {
    const {rows}=await this.db.query(`SELECT mr.*,mrc.general_role_id,mrc.frozen_role_id
      FROM membership_reviews mr JOIN membership_review_campaigns mrc ON mrc.id=mr.campaign_id
      WHERE mr.guild_id=$1 AND mr.choice='freeze' AND mr.status='pending' AND mr.freeze_start_at<=now()
      ORDER BY mr.freeze_start_at ASC LIMIT 100`,[String(guild.id)]);
    for(const row of rows){
      const member=await this.memberInGuild(guild,row.user_id); if(!member) continue;
      try{
        await this.applyFreeze({guild,member,campaign:row,actorId:row.user_id});
        await this.db.query(`UPDATE membership_reviews SET status='active',applied_at=now(),metadata=metadata || $2::jsonb WHERE campaign_id=$1 AND user_id=$3`,
          [row.campaign_id,JSON.stringify({freezeAppliedAt:new Date().toISOString()}),String(row.user_id)]);
      }catch(error){
        await this.db.query(`UPDATE membership_reviews SET status='invalid',metadata=metadata || $2::jsonb WHERE campaign_id=$1 AND user_id=$3`,
          [row.campaign_id,JSON.stringify({error:error?.message??String(error)}),String(row.user_id)]).catch(() => {});
        this.logger?.error?.('membership-freeze-apply-failed',{campaignId:row.campaign_id,userId:String(row.user_id),error:error?.stack??String(error)});
      }
    }
  }
  async processReturns(guild) {
    const {rows}=await this.db.query(
      `SELECT mr.*,mrc.general_role_id,mrc.frozen_role_id
       FROM membership_reviews mr
       JOIN membership_review_campaigns mrc
         ON mrc.id=mr.campaign_id
       WHERE mr.guild_id=$1
         AND mr.choice='freeze'
         AND mr.status='active'
         AND mr.return_at<=now()
       ORDER BY mr.return_at ASC
       LIMIT 100`,
      [String(guild.id)]
    );

    for(const row of rows){
      const member=await this.memberInGuild(guild,row.user_id);
      if(!member)continue;

      try{
        await this.ensureGeneralMembershipState(
          guild,member,row.general_role_id,true
        );
        await this.safeRoleRemove(member,row.frozen_role_id);

        let metadata=row.metadata??{};
        if(typeof metadata==='string'){
          try{metadata=JSON.parse(metadata)}catch{metadata={};}
        }

        const teamSnap=metadata?.teamRoleSnapshot??{};
        const supportSnap=metadata?.supportRoleSnapshot??{};

        await this.restoreTeamRoles(
          guild,
          member,
          {
            team_role_ids:teamSnap?.ids,
            team_role_names:teamSnap?.names
          }
        );

        const supports=await this.supportRoles(guild);
        const wantedSupport=new Set(
          this.parseRoleSnapshot(supportSnap?.ids)
        );

        if(!wantedSupport.size&&Array.isArray(supportSnap?.names)){
          for(const item of supports){
            if(supportSnap.names.includes(item.support.name)){
              wantedSupport.add(String(item.support.id));
            }
          }
        }

        for(const item of supports){
          if(wantedSupport.has(String(item.support.id))){
            await this.safeRoleAdd(member,item.support.id);
          }
        }

        await this.upsertMemberState(guild.id,member.id,true);

        await this.db.query(
          `UPDATE membership_reviews
           SET status='completed',
               metadata=metadata || $2::jsonb
           WHERE campaign_id=$1 AND user_id=$3`,
          [
            row.campaign_id,
            JSON.stringify({
              reactivatedAt:new Date().toISOString()
            }),
            String(row.user_id)
          ]
        );

        await this.audit?.log?.({
          guildId:String(guild.id),
          actorId:String(member.id),
          action:'membership.status.reactivated',
          targetType:'user',
          targetId:String(member.id),
          newValue:{campaignId:row.campaign_id}
        }).catch(()=>{});
      }catch(error){
        this.logger?.error?.(
          'membership-reactivation-failed',
          {
            campaignId:row.campaign_id,
            userId:String(row.user_id),
            error:error?.stack??String(error)
          }
        );
      }
    }
  }


  async listCampaignReports(guildId,limit=25){
    const safeLimit=Math.max(
      1,
      Math.min(Number(limit)||25,25)
    );

    const {rows}=await this.db.query(
      `SELECT *
       FROM membership_review_campaigns
       WHERE guild_id=$1
       ORDER BY published_at DESC
       LIMIT $2`,
      [
        String(guildId),
        safeLimit
      ]
    );

    return rows;
  }

  async getOrCreateCampaignReport(guild,campaignId){
    const {rows}=await this.db.query(
      `SELECT *
       FROM membership_review_campaigns
       WHERE guild_id=$1
         AND id=$2
       LIMIT 1`,
      [
        String(guild.id),
        String(campaignId)
      ]
    );

    const campaign=rows[0];

    if(!campaign){
      throw new AppError(
        'CAMPAIGN_NOT_FOUND',
        'إعلان التصفية المحدد غير موجود.'
      );
    }

    if(campaign.report_file_path && campaign.status!=='open'){
      try{
        await fs.access(campaign.report_file_path);

        return {
          file:campaign.report_file_path,
          campaign,
          existing:true
        };
      }catch{}
    }

    const generated=await this.generateReport(guild,campaign,{
      finalize:campaign.status!=='open'
    });

    const refreshed=await this.db.query(
      `SELECT *
       FROM membership_review_campaigns
       WHERE guild_id=$1
         AND id=$2
       LIMIT 1`,
      [
        String(guild.id),
        String(campaign.id)
      ]
    );

    return {
      file:generated.file,
      stats:generated.stats,
      campaign:refreshed.rows[0]??campaign,
      existing:false
    };
  }
  async generateReport(guild,campaign,{finalize=true}={}) {
    const {rows}=await this.db.query(`SELECT
      c.user_id,c.display_name,c.username,c.was_active_at_publish,c.team_role_names,
      r.choice,r.freeze_start_at,r.return_at,r.reason,r.responded_at,r.status,r.metadata
      FROM membership_campaign_members c
      LEFT JOIN membership_reviews r
        ON r.campaign_id=c.campaign_id AND r.user_id=c.user_id
      WHERE c.campaign_id=$1
      ORDER BY c.display_name ASC,c.user_id ASC`,[campaign.id]);

    const total=rows.length;
    const continueCount=rows.filter((r)=>r.choice===CHOICES.CONTINUE).length;
    const freezeCount=rows.filter((r)=>r.choice===CHOICES.FREEZE).length;
    const withdrawCount=rows.filter((r)=>r.choice===CHOICES.WITHDRAW).length;
    const noResponse=rows.filter((r)=>!r.choice).length;
    const invalid=rows.filter((r)=>r.status===STATUS.INVALID).length;
    const responded=total-noResponse;
    const stats={
      ...(campaign.stats??{}),
      total,responded,noResponse,
      continue:continueCount,freeze:freezeCount,withdraw:withdrawCount,
      invalid,
      responseRate:total?Number(((responded/total)*100).toFixed(1)):0,
    };

    const guildSettings=await this.guildSettings(guild.id);
    const zone=guildSettings.timezone;
    const issue=DateTime.now().setZone(zone);

    const {rows:seqRows}=await this.db.query(
      `SELECT COUNT(*)::int AS seq
       FROM membership_review_campaigns
       WHERE guild_id=$1 AND published_at <= $2`,
      [String(guild.id),campaign.published_at]
    );

    const seq=Math.max(1,Number(seqRows[0]?.seq??1));
    const reportId=`HR-${issue.toFormat('yyyy')}-${String(seq).padStart(3,'0')}`;
    const reportTitle=`تقرير إدارة العضوية — إعلان التصفية ${reportId}`;

    const fileDir=path.resolve(
      this.env.STORAGE_DIR||'./storage',
      'membership-reviews',
      String(guild.id)
    );
    await fs.mkdir(fileDir,{recursive:true});

    const safeDate=issue.toFormat('yyyy-MM-dd_HH-mm');
    const fileName=`تقرير إدارة العضوية - إعلان التصفية - ${reportId} - ${safeDate}.docx`;
    const file=path.join(fileDir,fileName);

    const formatDate=(value)=>{
      if(!value)return '—';
      return DateTime.fromJSDate(new Date(value),{zone:'utc'})
        .setZone(zone)
        .toFormat('yyyy-MM-dd HH:mm');
    };

    await renderMembershipManagementReport({
      outputPath:file,
      rows,
      stats,
      reportId,
      reportTitle,
      periodStart:formatDate(campaign.published_at),
      periodEnd:formatDate(campaign.deadline_at),
      issueDate:formatDate(issue.toJSDate()),
      zone,
      notes:finalize
        ? 'أصدر التقرير النهائي بعد انتهاء مهلة مراجعة العضويات.'
        : 'هذا تقرير مرحلي يعكس حالة إعلان التصفية حتى وقت الإصدار ولا يغلق الحملة.',
    });

    if(finalize){
      await this.db.query(
        `UPDATE membership_review_campaigns
         SET status='reported',closed_at=COALESCE(closed_at,now()),
             report_file_path=$2,stats=$3::jsonb,updated_at=now()
         WHERE id=$1`,
        [campaign.id,file,JSON.stringify(stats)]
      );
    }else{
      await this.db.query(
        `UPDATE membership_review_campaigns
         SET stats=$2::jsonb,updated_at=now()
         WHERE id=$1`,
        [campaign.id,JSON.stringify(stats)]
      );
    }

    await this.audit?.log?.({
      guildId:String(guild.id),
      actorId:String(campaign.created_by),
      action:'membership.review.report.generated',
      targetType:'membership_campaign',
      targetId:String(campaign.id),
      newValue:{stats,file,reportId,reportTitle,finalize},
    }).catch(()=>{});

    const summary=[
      '📊 **تقرير إدارة العضوية — 967**',
      `عنوان التقرير: **${reportTitle}**`,
      `رقم التقرير: **${reportId}**`,
      `إجمالي الأعضاء: **${stats.total}**`,
      `أجابوا: **${stats.responded}**`,
      `🟢 استمرار: **${stats.continue}**`,
      `🟡 تجميد: **${stats.freeze}**`,
      `🔴 انسحاب: **${stats.withdraw}**`,
      `⚪ لم يرد: **${stats.noResponse}**`,
      `📈 نسبة الاستجابة: **${stats.responseRate}%**`,
    ].join('\n');

    if(finalize){
      const hrRole=await this.roleById(guild,campaign.hr_role_id);
      const recipients=new Map();
      const owner=await guild.client.users.fetch(String(this.env.OWNER_USER_ID)).catch(()=>null);
      if(owner)recipients.set(String(owner.id),owner);

      if(hrRole){
        for(const member of (await guild.members.fetch()).values()){
          if(!member.user.bot && member.roles.cache.has(String(hrRole.id))){
            recipients.set(String(member.id),member.user);
          }
        }
      }

      for(const user of recipients.values()){
        await user.send({content:summary,files:[file]}).catch((error)=>
          this.logger?.warn?.('membership-report-dm-failed',{
            userId:String(user.id),
            error:error?.message??String(error),
          })
        );
      }

      const channel=campaign.channel_id
        ? await guild.channels.fetch(String(campaign.channel_id)).catch(()=>null)
        : null;

      await channel?.send?.({
        content:`✅ انتهت مهلة مراجعة العضويات.\n${summary}\nتم إصدار التقرير الكامل لفريق الموارد البشرية وإدارة حركة 967.`,
      }).catch(()=>{});

      const message=campaign.message_id
        ? await channel?.messages?.fetch(String(campaign.message_id)).catch(()=>null)
        : null;
      await message?.edit?.({components:[]}).catch(()=>{});
    }

    return {file,fileName,stats,reportId,reportTitle,rows};
  }



  async closeExpiredCampaigns(guild){
    const {rows}=await this.db.query(`SELECT * FROM membership_review_campaigns WHERE guild_id=$1 AND status='open' AND deadline_at<=now() ORDER BY deadline_at ASC LIMIT 10`,[String(guild.id)]);
    for(const campaign of rows){ try{ await this.generateReport(guild,campaign); } catch(error){ this.logger?.error?.('membership-report-generation-failed',{campaignId:campaign.id,error:error?.stack??String(error)}); } }
  }


  async personalState(guildId, userId) {
    const { rows } = await this.db.query(
      `SELECT * FROM membership_personal_states
       WHERE guild_id=$1 AND user_id=$2`,
      [String(guildId), String(userId)]
    );
    return rows[0] ?? null;
  }

  async supportRoles(guild) {
    const guildId = String(guild.id);

    if (!this._supportRoleCache) {
      this._supportRoleCache = new Map();
    }

    const cached = this._supportRoleCache.get(guildId);
    if (cached && Date.now() - cached.at < 60_000) {
      const valid = cached.items.every(item =>
        guild.roles.cache.has(String(item.team.id)) &&
        guild.roles.cache.has(String(item.support.id))
      );

      if (valid) {
        return cached.items;
      }
    }

    const dbResult = await this.db.query(
      `SELECT
         team_role_id,
         support_role_id,
         team_role_name,
         support_role_name
       FROM membership_support_roles
       WHERE guild_id=$1
       ORDER BY team_role_name ASC`,
      [guildId]
    ).catch(() => ({rows: []}));

    if (dbResult.rows.length) {
      const resolved = [];

      for (const row of dbResult.rows) {
        let team = guild.roles.cache.get(String(row.team_role_id));
        let support = guild.roles.cache.get(String(row.support_role_id));

        if (!team) {
          team = await guild.roles.fetch(String(row.team_role_id)).catch(() => null);
        }

        if (!support) {
          support = await guild.roles.fetch(String(row.support_role_id)).catch(() => null);
        }

        if (!team || !support) {
          continue;
        }

        this.assertManageableRole(
          support,
          guild,
          {allowManaged: false}
        );

        resolved.push({team, support});
      }

      if (resolved.length === dbResult.rows.length) {
        this._supportRoleCache.set(guildId, {
          at: Date.now(),
          items: resolved
        });

        return resolved;
      }
    }

    await guild.roles.fetch().catch(() => null);

    const result = [];

    for (const teamName of DEFAULT_TEAM_ROLE_NAMES) {
      const team = [...guild.roles.cache.values()]
        .find(role =>
          normalizeRoleName(role.name) === normalizeRoleName(teamName)
        );

      if (!team) continue;

      const supportName = `مساند ${teamName}`;

      let support = [...guild.roles.cache.values()]
        .find(role =>
          normalizeRoleName(role.name) === normalizeRoleName(supportName)
        );

      if (!support) {
        support = await guild.roles.create({
          name: supportName,
          reason: 'Meeting 967 — Membership Support Role'
        });
      }

      this.assertManageableRole(
        support,
        guild,
        {allowManaged: false}
      );

      result.push({team, support});
    }

    if (result.length) {
      await Promise.all(
        result.map(item =>
          this.db.query(
            `INSERT INTO membership_support_roles
             (guild_id,team_role_id,support_role_id,team_role_name,support_role_name)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT(guild_id,team_role_id)
             DO UPDATE SET
               support_role_id=EXCLUDED.support_role_id,
               team_role_name=EXCLUDED.team_role_name,
               support_role_name=EXCLUDED.support_role_name,
               updated_at=now()`,
            [
              guildId,
              String(item.team.id),
              String(item.support.id),
              item.team.name,
              item.support.name
            ]
          )
        )
      );
    }

    this._supportRoleCache.set(guildId, {
      at: Date.now(),
      items: result
    });

    return result;
  }

  async personalMembership(guild, userId) {
    const member = await this.memberInGuild(guild, userId);

    if (!member || member.user.bot) {
      throw new AppError(
        'MEMBER_NOT_FOUND',
        'حساب العضو غير موجود في السيرفر.'
      );
    }

    const teams = await this.requireTeamRoles(guild);

    const general = [...guild.roles.cache.values()]
      .find(role =>
        normalizeRoleName(role.name) ===
        normalizeRoleName('عضوية عامة')
      );

    const frozen = [...guild.roles.cache.values()]
      .find(role =>
        normalizeRoleName(role.name) ===
        normalizeRoleName(DEFAULT_FROZEN_ROLE)
      );

    const supportMap = await this.supportRoles(guild);

    const teamRoles = teams.filter(role =>
      member.roles.cache.has(String(role.id))
    );

    const supportRoles = supportMap
      .filter(item =>
        member.roles.cache.has(String(item.support.id))
      )
      .map(item => item.support);

    const state = await this.personalState(guild.id, userId);

    return {
      member,
      general,
      frozen,
      teamRoles,
      supportRoles,
      supportMap,
      state
    };
  }

  async freezePersonal({ guild, userId, returnAt, reason }) {
    const info = await this.personalMembership(guild, userId);

    if (info.state?.status && info.state.status !== 'active') {
      throw new AppError(
        'MEMBERSHIP_INACTIVE',
        'لا يمكن تجميد العضوية إلا أثناء العضوية النشطة.'
      );
    }

    if (!reason?.trim()) {
      throw new AppError('REASON_REQUIRED', 'سبب التجميد مطلوب.');
    }

    if (!returnAt || returnAt <= new Date()) {
      throw new AppError('BAD_RETURN_DATE', 'تاريخ العودة يجب أن يكون في المستقبل.');
    }

    if (!info.general) {
      throw new AppError('MEMBERSHIP_ROLE_NOT_FOUND', 'رتبة عضوية عامة غير موجودة.');
    }

    if (info.frozen && info.member.roles.cache.has(String(info.frozen.id))) {
      throw new AppError('ALREADY_FROZEN', 'عضويتك مجمدة بالفعل.');
    }

    const supportMap = await this.supportRoles(guild);

    const snapshot = {
      capturedAt: new Date().toISOString(),
      generalRole: info.member.roles.cache.has(String(info.general.id)),
      teamRoles: info.teamRoles.map(role => ({
        id: String(role.id),
        name: role.name
      })),
      supportRoles: info.supportRoles.map(role => ({
        id: String(role.id),
        name: role.name
      }))
    };

    await this.db.query(
      `INSERT INTO membership_personal_states
       (guild_id,user_id,status,freeze_start_at,return_at,freeze_reason,snapshot,support_role_ids,updated_by)
       VALUES($1,$2,'frozen',now(),$3,$4,$5::jsonb,$6::jsonb,$2)
       ON CONFLICT(guild_id,user_id)
       DO UPDATE SET
         status='frozen',
         freeze_start_at=now(),
         return_at=EXCLUDED.return_at,
         freeze_reason=EXCLUDED.freeze_reason,
         snapshot=EXCLUDED.snapshot,
         support_role_ids=EXCLUDED.support_role_ids,
         updated_by=EXCLUDED.updated_by,
         updated_at=now()`,
      [
        String(guild.id),
        String(userId),
        returnAt,
        reason.trim(),
        JSON.stringify(snapshot),
        JSON.stringify(snapshot.supportRoles.map(x => x.id))
      ]
    );

    await this.safeRoleRemove(info.member, info.general.id);

    for (const role of info.teamRoles) {
      await this.safeRoleRemove(info.member, role.id);
    }

    for (const role of info.supportRoles) {
      await this.safeRoleRemove(info.member, role.id);
    }

    if (info.frozen) {
      await this.safeRoleAdd(info.member, info.frozen.id);
    }

    await this.upsertMemberState(guild.id, userId, false);

    await this.audit?.log?.({
      guildId: String(guild.id),
      actorId: String(userId),
      action: 'membership.personal.freeze',
      targetType: 'user',
      targetId: String(userId),
      newValue: {
        returnAt: returnAt.toISOString(),
        reason: reason.trim(),
        snapshot
      }
    }).catch(() => {});

    return snapshot;
  }


  async withdrawPersonal({ guild, userId, reason }) {
    const info = await this.personalMembership(guild, userId);

    const cleanReason = String(reason ?? '').trim();
    if (!cleanReason) {
      throw new AppError('REASON_REQUIRED', 'سبب الانسحاب مطلوب.');
    }

    if (info.state?.status === 'withdrawn') {
      throw new AppError('ALREADY_WITHDRAWN', 'عضويتك منسحبة بالفعل.');
    }

    if (info.state?.status === 'frozen') {
      throw new AppError(
        'MEMBER_FROZEN',
        'لا يمكن الانسحاب أثناء تجميد العضوية. انتظر انتهاء التجميد أولًا.'
      );
    }

    if (!info.general) {
      throw new AppError(
        'MEMBERSHIP_ROLE_NOT_FOUND',
        'رتبة عضوية عامة غير موجودة.'
      );
    }

    const snapshot = {
      capturedAt: new Date().toISOString(),
      generalRole: info.member.roles.cache.has(String(info.general.id)),
      teamRoles: info.teamRoles.map(role => ({
        id: String(role.id),
        name: role.name
      })),
      supportRoles: info.supportRoles.map(role => ({
        id: String(role.id),
        name: role.name
      }))
    };

    await this.db.query(
      `INSERT INTO membership_personal_states
       (
         guild_id,
         user_id,
         status,
         freeze_start_at,
         return_at,
         freeze_reason,
         snapshot,
         support_role_ids,
         updated_by,
         withdrawn_at,
         withdraw_reason,
         reactivation_requested_at,
         reactivation_status
       )
       VALUES(
         $1,$2,'withdrawn',
         NULL,NULL,NULL,
         $3::jsonb,
         '[]'::jsonb,
         $2,
         now(),
         $4,
         NULL,
         'none'
       )
       ON CONFLICT(guild_id,user_id)
       DO UPDATE SET
         status='withdrawn',
         freeze_start_at=NULL,
         return_at=NULL,
         freeze_reason=NULL,
         snapshot=EXCLUDED.snapshot,
         support_role_ids='[]'::jsonb,
         updated_by=EXCLUDED.updated_by,
         withdrawn_at=now(),
         withdraw_reason=EXCLUDED.withdraw_reason,
         reactivation_requested_at=NULL,
         reactivation_status='none',
         updated_at=now()`,
      [
        String(guild.id),
        String(userId),
        JSON.stringify(snapshot),
        cleanReason
      ]
    );

    await this.safeRoleRemove(info.member, info.general.id);

    for (const role of info.teamRoles) {
      await this.safeRoleRemove(info.member, role.id);
    }

    for (const role of info.supportRoles) {
      await this.safeRoleRemove(info.member, role.id);
    }

    if (info.frozen) {
      await this.safeRoleRemove(info.member, info.frozen.id);
    }

    await this.upsertMemberState(guild.id, userId, false);

    await this.audit?.log?.({
      guildId: String(guild.id),
      actorId: String(userId),
      action: 'membership.personal.withdraw',
      targetType: 'user',
      targetId: String(userId),
      newValue: {
        withdrawnAt: new Date().toISOString(),
        reason: cleanReason,
        snapshot
      }
    }).catch(() => {});

    return snapshot;
  }

  async requestPersonalReactivation({ guild, userId }) {
    const state = await this.personalState(guild.id, userId);

    if (state?.status !== 'withdrawn') {
      throw new AppError(
        'NOT_WITHDRAWN',
        'طلب إعادة التفعيل متاح فقط للعضوية المنسحبة.'
      );
    }

    if (!state.withdrawn_at) {
      throw new AppError(
        'WITHDRAWAL_DATE_MISSING',
        'لا يوجد تاريخ انسحاب محفوظ لهذه العضوية.'
      );
    }

    const withdrawnAt = new Date(state.withdrawn_at);
    const availableAt = new Date(
      withdrawnAt.getTime() + (7 * 24 * 60 * 60 * 1000)
    );

    if (new Date() < availableAt) {
      throw new AppError(
        'REACTIVATION_TOO_EARLY',
        `يمكنك طلب إعادة التفعيل <t:${Math.floor(availableAt.getTime()/1000)}:R>.`
      );
    }

    if (state.reactivation_status === 'pending') {
      throw new AppError(
        'REACTIVATION_PENDING',
        'طلب إعادة التفعيل الخاص بك قيد المراجعة بالفعل.'
      );
    }

    if (state.reactivation_status !== 'none') {
      throw new AppError(
        'REACTIVATION_ALREADY_USED',
        'سبق استخدام طلب إعادة التفعيل لهذه العضوية.'
      );
    }

    await this.db.query(
      `UPDATE membership_personal_states
       SET reactivation_requested_at=now(),
           reactivation_status='pending',
           updated_at=now()
       WHERE guild_id=$1
         AND user_id=$2
         AND status='withdrawn'`,
      [
        String(guild.id),
        String(userId)
      ]
    );

    await this.audit?.log?.({
      guildId: String(guild.id),
      actorId: String(userId),
      action: 'membership.personal.reactivation.requested',
      targetType: 'user',
      targetId: String(userId),
      newValue: {
        requestedAt: new Date().toISOString(),
        availableAt: availableAt.toISOString()
      }
    }).catch(() => {});

    return {
      requestedAt: new Date(),
      availableAt
    };
  }

  async setSupportMembership({ guild, userId, teamRoleId }) {
    const info = await this.personalMembership(guild, userId);

    const hasGeneralMembership =
      Boolean(
        info.general &&
        info.member.roles.cache.has(String(info.general.id))
      );

    const hasTeamMembership =
      Array.isArray(info.teamRoles) &&
      info.teamRoles.length > 0;

    const explicitInactiveState =
      ['frozen', 'withdrawn'].includes(
        String(info.state?.status ?? '')
      );

    const activeMembership =
      (hasGeneralMembership || hasTeamMembership) &&
      !explicitInactiveState;

    if (!activeMembership) {
      throw new AppError(
        'MEMBERSHIP_INACTIVE',
        'لا يمكن إدارة الفريق المساند إلا أثناء العضوية النشطة.'
      );
    }

    const supports = info.supportMap ?? await this.supportRoles(guild);

    const selected = supports.find(
      x => String(x.team.id) === String(teamRoleId)
    );

    if (!selected) {
      throw new AppError(
        'SUPPORT_TEAM_NOT_FOUND',
        'الفريق المساند المحدد غير موجود.'
      );
    }

    for (const item of supports) {
      await this.safeRoleRemove(
        info.member,
        item.support.id
      );
    }

    await this.safeRoleAdd(
      info.member,
      selected.support.id
    );

    const supportIds = [String(selected.support.id)];

    await this.db.query(
      `INSERT INTO membership_personal_states
       (guild_id,user_id,status,support_role_ids,updated_by)
       VALUES($1,$2,'active',$3::jsonb,$2)
       ON CONFLICT(guild_id,user_id)
       DO UPDATE SET
         support_role_ids=EXCLUDED.support_role_ids,
         updated_by=EXCLUDED.updated_by,
         updated_at=now()`,
      [
        String(guild.id),
        String(userId),
        JSON.stringify(supportIds)
      ]
    );

    await this.audit?.log?.({
      guildId: String(guild.id),
      actorId: String(userId),
      action: 'membership.personal.support.updated',
      targetType: 'user',
      targetId: String(userId),
      newValue: {
        supportRoleId: String(selected.support.id),
        supportRoleName: selected.support.name
      }
    }).catch(() => {});

    return selected;
  }

  async clearSupportMembership({ guild, userId }) {
    const info = await this.personalMembership(guild, userId);

    if (info.state?.status !== 'active') {
      throw new AppError(
        'MEMBERSHIP_INACTIVE',
        'لا يمكن إدارة الفريق المساند إلا أثناء العضوية النشطة.'
      );
    }

    for (const role of info.supportRoles) {
      await this.safeRoleRemove(info.member, role.id);
    }

    await this.db.query(
      `INSERT INTO membership_personal_states
       (guild_id,user_id,status,support_role_ids,updated_by)
       VALUES($1,$2,'active','[]'::jsonb,$2)
       ON CONFLICT(guild_id,user_id)
       DO UPDATE SET
         support_role_ids='[]'::jsonb,
         updated_by=EXCLUDED.updated_by,
         updated_at=now()`,
      [String(guild.id), String(userId)]
    );

    return true;
  }

  async processPersonalReturns(guild) {
    const { rows } = await this.db.query(
      `SELECT *
       FROM membership_personal_states
       WHERE guild_id=$1
         AND status='frozen'
         AND return_at IS NOT NULL
         AND return_at<=now()
       ORDER BY return_at ASC
       LIMIT 100`,
      [String(guild.id)]
    );

    for (const state of rows) {
      const member = await this.memberInGuild(guild, state.user_id);
      if (!member) continue;

      try {
        const snapshot = state.snapshot ?? {};

        if (snapshot.generalRole) {
          const general = [...guild.roles.cache.values()]
            .find(role =>
              normalizeRoleName(role.name) === normalizeRoleName('عضوية عامة')
            );

          if (general) {
            this.assertManageableRole(general, guild, { allowManaged: false });
            await this.safeRoleAdd(member, general.id);
          }
        }

        const frozen = [...guild.roles.cache.values()]
          .find(role =>
            normalizeRoleName(role.name) === normalizeRoleName(DEFAULT_FROZEN_ROLE)
          );

        if (frozen) {
          await this.safeRoleRemove(member, frozen.id);
        }

        for (const role of snapshot.teamRoles ?? []) {
          const liveRole = await this.roleById(guild, role.id);

          if (
            liveRole &&
            normalizeRoleName(liveRole.name) === normalizeRoleName(role.name)
          ) {
            this.assertManageableRole(liveRole, guild, { allowManaged: false });
            await this.safeRoleAdd(member, liveRole.id);
          }
        }

        for (const role of snapshot.supportRoles ?? []) {
          const liveRole = await this.roleById(guild, role.id);

          if (
            liveRole &&
            normalizeRoleName(liveRole.name) === normalizeRoleName(role.name)
          ) {
            this.assertManageableRole(liveRole, guild, { allowManaged: false });
            await this.safeRoleAdd(member, liveRole.id);
          }
        }

        await this.db.query(
          `UPDATE membership_personal_states
           SET status='active',
               updated_at=now()
           WHERE guild_id=$1 AND user_id=$2`,
          [String(guild.id), String(state.user_id)]
        );

        await this.upsertMemberState(guild.id, member.id, true);

        await this.audit?.log?.({
          guildId: String(guild.id),
          actorId: String(member.id),
          action: 'membership.personal.reactivated',
          targetType: 'user',
          targetId: String(member.id),
          newValue: { returnAt: state.return_at }
        }).catch(() => {});
      } catch (error) {
        this.logger?.error?.(
          'membership-personal-reactivation-failed',
          {
            userId: String(state.user_id),
            error: error?.stack ?? String(error)
          }
        );
      }
    }
  }

  async tick(guild=this.guild){
    if(this.running||!guild)return; this.running=true;
    try{ await this.processScheduledFreezes(guild); await this.processReturns(guild); await this.processPersonalReturns(guild); await this.closeExpiredCampaigns(guild); }
    finally{ this.running=false; }
  }

  start(guild){
    this.guild=guild;
    if(this.timer)return;
    this.timer=setInterval(()=>this.tick(guild).catch((error)=>this.logger?.error?.('membership-review-tick-failed',{error:error?.stack??String(error)})),60_000);
    this.timer.unref?.();
    this.tick(guild).catch((error)=>this.logger?.error?.('membership-review-initial-tick-failed',{error:error?.stack??String(error)}));
  }

  stop(){ if(this.timer)clearInterval(this.timer); this.timer=null; this.guild=null; }
}
