import {
  ActionRowBuilder,
  ButtonStyle,
  ModalBuilder,TextInputBuilder,
  TextInputStyle, StringSelectMenuBuilder,
} from 'discord.js';
import { e, btn, rowsFromButtons, withNavigation } from '../ui.js';
import { subjectFromInteraction } from '../context.js';
import { AppError } from '../../../core/errors/AppError.js';

const input=(id,label,placeholder,required=true,maxLength=100)=>new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(maxLength),
);
const reasonInput=()=>new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId('reason').setLabel('سبب التجميد').setPlaceholder('اكتب سبب التجميد باختصار').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(500),
);

const withdrawReasonInput=()=>new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId('reason').setLabel('سبب الانسحاب').setPlaceholder('اكتب سبب الانسحاب باختصار').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(500),
);
async function getSubject(i,a){return subjectFromInteraction(i,a.env);}
async function managerOnly(i,a){const s=await getSubject(i,a);await a.membershipReviewService.assertManager(s);return s;}
async function home(i,a,s){
  const current=await a.membershipReviewService.campaign(s.guildId);
  const teamRoles=await a.membershipReviewService.discoverTeamRoles(s.guild).catch(()=>[]);
  const statusAr={open:'🟢 مفتوحة',closed:'⚪ مغلقة',reported:'✅ تم إصدار التقرير'};

  const parts=[
    '## 🪪 إدارة العضويات',
    '',
    'يتم التعرف تلقائيًا على رتب العضوية والفرق المعتمدة داخل السيرفر.',
    '',
    '🪪 العضوية العامة: **عضوية عامة**',
    '🟡 حالة التجميد: **غير مفعل**',
    '👥 مسؤول النظام: **الموارد البشرية**',
    '',
    `👥 الفرق المعتمدة: ${teamRoles.length
      ? teamRoles.map(role=>role.name).join(' • ')
      : '⚠️ لم يتم العثور على رتب الفرق المعتمدة'}`,
    '',
    'يمكن تنفيذ إجراءات الإدارة من داخل السيرفر فقط.'
  ];

  if(current){
    parts.push(`آخر حملة: **${statusAr[current.status]??current.status}**`);
    parts.push(`النشر: <t:${Math.floor(new Date(current.published_at).getTime()/1000)}:F>`);
    parts.push(`الموعد النهائي: <t:${Math.floor(new Date(current.deadline_at).getTime()/1000)}:F>`);
    if(current.stats?.total)parts.push(`النتيجة: **${current.stats.responded??0}/${current.stats.total}** رد`);
  }else{
    parts.push('لا توجد حملة سابقة حتى الآن.');
  }

  const adminControls=i.guildId
    ? rowsFromButtons([
        btn('membership:publish','نشر إعلان التصفية',ButtonStyle.Success,'📢'),
        btn('membership:status','تقرير إدارة العضوية',ButtonStyle.Primary,'📊'),
        btn('membership:campaign-reports','تقرير إعلانات التصفية',ButtonStyle.Secondary,'📄'),
        btn('membership:scan-teams','فحص عضويات الفرق',ButtonStyle.Secondary,'👥')
      ])
    : rowsFromButtons([
        btn('panel:refresh','العودة للوحة الرئيسية',ButtonStyle.Secondary,'⬅️')
      ]);

  if(!i.guildId){
    parts.push(
      '',
      '⚠️ الإدارة التنفيذية متاحة من داخل سيرفر 967 فقط.',
      'أنت الآن في الرسائل الخاصة لذلك تم إخفاء إجراءات النشر والتنفيذ.'
    );
  }

  // adminControls already contains the DM fallback navigation button
  // when the interaction is outside the guild. Appending the default
  // navigation row again would duplicate custom_id=panel:refresh and Discord
  // rejects the whole message with COMPONENT_CUSTOM_ID_DUPLICATED.
  const finalComponents = i.guildId
    ? withNavigation(adminControls)
    : adminControls;

  return i.update({
    embeds:[e('🪪 إدارة العضويات',parts.join('\n'))],
    components:finalComponents
  });
}




