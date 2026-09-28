import { memberDeliveryMode, setMemberDeliveryMode } from '../../application/services/memberDeliveryControl.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
} from 'discord.js';

const PAGE_SIZE = 20;
const STATUS = {
  upcoming: ['🟡', 'قادم'],
  ongoing: ['🔴', 'جارٍ الآن'],
  ended: ['⚫', 'منتهي'],
  canceled: ['⛔', 'ملغي'],
  postponed: ['🟠', 'مؤجل'],
};
const KIND = {
  ongoing: { title: 'الاجتماعات الجارية الآن', emoji: '🔴', statuses: ['ongoing'] },
  upcoming: { title: 'الاجتماعات القادمة', emoji: '🟡', statuses: ['upcoming'] },
  past: { title: 'الاجتماعات السابقة', emoji: '🗂️', statuses: ['ended', 'canceled', 'postponed'] },
};

const unix = (value) => value ? Math.floor(new Date(value).getTime() / 1000) : null;
const discordTime = (value, style = 'F') => value ? `<t:${unix(value)}:${style}>` : '—';
const clip = (value, max = 900) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || '—';
const num = (value) => Number(value ?? 0);

function durationText(seconds) {
  seconds = Math.max(0, Math.floor(num(seconds)));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}س ${m}د`;
  if (m) return `${m}د ${s}ث`;
  return `${s}ث`;
}

function meetingDuration(meeting) {
  if (!meeting.started_at) return 'لم يبدأ';
  const start = new Date(meeting.started_at).getTime();
  const end = meeting.ended_at ? new Date(meeting.ended_at).getTime() : Date.now();
  return durationText((end - start) / 1000);
}

function embed(title, description) {
  return new EmbedBuilder()
    .setTitle(title.slice(0, 256))
    .setDescription(String(description || '—').slice(0, 4096))
    .setFooter({ text: 'Meeting 967 • مركز اجتماعات المالك' })
    .setTimestamp();
}

function button(id, label, style = ButtonStyle.Secondary, emoji = null, disabled = false) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label.slice(0, 80)).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function buttonRows(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return rows.slice(0, 5);
}

function meetingStatus(status) {
  const [emoji, label] = STATUS[status] ?? ['⚪', status || 'غير معروف'];
  return `${emoji} ${label}`;
}

async function ensureOwner(interaction, app) {
  if (app.permissionService.isOwner(interaction.user.id)) return true;
  await interaction.update({
    embeds: [embed('غير مصرح', 'مركز الاجتماعات الشامل مخصص لمالك النظام فقط.')],
    components: buttonRows([button('panel:refresh', 'العودة للوحة', ButtonStyle.Secondary, '↩️')]),
  });
  return false;
}


// operations967-system-health-center-v1:ui
function healthBytes(value){
  let n=Number(value??0);
  if(!Number.isFinite(n)||n<=0)return '0 B';
  const units=['B','KB','MB','GB','TB'];
  let i=0;
  while(n>=1024&&i<units.length-1){n/=1024;i++;}
  return `${n.toFixed(i?1:0)} ${units[i]}`;
}
function healthAgo(value){
  if(!value)return '—';
  const ms=new Date(value).getTime();
  if(!Number.isFinite(ms))return '—';
  const sec=Math.max(0,Math.floor((Date.now()-ms)/1000));
  if(sec<60)return `قبل ${sec}ث`;
  if(sec<3600)return `قبل ${Math.floor(sec/60)}د`;
  if(sec<86400)return `قبل ${Math.floor(sec/3600)}س`;
  return `قبل ${Math.floor(sec/86400)}ي`;
}
function healthTeam(scope){
  return ({
    media:'الإعلام',hr:'الموارد البشرية',executive:'التنفيذي',
    governance:'الإدارة والحوكمة',tech:'التقنية والبحث والبيانات',
    general:'الاجتماعات العامة',membership:'العضوية',projects:'المشاريع',any:'عام',
  })[String(scope??'').toLowerCase()]??clip(scope||'غير محدد',50);
}
function healthRecorder(x){
  return x?.recorderType==='main'?'البوت الأساسي':x?.workerNumber?`Worker ${x.workerNumber}`:clip(x?.recorderKey||'غير معروف',50);
}
async function healthSnapshot(interaction,app){
  if(!app.systemHealthService)throw new Error('SystemHealthService غير متاح في النسخة الحالية.');
  return app.systemHealthService.snapshot(interaction.client);
}
async function healthHome(interaction,app){
  const s=await healthSnapshot(interaction,app);
  const overall=s.overall==='healthy'?'🟢 **سليم**':'🟠 **يحتاج انتباه**';
  const failover=s.failover.ready?'✅ جاهز':s.failover.mainBusy?'🟡 البوت الأساسي مشغول بتسجيل':'❌ غير جاهز';
  const active=s.activeRecordings.length
    ? `${s.activeRecordings.length} تسجيل — ${s.activeRecordings.map(healthRecorder).join('، ')}`
    : 'لا يوجد تسجيل نشط';
  const storage=s.storage.ready
    ? `${healthBytes(s.storage.freeBytes)} حرة من ${healthBytes(s.storage.totalBytes)}`
    : 'تعذر قراءة المساحة';
  const issues=s.issues.length?s.issues.map(x=>`• ${clip(x.label,180)}`):['• لا توجد مشكلة تشغيلية حرجة.'];
  const test=s.testLab?`${s.testLab.status==='completed'?'✅':'⚠️'} ${clip(s.testLab.teamName||'آخر تجربة',70)}`:'—';
  const lines=[
    `**الحالة العامة:** ${overall}`,'',
    `🤖 **Main Bot:** ${s.main.online?'✅ Online':'❌ Offline'} • ${s.main.pingMs??'—'}ms • Uptime ${s.processInfo.uptimeText}`,
    `🎙️ **Recording Workers:** ${s.workerSummary.ready}/${s.workerSummary.configured} جاهزين • ${s.workerSummary.busy} مشغولين`,
    `🔄 **Failover إلى Main:** ${failover}`,
    `🐘 **PostgreSQL:** ${s.database.ready?`✅ ${s.database.latencyMs}ms`:'❌ غير جاهزة'}`,
    `🎧 **التسجيل:** ${active}`,
    `📅 **الاجتماعات:** ${s.meetings.ongoing??0} جارية • ${s.meetings.upcoming??0} قادمة`,
    `💾 **التخزين:** ${storage} • تسجيلات مفهرسة ${healthBytes(s.storage.recordedBytes)}`,
    `🧠 **ذاكرة Node:** RSS ${healthBytes(s.processInfo.rssBytes)} • Heap ${healthBytes(s.processInfo.heapUsedBytes)}`,
    `⚠️ **الأخطاء:** ${s.errors.errors1h} آخر ساعة • ${s.errors.errors24h} آخر 24 ساعة`,
    `🧪 **آخر Test Lab:** ${test}`,'','**التشخيص:**',...issues,'',
    `آخر تحديث: ${discordTime(s.generatedAt,'T')} • الفحص ${s.latencyMs}ms`,
  ];
  return interaction.update({content:null,embeds:[embed('🛡️ صحة نظام Operations 967',lines.join('\n'))],components:buttonRows([
    button('owner:meeting-center:health','تحديث',ButtonStyle.Secondary,'🔄'),
    button('owner:meeting-center:health-workers','Workers',ButtonStyle.Primary,'🎙️'),
    button('owner:meeting-center:health-recordings','التسجيل الآن',ButtonStyle.Primary,'🎧'),
    button('owner:meeting-center:health-errors','التشخيص',ButtonStyle.Secondary,'⚠️'),
    button('owner:meeting-center:list:ongoing:0','الاجتماعات الجارية',ButtonStyle.Secondary,'🔴'),
    button('owner:meeting-center','مركز الاجتماعات',ButtonStyle.Secondary,'↩️'),
  ])});
}
async function healthWorkers(interaction,app){
  const s=await healthSnapshot(interaction,app);
  const lines=s.workers.length?s.workers.map(w=>{
    const state=w.ready?'✅ Online':'❌ Offline';
    const busy=w.busy?` • 🔴 مشغول${w.meetingId?` — اجتماع ${clip(w.meetingId,36)}`:''}`:' • ⚪ متاح';
    return `**Worker ${w.number}** — ${healthTeam(w.teamScope)}\n${state} • Ping ${w.pingMs??'—'}ms${busy}${w.tag?`\n${clip(w.tag,100)}`:''}`;
  }):['لا يوجد Recording Workers مضبوطون في البيئة الحالية.'];
  lines.push('',`**الإجمالي:** ${s.workerSummary.ready}/${s.workerSummary.configured} جاهزين`,`**Main Failover:** ${s.failover.ready?'✅ متاح الآن':s.failover.mainBusy?'🟡 Main مشغول حاليًا':'❌ غير متاح'}`,'','لا يعرض هذا المركز أي Token أو قيمة سرية.');
  return interaction.update({content:null,embeds:[embed('🎙️ صحة Recording Workers',lines.join('\n'))],components:buttonRows([
    button('owner:meeting-center:health-workers','تحديث',ButtonStyle.Secondary,'🔄'),button('owner:meeting-center:health','صحة النظام',ButtonStyle.Primary,'🛡️'),button('owner:meeting-center','رجوع',ButtonStyle.Secondary,'↩️')
  ])});
}
async function healthRecordings(interaction,app){
  const s=await healthSnapshot(interaction,app);
  const lines=s.activeRecordings.length?s.activeRecordings.map((r,i)=>[
    `**${i+1}. ${clip(r.meetingName,100)}**`,`المسجل: ${healthRecorder(r)}`,r.voiceChannelId?`القناة: <#${r.voiceChannelId}>`:null,r.startedAt?`بدأ: ${discordTime(r.startedAt,'R')}`:null,
  ].filter(Boolean).join('\n')):['⚪ لا يوجد تسجيل صوتي نشط حاليًا.'];
  lines.push('',`Main recorder: ${s.failover.mainBusy?'🔴 مشغول':'🟢 متاح للـFailover'}`,`Workers المشغولون: ${s.workerSummary.busy}/${s.workerSummary.configured}`);
  return interaction.update({content:null,embeds:[embed('🎧 التسجيلات النشطة',lines.join('\n\n'))],components:buttonRows([
    button('owner:meeting-center:health-recordings','تحديث',ButtonStyle.Secondary,'🔄'),button('owner:meeting-center:health-workers','Workers',ButtonStyle.Secondary,'🎙️'),button('owner:meeting-center:health','صحة النظام',ButtonStyle.Primary,'🛡️'),button('owner:meeting-center','رجوع',ButtonStyle.Secondary,'↩️')
  ])});
}
async function healthErrors(interaction,app){
  const s=await healthSnapshot(interaction,app);
  const storage=s.storage.ready?`${healthBytes(s.storage.freeBytes)} حرة (${s.storage.freeRatio!=null?Math.round(s.storage.freeRatio*100):'—'}%)`:`غير متاح${s.storage.error?` — ${clip(s.storage.error,180)}`:''}`;
  const lines=[
    `🐘 **PostgreSQL:** ${s.database.ready?`✅ ${s.database.latencyMs}ms`:`❌ ${clip(s.database.error||'غير جاهزة',220)}`}`,
    `💾 **المساحة:** ${storage}`,`🧠 **RSS:** ${healthBytes(s.processInfo.rssBytes)} • **Heap:** ${healthBytes(s.processInfo.heapUsedBytes)}/${healthBytes(s.processInfo.heapTotalBytes)}`,'',
    `⚠️ **Errors:** ${s.errors.errors1h} آخر ساعة • ${s.errors.errors24h} آخر 24 ساعة`,`🟡 **Warnings:** ${s.errors.warnings1h} آخر ساعة • ${s.errors.warnings24h} آخر 24 ساعة`,
    `**آخر Error:** ${s.errors.lastErrorAt?`${healthAgo(s.errors.lastErrorAt)} — ${clip(s.errors.lastErrorMessage||'error',300)}`:'لا يوجد Error حديث في الجزء المفحوص من السجل.'}`,'','**مشاكل المراقبة الحالية:**',
    ...(s.issues.length?s.issues.map(x=>`• ${clip(x.label,200)}`):['• لا توجد.']),'','🔔 يراقب النظام PostgreSQL والـWorkers والمساحة تلقائيًا، ويرسل للمالك DM عند تغيّر مشكلة تشغيلية حرجة ثم رسالة تعافٍ عند عودة الحالة سليمة.',
  ];
  return interaction.update({content:null,embeds:[embed('⚠️ تشخيص Operations 967',lines.join('\n'))],components:buttonRows([
    button('owner:meeting-center:health-errors','تحديث',ButtonStyle.Secondary,'🔄'),button('owner:meeting-center:health','صحة النظام',ButtonStyle.Primary,'🛡️'),button('owner:meeting-center','رجوع',ButtonStyle.Secondary,'↩️')
  ])});
}