async function campaignReportsOpen(i,a,s){
  const campaigns=await a.membershipReviewService.listCampaignReports(
    s.guildId,
    25
  );

  if(!campaigns.length){
    return i.update({
      embeds:[e(
        '📄 تقرير إعلانات التصفية',
        'لا توجد إعلانات تصفية محفوظة حتى الآن.'
      )],
      components:withNavigation(
        rowsFromButtons([
          btn(
            'membership:home',
            'العودة لإدارة العضويات',
            ButtonStyle.Primary,
            '⬅️'
          )
        ])
      )
    });
  }

  const statusAr={
    open:'🟢 مفتوح',
    closed:'⚪ مغلق',
    reported:'✅ تم إصدار التقرير'
  };

  const menu=new StringSelectMenuBuilder()
    .setCustomId('membership:campaign-reports:select')
    .setPlaceholder('اختر إعلان التصفية')
    .addOptions(
      campaigns.map((campaign,index)=>({
        label:`إعلان التصفية ${index+1}`,
        value:String(campaign.id),
        description:[
          statusAr[campaign.status]??campaign.status,
          campaign.published_at
            ? new Date(campaign.published_at).toLocaleDateString('ar-SA')
            : '—'
        ].join(' • ').slice(0,100),
        emoji:{name:campaign.status==='open'?'🟢':'📊'},
        disabled:false
      }))
    );

  return i.update({
    embeds:[e(
      '📄 تقرير إعلانات التصفية',
      [
        'يمكنك اختيار أي إعلان تصفية سابق لعرض تقريره الكامل.',
        '',
        'الإعلانات المفتوحة حاليًا غير قابلة لإصدار التقرير حتى انتهاء مهلة التصفية.'
      ].join('\n')
    )],
    components:[
      new ActionRowBuilder().addComponents(menu),
      ...withNavigation(
        rowsFromButtons([
          btn(
            'membership:home',
            'العودة لإدارة العضويات',
            ButtonStyle.Secondary,
            '⬅️'
          )
        ])
      )
    ]
  });
}

async function campaignReportsSelect(i,a,s){
  const campaignId=String(i.values?.[0]??'').trim();

  if(!campaignId){
    throw new AppError(
      'INVALID_CAMPAIGN',
      'إعلان التصفية المحدد غير صالح.'
    );
  }

  const report=await a.membershipReviewService.getOrCreateCampaignReport(
    s.guild,
    campaignId
  );

  const title=String(
    report.reportTitle ||
    report.fileName ||
    'تقرير إعلان التصفية'
  ).replace(/\.docx$/i,'');

  const fileName=String(
    report.fileName ||
    report.file?.split?.(/[\/]/).pop?.() ||
    'membership-report.docx'
  );

  const campaignStatus=report.campaign?.status==='open'
    ? '🟢 تقرير مرحلي — الحملة ما زالت مفتوحة'
    : '✅ تقرير الحملة';

  return i.update({
    embeds:[e(
      `📄 ${title}`,
      [
        campaignStatus,
        '',
        'تم إنشاء التقرير المؤسسي بالمسمى نفسه المستخدم في الملف.',
        `📎 اسم الملف: **${fileName}**`,
        '',
        'يحافظ التقرير الشامل على الهوية المعتمدة للمبادرة وشعاراتها الثلاثة.'
      ].join('\n')
    )],
    files:[{
      attachment:report.file,
      name:fileName
    }],
    components:withNavigation(
      rowsFromButtons([
        btn(
          'membership:campaign-reports',
          'العودة إلى إعلانات التصفية',
          ButtonStyle.Primary,
          '📄'
        ),
        btn(
          'membership:home',
          'إدارة العضويات',
          ButtonStyle.Secondary,
          '⬅️'
        )
      ])
    )
  });
}

async function scanTeams(i,a,s){
  const roles=await a.membershipReviewService.discoverTeamRoles(s.guild);
  const members=await s.guild.members.fetch();
  const lines=roles.map((role)=>{const count=[...members.values()].filter((m)=>!m.user.bot&&m.roles.cache.has(String(role.id))).length;return `• **${role.name}** — **${count}** عضو`;}).join('\n');
  return i.update({embeds:[e('👥 عضويات الفرق المعتمدة',roles.length?`النظام يتعرف على هذه الرتب الخمس فقط عند مراجعة العضويات، ولا يلمس أي رتبة أخرى:\n\n${lines}`:'لم يتم العثور على أي رتبة فريق معتمدة.')],components:withNavigation(rowsFromButtons([btn('membership:home','العودة لإدارة العضويات',ButtonStyle.Primary,'⬅️')]))});
}
async function publish(i,a,s){
  // The interaction adapter can resolve the configured guild through
  // subjectFromInteraction even when guildId is not exposed directly.
  // Reject only a real DM channel; the handler already validates the
  // resolved guild subject and manager permission.
  const isDirectMessage = Boolean(
    i.channel?.isDMBased?.()
    || (!i.guildId && i.channel?.type === 1)
  );

  if(isDirectMessage){
    throw new AppError(
      'BAD_CHANNEL',
      'يجب تنفيذ نشر حملة العضويات من داخل السيرفر.'
    );
  }

  const result=await a.membershipReviewService.publish({
    guild:s.guild,
    channel:i.channel,
    actorId:s.userId,
    actorMember:s.member
  });

  return i.update({
    embeds:[
      e(
        '✅ تم إطلاق مراجعة العضويات',
        [
          `📨 أُرسلت الرسالة الخاصة إلى **${result.totalMembers}** عضو.`,
          `✅ نجح الإرسال: **${result.dmSent}**`,
          `⚠️ تعذر الإرسال: **${result.dmFailed}**`,
          `⏳ الموعد النهائي: <t:${Math.floor(result.deadlineAt.getTime()/1000)}:F>`,
          '',
          'الردود تصل مباشرة إلى الحملة ولا تُنشر في قناة الإعلان.'
        ].join('\n')
      )
    ],
    components:withNavigation(
      rowsFromButtons([
        btn(
          'membership:home',
          'العودة لإدارة العضويات',
          ButtonStyle.Primary,
          '⬅️'
        )
      ])
    )
  });
}
async function status(i,a,s){
  const campaign=await a.membershipReviewService.campaign(s.guildId);
  if(!campaign)return i.update({embeds:[e('📊 حالة مراجعة العضويات','لا توجد حملة حتى الآن.')],components:withNavigation(rowsFromButtons([btn('membership:home','العودة',ButtonStyle.Primary,'⬅️')]))});
  const {rows}=await a.db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE choice='continue')::int continue_count,COUNT(*) FILTER(WHERE choice='freeze')::int freeze_count,COUNT(*) FILTER(WHERE choice='withdraw')::int withdraw_count,COUNT(*) FILTER(WHERE choice IS NULL)::int no_response FROM membership_campaign_members c LEFT JOIN membership_reviews r ON r.campaign_id=c.campaign_id AND r.user_id=c.user_id WHERE c.campaign_id=$1`,[campaign.id]);
  const x=rows[0]??{};const statusAr={open:'🟢 مفتوحة',closed:'⚪ مغلقة',reported:'✅ تم إصدار التقرير'};
  return i.update({embeds:[e('📊 حالة مراجعة العضويات',[
    `الحملة: **${statusAr[campaign.status]??campaign.status}**`,
    `النشر: <t:${Math.floor(new Date(campaign.published_at).getTime()/1000)}:F>`,
    `الإغلاق: <t:${Math.floor(new Date(campaign.deadline_at).getTime()/1000)}:F>`,'',
    `👥 الإجمالي: **${x.total??0}**`,`🟢 استمرار: **${x.continue_count??0}**`,`🟡 تجميد: **${x.freeze_count??0}**`,`🔴 انسحاب: **${x.withdraw_count??0}**`,`⚪ لم يرد: **${x.no_response??0}`,
  ].join('\n'))],components:withNavigation(rowsFromButtons([btn('membership:home','العودة',ButtonStyle.Primary,'⬅️')]))});
}

async function freezeOpen(i,a,s,campaignId){
  await a.membershipReviewService.openCampaign(s.guildId,campaignId);
  const modal=new ModalBuilder().setCustomId(`membership:freeze-submit:${campaignId}`).setTitle('تجميد العضوية');
  modal.addComponents(input('start','بداية التجميد','YYYY-MM-DD HH:mm أو الآن'),input('return','تاريخ العودة المؤكد','YYYY-MM-DD HH:mm'),reasonInput());
  return i.showModal(modal);
}
async function freezeSubmit(i,a,s,campaignId){
  const message=await a.membershipReviewService.freezeModal({guild:s.guild,interaction:i,campaignId,startInput:i.fields.getTextInputValue('start'),returnInput:i.fields.getTextInputValue('return'),reasonInput:i.fields.getTextInputValue('reason')});
  return i.reply({content:message,components:withNavigation([]),ephemeral:Boolean(i.guildId)});
}
async function choice(i,a,s,choiceName,campaignId){
  const message=await a.membershipReviewService.response({guild:s.guild,interaction:i,campaignId,choice:choiceName});
  return i.followUp({content:message,components:withNavigation([]),ephemeral:Boolean(i.guildId)});
}


async function personalHome(i,a,s){
  const info = await a.membershipReviewService.personalMembership(
    s.guild,
    s.userId
  );

  const state = info.state;

  const status =
    state?.status === 'frozen'
      ? '🟡 مجمدة'
      : state?.status === 'withdrawn'
        ? '🔴 منسحب'
        : '🟢 نشطة';

  const primary =
    info.teamRoles.length
      ? info.teamRoles.map(role => `<@&${role.id}>`).join(' • ')
      : 'لا يوجد فريق أساسي';

  const support =
    info.supportRoles.length
      ? info.supportRoles.map(role => `<@&${role.id}>`).join(' • ')
      : 'لا يوجد فريق مساند';

  const parts = [
    `حالة العضوية: **${status}**`,
    `👥 الفريق الأساسي: ${primary}`,
    `🤝 الفريق المساند: ${support}`,
  ];

  if(state?.status === 'frozen' && state.return_at){
    parts.push(
      '',
      `📅 العودة: <t:${Math.floor(new Date(state.return_at).getTime()/1000)}:F>`,
      `📝 سبب التجميد: **${state.freeze_reason ?? 'غير محدد'}**`
    );
  }

  if(state?.status === 'withdrawn'){
    parts.push(
      '',
      `📅 تاريخ الانسحاب: <t:${Math.floor(new Date(state.withdrawn_at ?? state.updated_at).getTime()/1000)}:F>`,
      `📝 سبب الانسحاب: **${state.withdraw_reason ?? 'غير محدد'}**`
    );

    if(state.reactivation_status === 'pending'){
      parts.push('⏳ طلب إعادة التفعيل: **قيد المراجعة**');
    }else if(state.return_at){
      const at = new Date(state.return_at).getTime();
      if(Date.now() >= at){
        parts.push('🔓 إعادة التفعيل: **متاحة الآن**');
      }else{
        parts.push(`🔓 إعادة التفعيل: <t:${Math.floor(at/1000)}:R>`);
      }
    }
  }

  const buttons = [];

  if(!state || state.status === 'active'){
    buttons.push(
      btn('member:membership:freeze','تجميد عضويتي',ButtonStyle.Secondary,'🟡'),
      btn('member:membership:withdraw','الانسحاب',ButtonStyle.Danger,'🔴'),
      btn('member:membership:support','مساندة فريق',ButtonStyle.Primary,'🤝')
    );
  }

  if(state?.status === 'frozen'){
    buttons.push(
      btn('member:membership:info','تفاصيل التجميد',ButtonStyle.Secondary,'📋')
    );
  }

  if(
    state?.status === 'withdrawn' &&
    state.reactivation_status === 'none' &&
    state.return_at &&
    Date.now() >= new Date(state.return_at).getTime()
  ){
    buttons.push(
      btn('member:membership:reactivate','طلب إعادة التفعيل',ButtonStyle.Success,'🔓')
    );
  }

  buttons.push(
    btn('member:membership','تحديث',ButtonStyle.Secondary,'🔄')
  );

  return i.update({
    embeds:[e('🪪 إدارة عضويتي',parts.join('\n'))],
    components:withNavigation(rowsFromButtons(buttons))
  });
}

async function personalWithdrawOpen(i,a,s){
  const info = await a.membershipReviewService.personalMembership(
    s.guild,
    s.userId
  );

  if(info.state?.status === 'withdrawn'){
    return i.reply({
      content:'🔴 عضويتك منسحبة بالفعل.',
      ephemeral:Boolean(i.guildId)
    });
  }

  if(info.state?.status === 'frozen'){
    return i.reply({
      content:'🟡 لا يمكن الانسحاب أثناء تجميد العضوية.',
      ephemeral:Boolean(i.guildId)
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('member:membership:withdraw-submit')
    .setTitle('الانسحاب من العضوية');

  modal.addComponents(withdrawReasonInput());

  return i.showModal(modal);
}

async function personalWithdrawSubmit(i,a,s){
  const reason = i.fields.getTextInputValue('reason')?.trim();

  if(!reason){
    return i.reply({
      content:'❌ سبب الانسحاب مطلوب.',
      ephemeral:Boolean(i.guildId)
    });
  }

  try{
    const result = await a.membershipReviewService.withdrawPersonal({
      guild:s.guild,
      userId:s.userId,
      reason
    });

    return i.reply({
      content:
        `🔴 تم تسجيل انسحابك بنجاح\n` +
        `📅 يمكنك طلب إعادة التفعيل <t:${Math.floor(result.reactivationAvailableAt?.getTime?.()/1000)}:F>`,
      ephemeral:Boolean(i.guildId)
    });
  }catch(error){
    return i.reply({
      content:`❌ ${error?.message ?? 'تعذر تنفيذ الانسحاب.'}`,
      ephemeral:Boolean(i.guildId)
    });
  }
}

async function personalReactivationRequest(i,a,s){
  try{
    const result = await a.membershipReviewService.requestPersonalReactivation({
      guild:s.guild,
      userId:s.userId
    });

    return i.reply({
      content:
        `✅ تم إرسال طلب إعادة تفعيل عضويتك\n` +
        `📅 وقت الطلب: <t:${Math.floor(result.requestedAt.getTime()/1000)}:F>\n` +
        `⏳ الطلب الآن قيد المراجعة`,
      ephemeral:Boolean(i.guildId)
    });
  }catch(error){
    return i.reply({
      content:`❌ ${error?.message ?? 'تعذر إرسال طلب إعادة التفعيل.'}`,
      ephemeral:Boolean(i.guildId)
    });
  }
}

async function personalFreezeOpen(i,a,s){
  const info = await a.membershipReviewService.personalMembership(
    s.guild,
    s.userId
  );

  if(info.state?.status === 'frozen'){
    return i.reply({
      content:'🟡 عضويتك مجمدة بالفعل.',
      ephemeral:Boolean(i.guildId)
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('member:membership:freeze-submit')
    .setTitle('تجميد عضويتي');

  modal.addComponents(
    input(
      'return',
      'تاريخ العودة',
      'YYYY-MM-DD HH:mm',
      true,
      50
    ),
    reasonInput()
  );

  return i.showModal(modal);
}

async function personalFreezeSubmit(i,a,s){
  const returnInput =
    i.fields.getTextInputValue('return')?.trim();

  const reason =
    i.fields.getTextInputValue('reason')?.trim();

  if(!returnInput || !reason){
    return i.reply({
      content:'❌ تاريخ العودة وسبب التجميد مطلوبان.',
      ephemeral:Boolean(i.guildId)
    });
  }

  let returnAt;

  try{
    const { DateTime } = await import('luxon');

    const dt = DateTime.fromFormat(
      returnInput,
      'yyyy-MM-dd HH:mm',
      { zone:'Asia/Aden' }
    );

    if(!dt.isValid){
      throw new Error('invalid-date');
    }

    returnAt = dt.toJSDate();
  }catch{
    return i.reply({
      content:'❌ صيغة التاريخ غير صحيحة\nاستخدم YYYY-MM-DD HH:mm',
      ephemeral:Boolean(i.guildId)
    });
  }

  if(!returnAt) return;

  try{
    await a.membershipReviewService.freezePersonal({
      guild:s.guild,
      userId:s.userId,
      returnAt,
      reason
    });

    return i.reply({
      content:
        `🟡 تم تجميد عضويتك بنجاح\n` +
        `📅 العودة: <t:${Math.floor(returnAt.getTime()/1000)}:F>\n` +
        `📝 السبب: ${reason}\n\n` +
        `سيتم استرجاع عضويتك وأدوارك المحفوظة تلقائيًا عند موعد العودة.`,
      ephemeral:Boolean(i.guildId)
    });
  }catch(error){
    return i.reply({
      content:`❌ ${error?.message ?? 'تعذر تجميد العضوية.'}`,
      ephemeral:Boolean(i.guildId)
    });
  }
}

async function personalSupportOpen(i,a,s){
  const state =
    await a.membershipReviewService.personalState(
      s.guild.id,
      s.userId
    );

  if(state?.status === 'frozen'){
    return i.reply({
      content:'🟡 لا يمكن تغيير الفريق المساند أثناء تجميد العضوية.',
      ephemeral:Boolean(i.guildId)
    });
  }

  const member =
    await a.membershipReviewService.memberInGuild(
      s.guild,
      s.userId
    );

  if(!member || member.user.bot){
    return i.reply({
      content:'❌ تعذر العثور على عضويتك داخل السيرفر.',
      ephemeral:Boolean(i.guildId)
    });
  }

  const supports =
    await a.membershipReviewService.supportRoles(s.guild);

  const currentSupportIds = new Set(
    supports
      .filter(item =>
        item?.support &&
        member.roles.cache.has(String(item.support.id))
      )
      .map(item => String(item.support.id))
  );

  const options = supports
    .filter(item => item?.team && item?.support)
    .map(item => ({
      label:String(item.team.name).slice(0,100),
      description:
        currentSupportIds.has(String(item.support.id))
          ? '✅ هذا هو فريقك المساند الحالي'
          : `العمل كمساند لدى ${item.team.name}`.slice(0,100),
      value:String(item.team.id),
      emoji:{name:'🤝'}
    }));

  options.push({
    label:'إلغاء المساندة',
    description:'إزالة فريق المساندة الحالي',
    value:'none',
    emoji:{name:'🚫'}
  });

  if(options.length === 1){
    return i.reply({
      content:'❌ لا توجد فرق مساندة متاحة حاليًا.',
      ephemeral:Boolean(i.guildId)
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('member:membership:support-submit')
    .setPlaceholder(
      currentSupportIds.size
        ? `الحالي: ${supports.find(
            item =>
              currentSupportIds.has(String(item.support.id))
          )?.team?.name ?? 'محدد'}`
        : 'اختر الفريق المساند'
    )
    .addOptions(options);

  return i.update({
    embeds:[
      e(
        '🤝 الفريق المساند',
        'اختر الفريق الذي تريد أن تعمل معه كمساند\\n\\n' +
        'يمكنك اختيار فريق مساند واحد فقط، وهو منفصل عن فريقك الأساسي.'
      )
    ],
    components:withNavigation([
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        btn(
          'member:membership',
          'العودة',
          ButtonStyle.Secondary,
          '⬅️'
        )
      )
    ])
  });
}

async function personalSupportSubmit(i,a,s){
  const teamRoleId =
    i.values?.[0];

  if(!teamRoleId){
    return i.reply({
      content:'❌ لم يتم اختيار فريق.',
      ephemeral:Boolean(i.guildId)
    });
  }

  try{
    if(teamRoleId === 'none'){
      await a.membershipReviewService.clearSupportMembership({
        guild:s.guild,
        userId:s.userId
      });

      return i.reply({
        content:'✅ تم إلغاء الفريق المساند.',
        ephemeral:Boolean(i.guildId)
      });
    }

    const selected =
      await a.membershipReviewService.setSupportMembership({
        guild:s.guild,
        userId:s.userId,
        teamRoleId
      });

    return i.reply({
      content:`🤝 تم تعيينك كمساند لفريق **${selected.team.name}**`,
      ephemeral:Boolean(i.guildId)
    });
  }catch(error){
    return i.reply({
      content:`❌ ${error?.message ?? 'تعذر تحديث الفريق المساند.'}`,
      ephemeral:Boolean(i.guildId)
    });
  }
}

export async function handleMembership(i,a){
  const id=String(i.customId??'');
  const s=await getSubject(i,a);

  if(!s.guildId || !s.guild){
    throw new AppError('BAD_GUILD','إدارة العضويات متاحة من داخل السيرفر فقط.');
  }

  if(id==='member:membership'){
    return personalHome(i,a,s);
  }

  if(id==='member:membership:freeze'){
    return personalFreezeOpen(i,a,s);
  }

  if(id==='member:membership:withdraw'){
    return personalWithdrawOpen(i,a,s);
  }

  if(id==='member:membership:withdraw-submit'){
    return personalWithdrawSubmit(i,a,s);
  }

  if(id==='member:membership:reactivate'){
    return personalReactivationRequest(i,a,s);
  }

  if(id==='member:membership:freeze-submit'){
    return personalFreezeSubmit(i,a,s);
  }

  if(id==='member:membership:support'){
    return personalSupportOpen(i,a,s);
  }

  if(id==='member:membership:support-submit'){
    return personalSupportSubmit(i,a,s);
  }

  if(id==='member:membership:info'){
    return personalHome(i,a,s);
  }

  if(id==='admin:membership'||id==='membership:home'){
    await a.membershipReviewService.assertManager(s);
    return home(i,a,s);
  }

  if(id==='membership:scan-teams'){
    await a.membershipReviewService.assertManager(s);
    return scanTeams(i,a,s);
  }

  if(id==='membership:publish'){
    await a.membershipReviewService.assertManager(s);
    return publish(i,a,s);
  }

  if(id==='membership:status'){
    await a.membershipReviewService.assertManager(s);
    return status(i,a,s);
  }

  if(id==='membership:campaign-reports'){
    await a.membershipReviewService.assertManager(s);
    return campaignReportsOpen(i,a,s);
  }

  if(id==='membership:campaign-reports:select'){
    await a.membershipReviewService.assertManager(s);
    return campaignReportsSelect(i,a,s);
  }

  if(id.startsWith('membership:choice:')){
    const parts=id.split(':');
    return choice(i,a,s,parts[2],parts[3]);
  }

  if(id.startsWith('membership:freeze:')){
    return freezeOpen(i,a,s,id.split(':')[2]);
  }

  if(id.startsWith('membership:freeze-submit:')){
    return freezeSubmit(i,a,s,id.split(':')[2]);
  }

  return false;
}