// delivery-mode:owner-ui
async function deliveryModeControlScreen(interaction,app){
  const mode=await memberDeliveryMode(app.db,app.env.GUILD_ID);
  const modeInfo={
    off:{icon:'🔴',label:'إيقاف كل الإرسال',text:'لن يرسل البوت رسائل تلقائية للأعضاء أو لقنوات الفرق. التسجيل والحضور والتقارير والأرشفة تستمر داخليًا.'},
    team_only:{icon:'🟡',label:'مخرجات قناة الفريق',text:'التقرير والتسجيل والمخرجات تبقى في قناة الفريق فقط، بينما التذكيرات الشخصية والتكليفات ومراجعات المهام تستمر في الخاص للأشخاص المعنيين.'},
    full:{icon:'🟢',label:'التنبيهات الشخصية مفعلة',text:'تعمل التذكيرات والتنبيهات الشخصية المسموح بها، بينما التقارير والتسجيلات تبقى دائمًا في قناة الفريق فقط ولا تُرسل بالخاص.'},
  }[mode]??{icon:'⚪',label:mode,text:'حالة غير معروفة.'};
  const desc=[
    '**الحالة الحالية:** '+modeInfo.icon+' **'+modeInfo.label+'**',
    '',modeInfo.text,'',
    '**لا يتأثر بهذا الخيار:**',
    '• بقاء البوت أونلاين',
    '• Autopilot وبدء/إنهاء الاجتماعات',
    '• التسجيل الصوتي وحساب الحضور والغياب',
    '• إنشاء التقارير وحفظ الأرشيف',
    '• لوحة التحكم وردود الأوامر التي تطلبها أنت',
    '',
    '📌 **قاعدة ثابتة:** التقرير النهائي والتسجيل يُنشران مرة واحدة في قناة الفريق فقط، ولا يتم إرسالهما كرسائل خاصة لأي عضو.',
    '',
    'تنبيهات المالك الإدارية عن الأعطال تبقى متاحة حتى لا تضيع عليك المشاكل التشغيلية.',
  ].join('\n');
  const controls=[
    button('owner:meeting-center:delivery-mode-off','إيقاف الكل',ButtonStyle.Danger,'🔕',mode==='off'),
    button('owner:meeting-center:delivery-mode-team','قناة الفريق فقط',ButtonStyle.Primary,'📢',mode==='team_only'),
    button('owner:meeting-center:delivery-mode-full','إرسال كامل',ButtonStyle.Success,'🔔',mode==='full'),
    button('owner:meeting-center:delivery-control','تحديث',ButtonStyle.Secondary,'🔄'),
    button('owner:meeting-center','رجوع',ButtonStyle.Secondary,'↩️'),
  ];
  return interaction.update({embeds:[embed('📨 تحكم الإرسال',desc)],components:buttonRows(controls)});
}

async function setDeliveryModeFromOwner(interaction,app,mode){
  await setMemberDeliveryMode(app.db,app.env.GUILD_ID,mode,interaction.user.id);
  await app.audit?.log?.({
    guildId:app.env.GUILD_ID,
    actorId:interaction.user.id,
    action:'outgoing_delivery.mode_changed',
    targetType:'settings',
    newValue:{delivery_mode:mode},
  }).catch(()=>{});
  return deliveryModeControlScreen(interaction,app);
}

// test-lab-v3.0:owner-functions:start
const TESTLAB_DIRECT_LIMIT = 23 * 1024 * 1024;

function testLabJsonPaths(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  if (typeof value === 'string') {
    try { const v = JSON.parse(value); if (Array.isArray(v)) return v.filter(Boolean).map(String); } catch {}
    return [value];
  }
  return [];
}

function testLabBytes(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(1)} MB`;
}

async function testLabPayload(app) {
  const guildId=app.env.GUILD_ID;
  const [active,runs]=await Promise.all([app.testLabService.active(guildId),app.testLabService.recent(guildId,6)]);
  const last=runs.find(x=>['completed','failed'].includes(x.status))??null;
  const lines=[];
  if(active){
    lines.push(`🔴 **اختبار جارٍ الآن**`);
    lines.push(`الفريق: **${clip(active.team_name,80)}**`);
    lines.push(`القناة: <#${active.voice_channel_id}>`);
    lines.push(`المسجل: **${app.testLabService.recorderLabel(active)}**${active.recorder_user_id?` — <@${active.recorder_user_id}>`:''}`);
    lines.push(`بدأ: ${discordTime(active.started_at,'R')}`);
  }else lines.push('⚪ لا يوجد اختبار جارٍ الآن.');
  lines.push('','**العزل:** لا DM، لا قناة فريق، لا تنبيهات، لا تسليم تلقائي، ولا يدخل الاجتماع التجريبي في سجلات الأعضاء الحقيقية.');
  if(last){
    lines.push('','**آخر نتيجة:**',`• ${clip(last.team_name,70)} — ${last.status==='completed'?'✅ مكتمل':'❌ فشل'}`,
      `• التقرير: ${last.report_path?`✅ ${testLabBytes(last.report_bytes)}`:'—'}`,
      `• التسجيل: ${testLabJsonPaths(last.recording_paths).length?`✅ ${testLabBytes(last.recording_bytes)}`:'—'}`,
      `• المسجل: ${app.testLabService.recorderLabel(last)}`,
      ...(last.error?[`• ملاحظة: ${clip(last.error,400)}`]:[]));
  }
  const controls=[];
  // test-lab-owner-failover-v6:owner-ui
  if(active){
    controls.push(button('owner:meeting-center:testlab-end','إنهاء الاختبار',ButtonStyle.Danger,'⏹️'));
    const meta=(active.metadata && typeof active.metadata==='object')?active.metadata:{};
    if(/^worker:\d+:/.test(String(active.recorder_key??'')) && meta.testFailover!==true){
      controls.push(button('owner:meeting-center:testlab-failover','اختبار Failover',ButtonStyle.Primary,'⚡'));
    }
  }else controls.push(button('owner:meeting-center:testlab-new','بدء اختبار جديد',ButtonStyle.Success,'🧪'));
  if(last?.report_path)controls.push(button('owner:meeting-center:testlab-report','آخر تقرير',ButtonStyle.Primary,'📄'));
  if(testLabJsonPaths(last?.recording_paths).length)controls.push(button('owner:meeting-center:testlab-recording','آخر تسجيل',ButtonStyle.Primary,'🎙️'));
  controls.push(button('owner:meeting-center:testlab-purge','حذف بيانات التجارب',ButtonStyle.Secondary,'🧹'));
  controls.push(button('owner:meeting-center:testlab-hide','إخفاء خيار التجارب',ButtonStyle.Danger,'🗑️'));
  controls.push(button('owner:meeting-center','رجوع',ButtonStyle.Secondary,'↩️'));
  return {content:null,embeds:[embed('🧪 مختبر التجارب — المالك فقط',lines.join('\n'))],components:buttonRows(controls)};
}

async function testLabTeamPicker(interaction,app){
  if(await app.testLabService.active(app.env.GUILD_ID))return interaction.update(await testLabPayload(app));
  const teams=(await app.teams.list(app.env.GUILD_ID)).slice(0,24);
  if(!teams.length)return interaction.update({embeds:[embed('🧪 مختبر التجارب','لا توجد فرق نشطة للاختبار.')],components:buttonRows([button('owner:meeting-center:testlab','رجوع',ButtonStyle.Secondary,'↩️')])});
  const options=[
    {label:'الاجتماعات العامة',value:'__general__',description:'Worker 6 • الدردشة-الصوتية'},
    ...teams.map(t=>({label:clip(t.name,100),value:String(t.id),description:clip(t.default_voice_channel_id?'اختره ثم حدد قناة الاختبار':'اختره ثم حدد قناة صوتية',100)})),
  ];
  const select=new StringSelectMenuBuilder().setCustomId('owner:meeting-center:testlab-team').setPlaceholder('اختر المسجل الذي تريد اختباره').addOptions(options);
  return interaction.update({content:null,embeds:[embed('🧪 اختبار جديد','اختر الفريق أولًا. النظام سيستخدم مسجل هذا الفريق حسب Recording Worker Pool الحالي، ثم سيعرض لك فعليًا أي Bot استلم التسجيل.')],components:[new ActionRowBuilder().addComponents(select),...buttonRows([button('owner:meeting-center:testlab','إلغاء',ButtonStyle.Secondary,'↩️')])]});
}

async function testLabVoicePicker(interaction,app,teamId){
  const generalMode=String(teamId)==='__general__';
  const team=generalMode
    ? (await app.teams.list(app.env.GUILD_ID)).find(t=>!t.deleted_at)
    : await app.teams.get(teamId);
  if(!team)return interaction.update(await testLabPayload(app));
  const displayName=generalMode?'الاجتماعات العامة':team.name;

  // v1.9.3.3 — DM-safe guild/channel picker.
  // The Discord client belongs to the interaction, not to the app services container.
  const discordClient=interaction.client;
  const guildId=String(process.env.GUILD_ID ?? app.env?.GUILD_ID ?? '').trim();

  let guild=interaction.guild ?? null;

  if(!guild && guildId){
    guild=
      discordClient?.guilds?.cache?.get?.(guildId) ??
      await discordClient?.guilds?.fetch?.(guildId).catch(()=>null);
  }

  // Safe fallback for the normal Meeting 967 setup when the main bot is in one guild.
  if(!guild){
    guild=discordClient?.guilds?.cache?.first?.() ?? null;
  }

  // Last fallback: fetch the bot's guild list from Discord, then fetch the first guild.
  if(!guild){
    const guildList=await discordClient?.guilds?.fetch?.().catch(()=>null);
    const firstGuild=guildList?.first?.() ?? null;
    if(firstGuild?.id){
      guild=await discordClient.guilds.fetch(firstGuild.id).catch(()=>null);
    }
  }

  if(!guild){
    return interaction.update({
      content:null,
      embeds:[embed(
        '🧪 اختيار قناة الاختبار',
        'تعذر الوصول إلى سيرفر 967 من البوت الأساسي. البوت متصل بديسكورد لكن لم يتمكن من تحديد السيرفر.'
      )],
      components:buttonRows([
        button('owner:meeting-center:testlab','رجوع',ButtonStyle.Secondary,'↩️')
      ]),
    });
  }

  const fetched=await guild.channels.fetch().catch(()=>null);
  const source=fetched ?? guild.channels.cache;

  let voiceChannels=[...source.values()]
    .filter(ch=>ch && ch.type===ChannelType.GuildVoice)
    .sort((a,b)=>(a.rawPosition??0)-(b.rawPosition??0));

  if(generalMode){
    const generalId=String(process.env.GENERAL_VOICE_CHANNEL_ID??'').trim();
    voiceChannels=voiceChannels.filter(ch=>String(ch.id)===generalId);
  }
  voiceChannels=voiceChannels.slice(0,25);

  if(!voiceChannels.length){
    return interaction.update({
      content:null,
      embeds:[embed(
        '🧪 اختيار قناة الاختبار',
        `المسجل: **${clip(displayName,100)}**\n\nتم الوصول إلى السيرفر، لكن البوت الأساسي لا يرى القناة الصوتية المطلوبة. تأكد من View Channel للقناة.`
      )],
      components:buttonRows([
        button('owner:meeting-center:testlab','رجوع',ButtonStyle.Secondary,'↩️')
      ]),
    });
  }

  const picker=new StringSelectMenuBuilder()
    .setCustomId(`owner:meeting-center:testlab-voice:${team.id}${generalMode?':general':''}`)
    .setPlaceholder('اختر القناة الصوتية للاختبار')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(voiceChannels.map(ch=>({
      label:clip(ch.name,100),
      value:String(ch.id),
      description:clip(
        ch.parent?.name ? `القسم: ${ch.parent.name}` : 'قناة صوتية',
        100
      ),
    })));

  return interaction.update({
    content:null,
    embeds:[embed(
      '🧪 اختيار قناة الاختبار',
      `المسجل: **${clip(displayName,100)}**\nتم العثور على **${voiceChannels.length}** قناة صوتية. اختر قناة الاختبار.\n\nلن يرسل المختبر رسائل إلى القناة أو الأعضاء؛ القناة تستخدم للصوت فقط.`
    )],
    components:[
      new ActionRowBuilder().addComponents(picker),
      ...buttonRows([
        button('owner:meeting-center:testlab','إلغاء',ButtonStyle.Secondary,'↩️')
      ]),
    ],
  });
}

async function testLabStart(interaction,app,teamId,voiceChannelId,testScope=null){
  await interaction.deferUpdate();

  const discordClient=interaction.client;
  const guildId=String(process.env.GUILD_ID ?? app.env?.GUILD_ID ?? '').trim();

  const guild=
    interaction.guild ??
    (guildId ? discordClient?.guilds?.cache?.get?.(guildId) : null) ??
    (guildId ? await discordClient?.guilds?.fetch?.(guildId).catch(()=>null) : null) ??
    discordClient?.guilds?.cache?.first?.() ??
    null;

  if(!guild)throw new Error('تعذر الوصول إلى السيرفر لبدء الاختبار.');

  await app.testLabService.start({
    guild,
    actorId:interaction.user.id,
    actorDisplayName:
      interaction.member?.displayName ??
      interaction.user.globalName ??
      interaction.user.username,
    teamId,
    voiceChannelId,
    testScope
  });

  return interaction.editReply(await testLabPayload(app));
}

async function testLabFailover(interaction,app){
  await interaction.deferUpdate();
  const run=await app.testLabService.forceFailover({
    guildId:app.env.GUILD_ID,
    actorId:interaction.user.id,
  });
  const payload=await testLabPayload(app);
  payload.content=`⚡ تم تنفيذ Failover التجريبي بنجاح. المسجل الحالي: **${app.testLabService.recorderLabel(run)}**.`;
  return interaction.editReply(payload);
}

async function testLabEnd(interaction,app){
  await interaction.deferUpdate();

  const discordClient=interaction.client;
  const guildId=String(process.env.GUILD_ID ?? app.env?.GUILD_ID ?? '').trim();

  const guild=
    interaction.guild ??
    (guildId ? discordClient?.guilds?.cache?.get?.(guildId) : null) ??
    (guildId ? await discordClient?.guilds?.fetch?.(guildId).catch(()=>null) : null) ??
    discordClient?.guilds?.cache?.first?.() ??
    null;

  if(!guild)throw new Error('تعذر الوصول إلى السيرفر لإنهاء الاختبار.');

  await app.testLabService.end({guild,actorId:interaction.user.id});
  return interaction.editReply(await testLabPayload(app));
}

async function testLabDownloadReport(interaction,app){
  const run=await app.testLabService.latestCompleted(app.env.GUILD_ID);
  if(!run?.report_path)return interaction.reply({content:'لا يوجد تقرير تجريبي جاهز.',ephemeral:Boolean(interaction.guildId)});
  await interaction.deferReply({ephemeral:Boolean(interaction.guildId)});
  try{return await interaction.editReply({content:`📄 تقرير التجربة — ${clip(run.team_name,100)}`,files:[run.report_path]});}
  catch{return interaction.editReply({content:`التقرير موجود لكن تعذر إرساله مباشرة.\nالمسار المحلي:\n\`${run.report_path}\``});}
}

async function testLabDownloadRecording(interaction,app){
  const run=await app.testLabService.latestCompleted(app.env.GUILD_ID);
  const paths=testLabJsonPaths(run?.recording_paths);
  if(!paths.length)return interaction.reply({content:'لا يوجد تسجيل تجريبي جاهز.',ephemeral:Boolean(interaction.guildId)});
  await interaction.deferReply({ephemeral:Boolean(interaction.guildId)});
  if(Number(run.recording_bytes||0)>TESTLAB_DIRECT_LIMIT||paths.length>5){
    return interaction.editReply({content:`🎙️ التسجيل موجود (${testLabBytes(run.recording_bytes)}) لكنه أكبر من حد الإرسال المباشر أو متعدد الأجزاء.\n${paths.map(p=>`\`${p}\``).join('\n').slice(0,3500)}`});
  }
  try{return await interaction.editReply({content:`🎙️ تسجيل التجربة — ${clip(run.team_name,100)}`,files:paths});}
  catch{return interaction.editReply({content:`التسجيل محفوظ محليًا لكن تعذر إرساله مباشرة.\n${paths.map(p=>`\`${p}\``).join('\n').slice(0,3500)}`});}
}
// test-lab-v3.0:owner-functions:end


async function home(interaction, app) {
  const { rows } = await app.db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status='ongoing')::int AS ongoing,
      COUNT(*) FILTER (WHERE status='upcoming')::int AS upcoming,
      COUNT(*) FILTER (WHERE status IN ('ended','canceled','postponed'))::int AS past
    FROM meetings
    WHERE guild_id=$1 AND COALESCE(is_test,false)=false
  `, [app.env.GUILD_ID]);
  const c = rows[0] ?? {};
  const description = [
    '**كل اجتماعات 967 في مكان واحد — للـOwner فقط.**',
    '',
    `🔴 **الجارية الآن:** ${num(c.ongoing)}`,
    `🟡 **القادمة:** ${num(c.upcoming)}`,
    `🗂️ **السابقة:** ${num(c.past)}`,
    '',
    'افتح أي قسم، ثم اختر الاجتماع لعرض بياناته التشغيلية والحضور والاعتذارات والتكليفات والقرارات والمخرجات.',
  ].join('\n');
  return interaction.update({
    embeds: [embed('🗓️ مركز الاجتماعات — المالك', description)],
    components: buttonRows([
      button('meeting:create', 'جدولة اجتماع', ButtonStyle.Success, '➕'),
      button('owner:meeting-center:list:ongoing:0', `الجارية (${num(c.ongoing)})`, ButtonStyle.Danger, '🔴'),
      button('owner:meeting-center:list:upcoming:0', `القادمة (${num(c.upcoming)})`, ButtonStyle.Primary, '🟡'),
      button('owner:meeting-center:list:past:0', `السابقة (${num(c.past)})`, ButtonStyle.Secondary, '🗂️'),
      ...(await app.testLabService.visible(app.env.GUILD_ID)?[button('owner:meeting-center:testlab', 'التجارب', ButtonStyle.Primary, '🧪')]:[]),
      button('owner:meeting-center:health', 'صحة النظام', ButtonStyle.Success, '🛡️'),
      button('owner:meeting-center:delivery-control', 'تحكم الإرسال', ButtonStyle.Secondary, '📨'),
      button('owner:meeting-center', 'تحديث', ButtonStyle.Secondary, '🔄'),
      button('panel:refresh', 'العودة للوحة', ButtonStyle.Secondary, '↩️'),
    ]),
  });
}

async function listMeetings(interaction, app, kind, page = 0) {
  const meta = KIND[kind];
  if (!meta) return home(interaction, app);
  page = Math.max(0, Number(page) || 0);
  const offset = page * PAGE_SIZE;
  const countRes = await app.db.query(
    `SELECT COUNT(*)::int AS n FROM meetings WHERE guild_id=$1 AND COALESCE(is_test,false)=false AND status=ANY($2::text[])`,
    [app.env.GUILD_ID, meta.statuses],
  );
  const total = num(countRes.rows[0]?.n);
  if (offset >= total && total > 0) page = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const actualOffset = page * PAGE_SIZE;
  const order = kind === 'past'
    ? `COALESCE(m.ended_at,m.canceled_at,m.postponed_at,m.scheduled_at) DESC`
    : kind === 'ongoing'
      ? `COALESCE(m.started_at,m.scheduled_at) ASC`
      : `m.scheduled_at ASC`;
  const { rows } = await app.db.query(`
    SELECT m.id,m.name,m.description,m.status,m.scheduled_at,m.started_at,m.ended_at,m.voice_channel_id,
           t.name AS team_name,
           (SELECT COUNT(*) FROM meeting_member_snapshots s WHERE s.meeting_id=m.id)::int AS expected_count,
           (SELECT COUNT(*) FROM excuses e WHERE e.meeting_id=m.id AND e.status='approved')::int AS excused_count,
           (SELECT COUNT(*) FROM attendance a WHERE a.meeting_id=m.id AND (COALESCE(a.total_seconds,0)>0 OR a.status IN ('present','late')))::int AS attended_count
    FROM meetings m
    JOIN teams t ON t.id=m.team_id
    WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND m.status=ANY($2::text[])
    ORDER BY ${order}
    LIMIT $3 OFFSET $4
  `, [app.env.GUILD_ID, meta.statuses, PAGE_SIZE, actualOffset]);

  if (!rows.length) {
    return interaction.update({
      embeds: [embed(`${meta.emoji} ${meta.title}`, 'لا توجد اجتماعات في هذا القسم حاليًا.')],
      components: buttonRows([
        button('owner:meeting-center', 'مركز الاجتماعات', ButtonStyle.Primary, '🗓️'),
        button('panel:refresh', 'العودة للوحة', ButtonStyle.Secondary, '↩️'),
      ]),
    });
  }

  const options = rows.map((m, index) => ({
    label: clip(m.name, 95),
    description: clip(`${m.team_name} • ${meetingStatus(m.status).replace(/^..\s?/, '')} • ${num(m.attended_count)}/${num(m.expected_count)} حضور`, 100),
    value: String(m.id),
    emoji: STATUS[m.status]?.[0] ?? '⚪',
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`owner:meeting-center:open:${kind}`)
    .setPlaceholder('اختر اجتماعًا لعرض جميع تفاصيله')
    .addOptions(options);

  const lines = rows.map((m, i) => {
    const when = m.status === 'ongoing' ? `${discordTime(m.started_at || m.scheduled_at, 'R')}` : `${discordTime(m.scheduled_at, 'F')}`;
    return `**${actualOffset + i + 1}. ${clip(m.name, 80)}**\n${meetingStatus(m.status)} • ${clip(m.team_name, 60)} • ${when} • حضور ${num(m.attended_count)}/${num(m.expected_count)} • اعتذارات ${num(m.excused_count)}`;
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const nav = [
    button(`owner:meeting-center:list:${kind}:${page - 1}`, 'السابق', ButtonStyle.Secondary, '◀️', page <= 0),
    button(`owner:meeting-center:list:${kind}:${page + 1}`, 'التالي', ButtonStyle.Secondary, '▶️', page >= pages - 1),
    button(`owner:meeting-center:list:${kind}:${page}`, 'تحديث', ButtonStyle.Secondary, '🔄'),
    button('owner:meeting-center', 'المركز', ButtonStyle.Primary, '🗓️'),
    button('panel:refresh', 'اللوحة', ButtonStyle.Secondary, '↩️'),
  ];
  return interaction.update({
    embeds: [embed(`${meta.emoji} ${meta.title}`, `${lines.join('\n\n')}\n\n**الصفحة ${page + 1}/${pages} — الإجمالي ${total}**`)],
    components: [new ActionRowBuilder().addComponents(select), ...buttonRows(nav)].slice(0, 5),
  });
}

async function getMeeting(app, meetingId) {
  const { rows } = await app.db.query(`
    SELECT m.*,t.name AS team_name,
      (SELECT COUNT(*) FROM meeting_member_snapshots s WHERE s.meeting_id=m.id)::int AS expected_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.meeting_id=m.id AND (COALESCE(a.total_seconds,0)>0 OR a.status IN ('present','late')))::int AS attended_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.meeting_id=m.id AND a.status='late')::int AS late_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.meeting_id=m.id AND a.status='absent')::int AS absent_count,
      (SELECT COUNT(*) FROM excuses e WHERE e.meeting_id=m.id AND e.status='approved')::int AS approved_excuses,
      (SELECT COUNT(*) FROM excuses e WHERE e.meeting_id=m.id AND e.status='pending')::int AS pending_excuses,
      (SELECT COUNT(*) FROM meeting_decisions d WHERE d.meeting_id=m.id)::int AS decisions_count,
      (SELECT COUNT(*) FROM meeting_tasks mt WHERE mt.meeting_id=m.id)::int AS tasks_count,
      (SELECT COUNT(*) FROM meeting_tasks mt WHERE mt.meeting_id=m.id AND mt.status='done')::int AS tasks_done,
      (SELECT COUNT(*) FROM reports r WHERE r.meeting_id=m.id)::int AS reports_count,
      (SELECT COUNT(*) FROM recordings r WHERE r.meeting_id=m.id)::int AS recordings_count,
      (SELECT r.status FROM recordings r WHERE r.meeting_id=m.id ORDER BY r.started_at DESC LIMIT 1) AS latest_recording_status,
      COALESCE((SELECT SUM(rt.bytes) FROM recording_tracks rt JOIN recordings rr ON rr.id=rt.recording_id WHERE rr.meeting_id=m.id),0)::bigint AS recording_bytes,
      ma.readiness_checked_at,ma.readiness_ok,ma.readiness_issues,ma.reminder_sent_at,ma.start_attempted_at,ma.start_attempts,ma.start_error,ma.had_human,ma.ended_automatically_at,
      os.report_status AS output_report_status,os.recording_status AS output_recording_status,os.delivery_status AS output_delivery_status,os.attempts AS output_attempts,os.last_error AS output_last_error,os.completed_at AS output_completed_at
    FROM meetings m
    JOIN teams t ON t.id=m.team_id
    LEFT JOIN meeting_automation ma ON ma.meeting_id=m.id
    LEFT JOIN meeting_output_state os ON os.meeting_id=m.id
    WHERE m.id=$1 AND m.guild_id=$2
  `, [meetingId, app.env.GUILD_ID]);
  return rows[0] ?? null;
}


// meeting967-custom-reminder-recipients-v1.7.9.1
const REMINDER_PICKER_PAGE=20;
const rrDraftKey=(userId,meetingId)=>`reminder-recipient-search:${userId}:${meetingId}`;

async function reminderRecipientMode(app,meetingId){
  const {rows}=await app.db.query('SELECT mode FROM meeting_reminder_recipient_settings WHERE meeting_id=$1',[meetingId]);
  return rows[0]?.mode??'team';
}

async function effectiveReminderRecipients(app,meeting){
  const mode=await reminderRecipientMode(app,meeting.id);
  if(mode==='custom'){
    const {rows}=await app.db.query(`SELECT rr.user_id,COALESCE(NULLIF(rr.display_name,''),u.display_name,u.username,rr.user_id::text) AS display_name
      FROM meeting_reminder_recipients rr LEFT JOIN users u ON u.id=rr.user_id
      WHERE rr.meeting_id=$1 ORDER BY COALESCE(NULLIF(rr.display_name,''),u.display_name,u.username,rr.user_id::text)`,[meeting.id]);
    return {mode,rows};
  }
  let {rows}=await app.db.query('SELECT user_id,display_name FROM meeting_member_snapshots WHERE meeting_id=$1 ORDER BY display_name',[meeting.id]);
  if(!rows.length){
    ({rows}=await app.db.query(`SELECT tm.user_id,COALESCE(u.display_name,u.username,tm.user_id::text) AS display_name
      FROM team_members tm LEFT JOIN users u ON u.id=tm.user_id
      WHERE tm.team_id=$1 AND tm.active=TRUE ORDER BY COALESCE(u.display_name,u.username,tm.user_id::text)`,[meeting.team_id]));
  }
  return {mode,rows};
}

async function ensureCustomReminderRecipients(app,meeting,actorId){
  const mode=await reminderRecipientMode(app,meeting.id);
  if(mode==='custom')return;
  const client=await app.db.connect();
  try{
    await client.query('BEGIN');
    await client.query(`INSERT INTO meeting_reminder_recipient_settings(meeting_id,mode,updated_by,updated_at)
      VALUES($1,'custom',$2,now()) ON CONFLICT(meeting_id) DO UPDATE SET mode='custom',updated_by=EXCLUDED.updated_by,updated_at=now()`,[meeting.id,actorId]);
    await client.query('DELETE FROM meeting_reminder_recipients WHERE meeting_id=$1',[meeting.id]);
    const snap=await client.query('SELECT user_id,display_name FROM meeting_member_snapshots WHERE meeting_id=$1',[meeting.id]);
    if(snap.rows.length){
      for(const x of snap.rows)await client.query(`INSERT INTO meeting_reminder_recipients(meeting_id,user_id,display_name,added_by)
        VALUES($1,$2,$3,$4) ON CONFLICT(meeting_id,user_id) DO NOTHING`,[meeting.id,x.user_id,x.display_name,actorId]);
    }else{
      const team=await client.query(`SELECT tm.user_id,COALESCE(u.display_name,u.username,tm.user_id::text) AS display_name
        FROM team_members tm LEFT JOIN users u ON u.id=tm.user_id WHERE tm.team_id=$1 AND tm.active=TRUE`,[meeting.team_id]);
      for(const x of team.rows)await client.query(`INSERT INTO meeting_reminder_recipients(meeting_id,user_id,display_name,added_by)
        VALUES($1,$2,$3,$4) ON CONFLICT(meeting_id,user_id) DO NOTHING`,[meeting.id,x.user_id,x.display_name,actorId]);
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

async function reminderRecipientsScreen(interaction,app,kind,meetingId){
  const m=await getMeeting(app,meetingId);
  if(!m)return listMeetings(interaction,app,kind,0);
  const {mode,rows}=await effectiveReminderRecipients(app,m);
  const shown=rows.slice(0,20).map((x,i)=>`${i+1}. **${clip(x.display_name,70)}** — <@${x.user_id}>`);
  const modeText=mode==='custom'?'🎯 **قائمة مخصصة لهذا الاجتماع**':'👥 **أعضاء الاجتماع/الفريق تلقائيًا**';
  const desc=[
    `**الاجتماع:** ${clip(m.name,120)}`,
    `**الفريق:** ${clip(m.team_name,80)}`,
    `**الوضع الحالي:** ${modeText}`,
    `**عدد مستلمي التذكيرات:** ${rows.length}`,
    '',
    rows.length?'**المستلمون الحاليون:**':'⚠️ **القائمة فارغة — لن تصل تذكيرات هذا الاجتماع لأي شخص.**',
    ...shown,
    rows.length>20?`… و${rows.length-20} آخرين`:null,
    '',
    'هذه القائمة خاصة **برسائل التذكير لهذا الاجتماع فقط**؛ لا تغيّر فريق العضو ولا صلاحياته ولا سجل الحضور.',
    mode==='team'?'إذا أضفت أو حذفت شخصًا، سيحوّل البوت القائمة تلقائيًا إلى قائمة مخصصة ويبدأ بنسخة من أعضاء الاجتماع الحاليين.':null,
  ].filter(Boolean).join('\n');
  const buttons=[
    button(`owner:meeting-center:recipients-add:${kind}:${m.id}:0`,'إضافة أعضاء',ButtonStyle.Success,'➕'),
    button(`owner:meeting-center:recipients-remove:${kind}:${m.id}:0`,'إزالة أعضاء',ButtonStyle.Danger,'➖',mode!=='custom'||rows.length===0),
    button(`owner:meeting-center:recipients-team:${kind}:${m.id}`,'استخدام أعضاء الفريق تلقائيًا',ButtonStyle.Secondary,'👥',mode==='team'),
    button(`owner:meeting-center:recipients:${kind}:${m.id}`,'تحديث',ButtonStyle.Secondary,'🔄'),
    button(`owner:meeting-center:detail:${kind}:${m.id}`,'تفاصيل الاجتماع',ButtonStyle.Primary,'↩️'),
  ];
  return interaction.update({embeds:[embed('📨 مستلمو تذكيرات الاجتماع',desc)],components:buttonRows(buttons)});
}

async function reminderRecipientGuild(interaction,app){
  const id=String(app.env.GUILD_ID);
  const guild=interaction.client.guilds.cache.get(id)??await interaction.client.guilds.fetch(id);
  await guild.members.fetch();
  return guild;
}

function memberMatches(member,query){
  if(!query)return true;
  const q=query.toLocaleLowerCase('ar');
  const text=[member.displayName,member.user?.globalName,member.user?.username,member.id].filter(Boolean).join(' ').toLocaleLowerCase('ar');
  return text.includes(q);
}

async function reminderRecipientAddPicker(interaction,app,kind,meetingId,page=0){
  const m=await getMeeting(app,meetingId);if(!m)return listMeetings(interaction,app,kind,0);
  await ensureCustomReminderRecipients(app,m,interaction.user.id);
  const guild=await reminderRecipientGuild(interaction,app);
  const selectedRes=await app.db.query('SELECT user_id FROM meeting_reminder_recipients WHERE meeting_id=$1',[m.id]);
  const selected=new Set(selectedRes.rows.map(x=>String(x.user_id)));
  const draft=app.drafts.get(rrDraftKey(interaction.user.id,m.id));
  const query=String(draft?.query??'').trim();
  const all=[...guild.members.cache.values()].filter(x=>!x.user.bot&&!selected.has(String(x.id))&&memberMatches(x,query)).sort((a,b)=>a.displayName.localeCompare(b.displayName,'ar'));
  const pages=Math.max(1,Math.ceil(all.length/REMINDER_PICKER_PAGE));page=Math.max(0,Math.min(Number(page)||0,pages-1));
  const chunk=all.slice(page*REMINDER_PICKER_PAGE,(page+1)*REMINDER_PICKER_PAGE);
  const rows=[];
  if(chunk.length){
    const menu=new StringSelectMenuBuilder().setCustomId(`owner:meeting-center:recipients-add-submit:${kind}:${m.id}:${page}`).setPlaceholder('اختر عضوًا أو أكثر لإضافتهم').setMinValues(1).setMaxValues(Math.min(25,chunk.length));
    menu.addOptions(chunk.map(x=>({label:clip(x.displayName,95),description:clip(`@${x.user.username}`,95),value:String(x.id)})));
    rows.push(new ActionRowBuilder().addComponents(menu));
  }
  const nav=[
    button(`owner:meeting-center:recipients-search-open:${kind}:${m.id}:${page}`,'بحث بالاسم',ButtonStyle.Secondary,'🔎'),
    ...(query?[button(`owner:meeting-center:recipients-search-clear:${kind}:${m.id}:0`,'مسح البحث',ButtonStyle.Secondary,'✖️')]:[]),
    button(`owner:meeting-center:recipients-add:${kind}:${m.id}:${page-1}`,'السابق',ButtonStyle.Secondary,'◀️',page<=0),
    button(`owner:meeting-center:recipients-add:${kind}:${m.id}:${page+1}`,'التالي',ButtonStyle.Secondary,'▶️',page>=pages-1),
    button(`owner:meeting-center:recipients:${kind}:${m.id}`,'العودة للقائمة',ButtonStyle.Primary,'↩️'),
  ];
  rows.push(...buttonRows(nav));
  const text=chunk.length?`اختر من أعضاء السيرفر غير الموجودين حاليًا في قائمة التذكير.`:'لا يوجد أعضاء مطابقون يمكن إضافتهم.';
  return interaction.update({embeds:[embed('➕ إضافة مستلمي التذكيرات',`${text}\n\n**بحث:** ${query||'بدون'}\n**الصفحة ${page+1}/${pages} — النتائج ${all.length}**`)],components:rows.slice(0,5)});
}

async function reminderRecipientAddSubmit(interaction,app,kind,meetingId){
  const m=await getMeeting(app,meetingId);if(!m)return listMeetings(interaction,app,kind,0);
  await ensureCustomReminderRecipients(app,m,interaction.user.id);
  const guild=await reminderRecipientGuild(interaction,app);
  for(const userId of interaction.values??[]){
    const member=guild.members.cache.get(String(userId));if(!member||member.user.bot)continue;
    await app.db.query(`INSERT INTO meeting_reminder_recipients(meeting_id,user_id,display_name,added_by)
      VALUES($1,$2,$3,$4) ON CONFLICT(meeting_id,user_id) DO UPDATE SET display_name=EXCLUDED.display_name`,[m.id,userId,member.displayName,interaction.user.id]);
  }
  return reminderRecipientsScreen(interaction,app,kind,m.id);
}

async function reminderRecipientRemovePicker(interaction,app,kind,meetingId,page=0){
  const m=await getMeeting(app,meetingId);if(!m)return listMeetings(interaction,app,kind,0);
  await ensureCustomReminderRecipients(app,m,interaction.user.id);
  const {rows:all}=await app.db.query(`SELECT user_id,COALESCE(NULLIF(display_name,''),user_id::text) AS display_name FROM meeting_reminder_recipients WHERE meeting_id=$1 ORDER BY display_name`,[m.id]);
  const pages=Math.max(1,Math.ceil(all.length/REMINDER_PICKER_PAGE));page=Math.max(0,Math.min(Number(page)||0,pages-1));
  const chunk=all.slice(page*REMINDER_PICKER_PAGE,(page+1)*REMINDER_PICKER_PAGE);
  const components=[];
  if(chunk.length){
    const menu=new StringSelectMenuBuilder().setCustomId(`owner:meeting-center:recipients-remove-submit:${kind}:${m.id}:${page}`).setPlaceholder('اختر من تريد إزالته').setMinValues(1).setMaxValues(Math.min(25,chunk.length));
    menu.addOptions(chunk.map(x=>({label:clip(x.display_name,95),description:clip(`ID: ${x.user_id}`,95),value:String(x.user_id)})));
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  components.push(...buttonRows([
    button(`owner:meeting-center:recipients-remove:${kind}:${m.id}:${page-1}`,'السابق',ButtonStyle.Secondary,'◀️',page<=0),
    button(`owner:meeting-center:recipients-remove:${kind}:${m.id}:${page+1}`,'التالي',ButtonStyle.Secondary,'▶️',page>=pages-1),
    button(`owner:meeting-center:recipients:${kind}:${m.id}`,'العودة للقائمة',ButtonStyle.Primary,'↩️'),
  ]));
  return interaction.update({embeds:[embed('➖ إزالة مستلمي التذكيرات',chunk.length?`اختر من تريد إزالته من تذكيرات **${clip(m.name,100)}**.\n\n**الصفحة ${page+1}/${pages} — الإجمالي ${all.length}**`:'قائمة التذكيرات المخصصة فارغة.')],components:components.slice(0,5)});
}

async function reminderRecipientRemoveSubmit(interaction,app,kind,meetingId){
  for(const userId of interaction.values??[])await app.db.query('DELETE FROM meeting_reminder_recipients WHERE meeting_id=$1 AND user_id=$2',[meetingId,userId]);
  return reminderRecipientsScreen(interaction,app,kind,meetingId);
}

async function reminderRecipientsUseTeam(interaction,app,kind,meetingId){
  await app.db.query(`INSERT INTO meeting_reminder_recipient_settings(meeting_id,mode,updated_by,updated_at)
    VALUES($1,'team',$2,now()) ON CONFLICT(meeting_id) DO UPDATE SET mode='team',updated_by=EXCLUDED.updated_by,updated_at=now()`,[meetingId,interaction.user.id]);
  await app.db.query('DELETE FROM meeting_reminder_recipients WHERE meeting_id=$1',[meetingId]);
  app.drafts.delete(rrDraftKey(interaction.user.id,meetingId));
  return reminderRecipientsScreen(interaction,app,kind,meetingId);
}

function reminderRecipientSearchModal(kind,meetingId,page,current=''){
  const field=new TextInputBuilder().setCustomId('query').setLabel('اسم العضو أو اليوزر').setPlaceholder('مثال: محمد أو m.j404').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
  if(current)field.setValue(String(current).slice(0,100));
  return new ModalBuilder().setCustomId(`owner:meeting-center:recipients-search-submit:${kind}:${meetingId}:${page}`).setTitle('بحث عن مستلم').addComponents(new ActionRowBuilder().addComponents(field));
}

async function detail(interaction, app, kind, meetingId) {
  const m = await getMeeting(app, meetingId);
  if (!m) return listMeetings(interaction, app, kind, 0);
  const readiness = m.readiness_checked_at
    ? (m.readiness_ok ? '✅ جاهز' : `⚠️ غير جاهز: ${clip(Array.isArray(m.readiness_issues) ? m.readiness_issues.join('، ') : JSON.stringify(m.readiness_issues ?? ''), 500)}`)
    : 'لم يُفحص بعد';
  const output = `التقرير: **${clip(m.output_report_status || '—', 30)}** • التسجيل: **${clip(m.output_recording_status || m.latest_recording_status || '—', 30)}** • التسليم: **${clip(m.output_delivery_status || '—', 30)}**`;
  const description = [
    `**الفريق:** ${clip(m.team_name, 100)}`,
    `**الحالة:** ${meetingStatus(m.status)}`,
    `**الموعد:** ${discordTime(m.scheduled_at, 'F')} (${discordTime(m.scheduled_at, 'R')})`,
    m.original_scheduled_at && String(m.original_scheduled_at) !== String(m.scheduled_at) ? `**الموعد الأصلي:** ${discordTime(m.original_scheduled_at, 'F')}` : null,
    `**القناة الصوتية:** <#${m.voice_channel_id}>`,
    `**الوصف:** ${clip(m.description, 700)}`,
    '',
    `**بدأ:** ${discordTime(m.started_at, 'F')} • **انتهى:** ${discordTime(m.ended_at, 'F')} • **المدة:** ${meetingDuration(m)}`,
    `**طريقة البدء:** ${clip(m.start_mode || 'manual', 30)}${m.end_reason ? ` • **سبب الإنهاء:** ${clip(m.end_reason, 250)}` : ''}`,
    `**الأعضاء المتوقعون:** ${num(m.expected_count)} • **حضر:** ${num(m.attended_count)} • **متأخر:** ${num(m.late_count)} • **غائب:** ${num(m.absent_count)}`,
    `**الاعتذارات:** معتمدة ${num(m.approved_excuses)} • قيد المراجعة ${num(m.pending_excuses)}`,
    `**التكليفات:** ${num(m.tasks_done)}/${num(m.tasks_count)} مكتملة • **القرارات:** ${num(m.decisions_count)}`,
    '',
    `**Autopilot:** ${readiness}`,
    `**التذكير:** ${m.reminder_sent_at ? '✅ أُرسل' : '—'} • **محاولات البدء:** ${num(m.start_attempts)} • **دخل عضو بشري:** ${m.had_human ? 'نعم' : 'لا'}`,
    m.start_error ? `**خطأ البدء:** ${clip(m.start_error, 500)}` : null,
    '',
    `**المخرجات:** ${output}`,
    `**التقارير المحفوظة:** ${num(m.reports_count)} • **جلسات التسجيل:** ${num(m.recordings_count)} • **حجم التسجيل:** ${durationBytes(m.recording_bytes)}`,
    m.output_last_error ? `**آخر خطأ في المخرجات:** ${clip(m.output_last_error, 500)}` : null,
  ].filter(Boolean).join('\n');

  const buttons = [
    button(`owner:meeting-center:sub:attendance:${kind}:${m.id}:0`, 'الحضور', ButtonStyle.Secondary, '✅'),
    button(`owner:meeting-center:sub:excuses:${kind}:${m.id}:0`, 'الاعتذارات', ButtonStyle.Secondary, '📝'),
    button(`owner:meeting-center:sub:tasks:${kind}:${m.id}:0`, 'التكليفات', ButtonStyle.Secondary, '📌'),
    button(`owner:meeting-center:sub:decisions:${kind}:${m.id}:0`, 'القرارات', ButtonStyle.Secondary, '📋'),
    button(`owner:meeting-center:sub:outputs:${kind}:${m.id}:0`, 'المخرجات', ButtonStyle.Secondary, '📦'),
    button(`owner:meeting-center:recipients:${kind}:${m.id}`, 'مستلمو التذكيرات', ButtonStyle.Primary, '📨'),
    button(`owner:meeting-center:list:${kind}:0`, 'العودة للقائمة', ButtonStyle.Primary, '↩️'),
    button(`owner:meeting-center:detail:${kind}:${m.id}`, 'تحديث', ButtonStyle.Secondary, '🔄'),
    button('owner:meeting-center', 'المركز', ButtonStyle.Secondary, '🗓️'),
  ];
  return interaction.update({ embeds: [embed(`🗓️ ${clip(m.name, 220)}`, description)], components: buttonRows(buttons) });
}

function durationBytes(value) {
  let bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function attendanceStatus(value) {
  return ({ present: '✅ حاضر', late: '🟠 متأخر', absent: '❌ غائب', excused: '📝 معتذر' })[value] ?? '⚪ غير مسجل';
}
function excuseStatus(value) {
  return ({ pending: '🟡 قيد المراجعة', approved: '✅ معتمد', rejected: '❌ مرفوض' })[value] ?? value;
}
function taskStatus(value) {
  return ({ pending: '⚪ لم يبدأ', in_progress: '🟡 قيد التنفيذ', done: '✅ مكتمل', cancelled: '⛔ ملغي' })[value] ?? value;
}

async function subPage(interaction, app, type, kind, meetingId, page = 0) {
  const m = await getMeeting(app, meetingId);
  if (!m) return listMeetings(interaction, app, kind, 0);
  page = Math.max(0, Number(page) || 0);
  const offset = page * 12;
  let title = '';
  let lines = [];
  let total = 0;

  if (type === 'attendance') {
    const count = await app.db.query(`SELECT COUNT(*)::int AS n FROM meeting_member_snapshots WHERE meeting_id=$1`, [m.id]);
    total = num(count.rows[0]?.n);
    const { rows } = await app.db.query(`
      SELECT s.user_id,s.display_name,a.status,a.total_seconds,a.presence_ratio,a.late_by_seconds,a.first_join_at,a.last_leave_at
      FROM meeting_member_snapshots s LEFT JOIN attendance a ON a.meeting_id=s.meeting_id AND a.user_id=s.user_id
      WHERE s.meeting_id=$1
      ORDER BY CASE WHEN COALESCE(a.total_seconds,0)>0 THEN 0 ELSE 1 END,s.display_name
      LIMIT 12 OFFSET $2`, [m.id, offset]);
    title = '✅ الحضور';
    lines = rows.map((x, i) => `${offset + i + 1}. **${clip(x.display_name, 70)}** — ${attendanceStatus(x.status)} — ${durationText(x.total_seconds)}${x.presence_ratio != null ? ` — ${Math.round(Number(x.presence_ratio) * 100)}%` : ''}`);
  } else if (type === 'excuses') {
    const count = await app.db.query(`SELECT COUNT(*)::int AS n FROM excuses WHERE meeting_id=$1`, [m.id]);
    total = num(count.rows[0]?.n);
    const { rows } = await app.db.query(`
      SELECT e.*,COALESCE(u.display_name,u.username,e.user_id::text) AS member_name
      FROM excuses e LEFT JOIN users u ON u.id=e.user_id WHERE e.meeting_id=$1
      ORDER BY e.submitted_at DESC LIMIT 12 OFFSET $2`, [m.id, offset]);
    title = '📝 الاعتذارات';
    lines = rows.map((x, i) => `${offset + i + 1}. **${clip(x.member_name, 70)}** — ${excuseStatus(x.status)}\nالسبب: ${clip(x.reason, 350)}${x.decision_note ? `\nقرار المراجع: ${clip(x.decision_note, 250)}` : ''}`);
  } else if (type === 'tasks') {
    const count = await app.db.query(`SELECT COUNT(*)::int AS n FROM meeting_tasks WHERE meeting_id=$1`, [m.id]);
    total = num(count.rows[0]?.n);
    const { rows } = await app.db.query(`
      SELECT mt.*,COALESCE(u.display_name,u.username,mt.assignee_user_id::text) AS assignee_name
      FROM meeting_tasks mt LEFT JOIN users u ON u.id=mt.assignee_user_id
      WHERE mt.meeting_id=$1 ORDER BY mt.created_at DESC LIMIT 12 OFFSET $2`, [m.id, offset]);
    title = '📌 التكليفات';
    lines = rows.map((x, i) => `${offset + i + 1}. **${clip(x.title, 90)}** — ${taskStatus(x.status)}\nالمكلف: ${clip(x.assignee_name, 70)}${x.due_at ? ` • الاستحقاق: ${discordTime(x.due_at, 'F')}` : ''}`);
  } else if (type === 'decisions') {
    const count = await app.db.query(`SELECT COUNT(*)::int AS n FROM meeting_decisions WHERE meeting_id=$1`, [m.id]);
    total = num(count.rows[0]?.n);
    const { rows } = await app.db.query(`SELECT * FROM meeting_decisions WHERE meeting_id=$1 ORDER BY created_at DESC LIMIT 12 OFFSET $2`, [m.id, offset]);
    title = '📋 القرارات';
    lines = rows.map((x, i) => `${offset + i + 1}. ${clip(x.decision_text, 500)}\n${discordTime(x.created_at, 'F')}`);
  } else if (type === 'outputs') {
    title = '📦 المخرجات';
    const [reports, recordings, receipts] = await Promise.all([
      app.db.query(`SELECT generated_at,path,sha256 FROM reports WHERE meeting_id=$1 ORDER BY generated_at DESC LIMIT 10`, [m.id]),
      app.db.query(`SELECT r.started_at,r.stopped_at,r.status,r.storage_path,r.session_index,r.session_reason,r.recorder_key,r.recorder_type,r.worker_number,r.failover_from_recording_id,COALESCE((SELECT SUM(rt.bytes) FROM recording_tracks rt WHERE rt.recording_id=r.id),0)::bigint AS recording_bytes FROM recordings r WHERE r.meeting_id=$1 ORDER BY COALESCE(r.session_index,2147483647),r.started_at LIMIT 20`, [m.id]),
      app.db.query(`SELECT COUNT(*)::int AS n,COUNT(*) FILTER (WHERE report_sent_at IS NOT NULL)::int AS reports_sent,COUNT(*) FILTER (WHERE recording_sent_at IS NOT NULL)::int AS recordings_sent FROM meeting_delivery_receipts WHERE meeting_id=$1`, [m.id]),
    ]);
    const r = receipts.rows[0] ?? {};
    total = reports.rows.length + recordings.rows.length;
    lines = [
      `**حالة التقرير:** ${clip(m.output_report_status || '—', 30)}`,
      `**حالة التسجيل:** ${clip(m.output_recording_status || m.latest_recording_status || '—', 30)}`,
      `**حالة التسليم:** ${clip(m.output_delivery_status || '—', 30)}`,
      `**محاولات المعالجة:** ${num(m.output_attempts)}${m.output_completed_at ? ` • اكتملت: ${discordTime(m.output_completed_at, 'F')}` : ''}`,
      `**مستلمون:** ${num(r.n)} • تقرير أُرسل لـ ${num(r.reports_sent)} • تسجيل أُرسل لـ ${num(r.recordings_sent)}`,
      m.output_last_error ? `**آخر خطأ:** ${clip(m.output_last_error, 600)}` : null,
      '',
      `**التقارير (${reports.rows.length}):**`,
      ...(reports.rows.length ? reports.rows.map((x, i) => `${i + 1}. ${discordTime(x.generated_at, 'F')} • ${clip(x.path, 180)}`) : ['لا يوجد تقرير محفوظ.']),
      '',
      `**التسجيلات (${recordings.rows.length}):**`,
      ...(recordings.rows.length ? recordings.rows.map((x, i) => { const recorder=x.recorder_type==='main'?'البوت الأساسي':x.worker_number?`Worker ${x.worker_number}`:clip(x.recorder_key||'غير معروف',40); const failover=x.failover_from_recording_id?' • ↪️ استلام Failover':''; return `${i + 1}. **جلسة ${x.session_index??i+1}** • ${recorder}${failover} • ${clip(x.status,30)} • ${discordTime(x.started_at,'F')} • ${durationBytes(x.recording_bytes)}\n${clip(x.storage_path,180)}`; }) : ['لا يوجد تسجيل محفوظ.']),
    ].filter(x => x !== null);
  } else {
    return detail(interaction, app, kind, m.id);
  }

  if (!lines.length) lines = ['لا توجد بيانات في هذا القسم لهذا الاجتماع.'];
  const pages = type === 'outputs' ? 1 : Math.max(1, Math.ceil(total / 12));
  const nav = [
    ...(type !== 'outputs' ? [
      button(`owner:meeting-center:sub:${type}:${kind}:${m.id}:${page - 1}`, 'السابق', ButtonStyle.Secondary, '◀️', page <= 0),
      button(`owner:meeting-center:sub:${type}:${kind}:${m.id}:${page + 1}`, 'التالي', ButtonStyle.Secondary, '▶️', page >= pages - 1),
    ] : []),
    button(`owner:meeting-center:detail:${kind}:${m.id}`, 'تفاصيل الاجتماع', ButtonStyle.Primary, '🗓️'),
    button(`owner:meeting-center:list:${kind}:0`, 'القائمة', ButtonStyle.Secondary, '↩️'),
  ];
  return interaction.update({
    embeds: [embed(`${title} — ${clip(m.name, 180)}`, `${lines.join('\n\n')}\n\n${type !== 'outputs' ? `**الصفحة ${page + 1}/${pages} — الإجمالي ${total}**` : ''}`)],
    components: buttonRows(nav),
  });
}

export async function handleOwnerMeetingCenterInteraction(interaction, app) {
  const id = String(interaction.customId ?? '');
  if (id !== 'owner:meeting-center' && !id.startsWith('owner:meeting-center:')) return false;
  if (!await ensureOwner(interaction, app)) return true;
  if (id === 'owner:meeting-center') { await home(interaction, app); return true; }

  const parts = id.split(':');
  const action = parts[2];



  // test-lab-v3.0:owner-handlers:start
  if (action === 'testlab') { await interaction.update(await testLabPayload(app)); return true; }
  if (action === 'testlab-new') { await testLabTeamPicker(interaction,app); return true; }
  if (action === 'testlab-team') { await testLabVoicePicker(interaction,app,interaction.values?.[0]); return true; }
  if (action === 'testlab-voice') { await testLabStart(interaction,app,parts[3],interaction.values?.[0],parts[4]??null); return true; }
  if (action === 'testlab-failover') { await testLabFailover(interaction,app); return true; }
  if (action === 'testlab-end') { await testLabEnd(interaction,app); return true; }
  if (action === 'testlab-report') { await testLabDownloadReport(interaction,app); return true; }
  if (action === 'testlab-recording') { await testLabDownloadRecording(interaction,app); return true; }
  if (action === 'testlab-purge') { await interaction.deferUpdate(); const r=await app.testLabService.purge(app.env.GUILD_ID); const p=await testLabPayload(app); p.content=`✅ حُذفت بيانات ${r.removed} تجربة وملفاتها.`; await interaction.editReply(p); return true; }
  if (action === 'testlab-hide') { if(await app.testLabService.active(app.env.GUILD_ID))throw new Error('أنهِ الاختبار الجاري أولًا.'); await app.testLabService.setVisible(app.env.GUILD_ID,false); await interaction.update({content:'✅ تم إخفاء خيار التجارب من لوحة المالك. لإعادته استخدم `bash ops/show-test-lab.sh`. ولإزالته نهائيًا من الكود استخدم `bash ops/remove-test-lab-v1.9.3.sh`.',embeds:[],components:buttonRows([button('owner:meeting-center','رجوع للمركز',ButtonStyle.Secondary,'↩️')])}); return true; }
  // test-lab-v3.0:owner-handlers:end
  if (action === 'health') { await healthHome(interaction,app); return true; }
  if (action === 'health-workers') { await healthWorkers(interaction,app); return true; }
  if (action === 'health-recordings') { await healthRecordings(interaction,app); return true; }
  if (action === 'health-errors') { await healthErrors(interaction,app); return true; }
  if (action === 'delivery-control') { await deliveryModeControlScreen(interaction,app); return true; }
  if (action === 'delivery-mode-off') { await setDeliveryModeFromOwner(interaction,app,'off'); return true; }
  if (action === 'delivery-mode-team') { await setDeliveryModeFromOwner(interaction,app,'team_only'); return true; }
  if (action === 'delivery-mode-full') { await setDeliveryModeFromOwner(interaction,app,'full'); return true; }
  if (action === 'list') {
    await listMeetings(interaction, app, parts[3], parts[4]);
    return true;
  }
  if (action === 'open') {
    const meetingId = interaction.values?.[0];
    if (meetingId) await detail(interaction, app, parts[3], meetingId);
    else await listMeetings(interaction, app, parts[3], 0);
    return true;
  }
  if (action === 'detail') {
    await detail(interaction, app, parts[3], parts[4]);
    return true;
  }
  if (action === 'recipients') { await reminderRecipientsScreen(interaction,app,parts[3],parts[4]); return true; }
  if (action === 'recipients-add') { await reminderRecipientAddPicker(interaction,app,parts[3],parts[4],parts[5]); return true; }
  if (action === 'recipients-add-submit') { await reminderRecipientAddSubmit(interaction,app,parts[3],parts[4]); return true; }
  if (action === 'recipients-remove') { await reminderRecipientRemovePicker(interaction,app,parts[3],parts[4],parts[5]); return true; }
  if (action === 'recipients-remove-submit') { await reminderRecipientRemoveSubmit(interaction,app,parts[3],parts[4]); return true; }
  if (action === 'recipients-team') { await reminderRecipientsUseTeam(interaction,app,parts[3],parts[4]); return true; }
  if (action === 'recipients-search-open') { const d=app.drafts.get(rrDraftKey(interaction.user.id,parts[4])); await interaction.showModal(reminderRecipientSearchModal(parts[3],parts[4],parts[5]||0,String(d?.query??''))); return true; }
  if (action === 'recipients-search-submit') { app.drafts.set(rrDraftKey(interaction.user.id,parts[4]),{query:interaction.fields.getTextInputValue('query').trim()}); await reminderRecipientAddPicker(interaction,app,parts[3],parts[4],parts[5]||0); return true; }
  if (action === 'recipients-search-clear') { app.drafts.delete(rrDraftKey(interaction.user.id,parts[4])); await reminderRecipientAddPicker(interaction,app,parts[3],parts[4],0); return true; }
  if (action === 'sub') {
    await subPage(interaction, app, parts[3], parts[4], parts[5], parts[6]);
    return true;
  }
  await home(interaction, app);
  return true;
}

