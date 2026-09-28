#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.7.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-public-room-v${VERSION}-${STAMP}"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

mkdir -p "$BACKUP/src/application/services" "$BACKUP/src/interfaces/discord/commands"
[ -f src/application/services/AIChatRoomService.js ] || die "AIChatRoomService.js غير موجود"
[ -f src/interfaces/discord/commands/ai.js ] || die "ai.js غير موجود"
[ -f src/index.js ] || die "index.js غير موجود"
[ -f src/app.js ] || die "app.js غير موجود"

say "============================================================"
say " Meeting 967 — AI Public Room v${VERSION}"
say " قناة AI-967🤖 عامة واحدة للجميع"
say "============================================================"

cp -a src/application/services/AIChatRoomService.js "$BACKUP/src/application/services/AIChatRoomService.js"
cp -a src/interfaces/discord/commands/ai.js "$BACKUP/src/interfaces/discord/commands/ai.js"
cp -a src/index.js "$BACKUP/src/index.js"
cp -a src/app.js "$BACKUP/src/app.js"

say "🌐 تجهيز قناة AI-967🤖 العامة..."

cat > src/application/services/AIChatRoomService.js <<'JS'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';

const CATEGORY_NAME='🤖・AI 967';
const PUBLIC_CHANNEL_NAME='ai-967🤖';
const PUBLIC_MARKER='AI967_PUBLIC|1';
const PUBLIC_TOPIC=[
  'AI 967 | المساعد الذكي الرسمي لـ Meeting 967',
  'مساحة عامة للأسئلة حول البوت والنظام والمهام والاجتماعات والعضوية والصلاحيات',
  'اكتب سؤالك مباشرة هنا أو استخدم /ai من أي مكان لفتح القناة',
].join(' — ');

const LEGACY_ANNOUNCEMENT_NAME='ai-967-legacy';
const LEGACY_PRIVATE_PREFIXES=['AI967_ROOM|','AI967_PRIVATE|'];

function memberSubject(message){
  const member=message.member;
  return {
    guild:message.guild,
    guildId:String(message.guild.id),
    userId:String(message.author.id),
    roleIds:member?.roles?.cache?[...member.roles.cache.keys()]:[],
    member,
  };
}

export class AIChatRoomService{
  constructor({env,logger,aiAgentService}){
    Object.assign(this,{env,logger,aiAgentService});
    this.botUserId=null;
    this.active=new Set();
  }

  botId(guild){
    this.botUserId=String(
      guild.members.me?.id ??
      guild.client?.user?.id ??
      this.botUserId ??
      ''
    );
    return this.botUserId;
  }

  async fetchChannels(guild){
    const fetched=await guild.channels.fetch().catch(()=>null);
    return fetched?.values
      ? [...fetched.values()]
      : [...guild.channels.cache.values()];
  }

  async ensureCategory(guild){
    const channels=await this.fetchChannels(guild);

    let category=channels.find(
      c=>c?.type===ChannelType.GuildCategory&&c.name===CATEGORY_NAME
    );

    const everyone=guild.roles.everyone;
    const botId=this.botId(guild);

    if(!category){
      category=await guild.channels.create({
        name:CATEGORY_NAME,
        type:ChannelType.GuildCategory,
        permissionOverwrites:[
          {
            id:everyone.id,
            allow:[
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          ...(botId?[{
            id:botId,
            allow:[
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.ManageChannels,
            ],
          }]:[]),
        ],
        reason:'Meeting 967 — AI public room',
      });
    }else{
      await category.permissionOverwrites.edit(everyone,{
        ViewChannel:true,
        ReadMessageHistory:true,
      }).catch(()=>{});

      if(botId){
        await category.permissionOverwrites.edit(botId,{
          ViewChannel:true,
          ReadMessageHistory:true,
          SendMessages:true,
          EmbedLinks:true,
          AttachFiles:true,
          ManageMessages:true,
          ManageChannels:true,
        }).catch(()=>{});
      }
    }

    return category;
  }

  async renameLegacyAnnouncement(channel){
    try{
      await channel.setName(LEGACY_ANNOUNCEMENT_NAME);
      await channel.setTopic(
        'AI 967 — قناة قديمة للأرشيف فقط. استخدم قناة AI-967🤖 الجديدة للمحادثة العامة.'
      );
    }catch(error){
      this.logger?.warn?.('ai-legacy-channel-rename-failed',{
        channelId:channel.id,
        error:error?.message??String(error),
      });
    }
  }

  async findPublicChannel(guild){
    const channels=await this.fetchChannels(guild);

    // Preferred marker.
    const marked=channels.find(
      c=>c?.type===ChannelType.GuildText &&
        String(c.topic??'').startsWith(PUBLIC_MARKER)
    );
    if(marked)return marked;

    // Fallback exact text-channel name.
    const named=channels.find(
      c=>c?.type===ChannelType.GuildText &&
        String(c.name??'')===PUBLIC_CHANNEL_NAME
    );
    if(named)return named;

    return null;
  }

  async findLegacySameNameAnnouncement(guild){
    const channels=await this.fetchChannels(guild);
    return channels.find(
      c=>c?.type===ChannelType.GuildAnnouncement &&
      String(c.name??'')===PUBLIC_CHANNEL_NAME
    )??null;
  }

  async configurePublicChannel(channel,category,guild){
    const everyone=guild.roles.everyone;
    const botId=this.botId(guild);

    await channel.setParent(category.id,{lockPermissions:false}).catch(()=>{});
    await channel.setName(PUBLIC_CHANNEL_NAME).catch(()=>{});
    await channel.setTopic(`${PUBLIC_MARKER} — ${PUBLIC_TOPIC}`).catch(()=>{});

    // Shared public chat: everyone can read and write.
    await channel.permissionOverwrites.edit(everyone,{
      ViewChannel:true,
      ReadMessageHistory:true,
      SendMessages:true,
      EmbedLinks:true,
      AttachFiles:true,
      SendMessagesInThreads:true,
    }).catch(()=>{});

    if(botId){
      await channel.permissionOverwrites.edit(botId,{
        ViewChannel:true,
        ReadMessageHistory:true,
        SendMessages:true,
        EmbedLinks:true,
        AttachFiles:true,
        SendMessagesInThreads:true,
        ManageMessages:true,
      }).catch(()=>{});
    }

    return channel;
  }

  async ensurePublicRoom(guild){
    this.botId(guild);

    const category=await this.ensureCategory(guild);

    let channel=await this.findPublicChannel(guild);

    // An announcement channel cannot be turned into a normal text channel.
    // Preserve it as legacy and create the correct public text channel.
    if(!channel){
      const legacy=await this.findLegacySameNameAnnouncement(guild);
      if(legacy)await this.renameLegacyAnnouncement(legacy);

      channel=await guild.channels.create({
        name:PUBLIC_CHANNEL_NAME,
        type:ChannelType.GuildText,
        parent:category.id,
        topic:`${PUBLIC_MARKER} — ${PUBLIC_TOPIC}`,
        permissionOverwrites:[
          {
            id:guild.roles.everyone.id,
            allow:[
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.SendMessagesInThreads,
            ],
          },
          ...(this.botUserId?[{
            id:this.botUserId,
            allow:[
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.SendMessagesInThreads,
              PermissionFlagsBits.ManageMessages,
            ],
          }]:[]),
        ],
        reason:'Meeting 967 — إنشاء قناة AI-967 العامة',
      });
    }else{
      await this.configurePublicChannel(channel,category,guild);
    }

    // Hide only the old per-user private AI rooms from the previous experiments.
    const channels=await this.fetchChannels(guild);
    for(const old of channels){
      if(old.id===channel.id)continue;
      if(old.type!==ChannelType.GuildText)continue;

      const topic=String(old.topic??'');
      if(LEGACY_PRIVATE_PREFIXES.some(prefix=>topic.startsWith(prefix))){
        await old.permissionOverwrites.edit(guild.roles.everyone,{
          ViewChannel:false,
          SendMessages:false,
          ReadMessageHistory:false,
        }).catch(()=>{});
      }
    }

    // Welcome message only once.
    const recent=await channel.messages.fetch({limit:20}).catch(()=>null);
    const welcomeExists=[...(recent?.values?.()??[])].some(
      m=>String(m.author?.id)===this.botUserId &&
        String(m.content??'').includes('مرحبًا بك في AI 967')
    );

    if(!welcomeExists){
      await channel.send({
        content:[
          '## 🤖 AI 967',
          '',
          'مرحبًا بك في AI 967',
          'هذه هي المساحة العامة الموحدة للمساعد الذكي داخل Meeting 967',
          '',
          'اكتب سؤالك هنا مباشرة باستخدام مربع الكتابة العادي',
          '',
          'يمكنك السؤال عن:',
          '• طريقة استخدام البوت',
          '• المهام والتكليفات',
          '• الاجتماعات والمواعيد',
          '• العضوية والصلاحيات',
          '• سبب حدوث مشكلة في البوت',
          '• تفاصيل النظام والكود عند الحاجة',
          '',
          '🔎 عند السؤال عن كيفية عمل ميزة في البوت يمكن لـAI الرجوع إلى الكود الحالي قبل الإجابة',
          '',
          '⚠️ لا ترسل كلمات المرور أو مفاتيح API أو أي أسرار',
        ].join('\n'),
      });
    }

    return channel;
  }

  async openFromInteraction(i,subject){
    const channel=await this.ensurePublicRoom(subject.guild);
    const url=`https://discord.com/channels/${subject.guild.id}/${channel.id}`;

    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('فتح AI-967🤖')
        .setEmoji('🤖')
        .setURL(url)
    );

    const payload={
      content:[
        '🤖 **AI 967**',
        'هذه قناة AI 967 العامة لجميع الأعضاء',
        `${channel.toString()}`,
        '',
        'اضغط الزر للدخول والكتابة مباشرة في القناة.',
      ].join('\n'),
      components:[row],
      embeds:[],
    };

    if(i.deferred||i.replied)return i.editReply(payload);
    return i.reply({...payload,ephemeral:Boolean(i.guildId)});
  }

  async openFromCommand(i,subject,question=null){
    const channel=await this.ensurePublicRoom(subject.guild);
    const url=`https://discord.com/channels/${subject.guild.id}/${channel.id}`;

    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('فتح AI-967🤖')
        .setEmoji('🤖')
        .setURL(url)
    );

    const payload={
      content:[
        '🤖 **AI 967**',
        `القناة العامة: ${channel.toString()}`,
        '',
        question
          ? 'تم استلام سؤالك. ادخل القناة واكتبه هناك حتى يبقى كل شيء داخل مساحة AI 967 العامة.'
          : 'ادخل القناة واكتب سؤالك مباشرة.',
      ].join('\n'),
      components:[row],
      embeds:[],
    };

    if(i.deferred||i.replied)await i.editReply(payload);
    else await i.reply({...payload,ephemeral:Boolean(i.guildId)});
  }

  async handleMessage(message){
    if(!message?.guild||message.author?.bot)return false;
    if(message.channel?.type!==ChannelType.GuildText)return false;

    const topic=String(message.channel.topic??'');
    const name=String(message.channel.name??'');

    const isAIChannel=
      topic.startsWith(PUBLIC_MARKER) ||
      name===PUBLIC_CHANNEL_NAME;

    if(!isAIChannel)return false;

    const text=String(message.content??'').trim();
    if(!text)return false;

    const key=`${message.guild.id}:${message.author.id}`;

    if(this.active.has(key)){
      await message.reply('⏳ ما زلت أعالج رسالتك السابقة، انتظر لحظة.');
      return true;
    }

    this.active.add(key);

    try{
      const subject=memberSubject(message);

      await message.channel.sendTyping();

      const result=await this.aiAgentService.respond(subject,text);

      if(result?.kind==='confirmation'){
        await message.channel.send({
          content:[
            `<@${message.author.id}>`,
            '🤖 **AI 967**',
            result.text,
            '',
            '**هل تريد تنفيذ العملية؟**',
          ].join('\n'),
          components:this._confirmButtons(result.token),
          allowedMentions:{users:[String(message.author.id)]},
        });
      }else{
        await message.channel.send({
          content:[
            `<@${message.author.id}>`,
            '🤖 **AI 967**',
            String(result?.text??'لم أحصل على إجابة واضحة.'),
          ].join('\n'),
          allowedMentions:{users:[String(message.author.id)]},
        });
      }
    }catch(error){
      this.logger?.error?.('ai-public-message-failed',{
        guildId:message.guild.id,
        userId:message.author.id,
        channelId:message.channel.id,
        error:error?.stack??String(error),
      });

      await message.channel.send(
        `<@${message.author.id}> ⚠️ حصل خطأ أثناء معالجة رسالتك حاول مرة ثانية`
      ).catch(()=>{});
    }finally{
      this.active.delete(key);
    }

    return true;
  }

  _confirmButtons(token){
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ai:confirm:${token}`)
          .setLabel('تنفيذ')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId(`ai:reject:${token}`)
          .setLabel('إلغاء')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('✖️'),
      ),
    ];
  }

  async reset(subject){
    this.aiAgentService.reset(subject);
  }

  async contextText(subject){
    const ctx=await this.aiAgentService.personalContext(subject);
    const teams=(ctx.teams??[]).map(x=>x.name).filter(Boolean).join('، ')||'لا يوجد';
    const tasks=(ctx.tasks??[]).filter(x=>!['done','cancelled'].includes(String(x.status))).length;
    const meetings=(ctx.meetings??[]).length;

    return [
      '## 📋 سياقك في AI 967',
      '',
      `**الفرق:** ${teams}`,
      `**المهام المفتوحة:** ${tasks}`,
      `**الاجتماعات القادمة:** ${meetings}`,
      `**النقاط:** ${Number(ctx.points??0)}`,
      `**حالة العضوية:** ${ctx.membership?.status??'غير محددة'}`,
    ].join('\n');
  }
}
JS

say "🔧 تحديث ai.js..."

cat > src/interfaces/discord/commands/ai.js <<'JS'
import {AppError} from '../../../core/errors/AppError.js';
import {subjectFromInteraction} from '../context.js';

async function getSubject(i,a){
  const s=await subjectFromInteraction(i,a.env);

  if(!s?.member){
    throw new AppError(
      'AI_MEMBER_ONLY',
      'مساعد AI 967 متاح لأعضاء السيرفر فقط.'
    );
  }

  if(!a.aiAgentService){
    throw new AppError(
      'AI_AGENT_MISSING',
      'خدمة AI Agent غير مفعّلة.'
    );
  }

  if(!a.aiChatRoomService){
    throw new AppError(
      'AI_CHAT_MISSING',
      'خدمة قناة AI 967 غير مفعّلة.'
    );
  }

  return s;
}

export async function aiCommand(i,a){
  const s=await getSubject(i,a);

  if(!i.guildId){
    throw new AppError(
      'AI_GUILD_ONLY',
      'افتح AI 967 من داخل السيرفر.'
    );
  }

  const question=i.options?.getString?.('question')?.trim()||null;

  return a.aiChatRoomService.openFromCommand(i,s,question);
}

export async function handleAIInteraction(i,a,s,id){
  const subject=s??await getSubject(i,a);

  if(id==='ai:open'){
    return a.aiChatRoomService.openFromInteraction(i,subject);
  }

  if(id==='ai:room:new'){
    await a.aiChatRoomService.reset(subject);
    return a.aiChatRoomService.openFromInteraction(i,subject);
  }

  if(id==='ai:room:context'){
    const text=await a.aiChatRoomService.contextText(subject);
    return i.reply({
      content:text,
      ephemeral:Boolean(i.guildId),
    });
  }

  if(id.startsWith('ai:confirm:')){
    const token=id.slice('ai:confirm:'.length);
    const result=await a.aiAgentService.confirm(subject,token);

    return i.update({
      content:`✅ **تم التنفيذ**\n${result.summary}`,
      components:[],
      embeds:[],
    });
  }

  if(id.startsWith('ai:reject:')){
    const token=id.slice('ai:reject:'.length);
    const pending=a.aiAgentService.getPending(subject,token);

    if(pending){
      a.aiAgentService.pending.delete(
        `${subject.guildId}:${subject.userId}:${token}`
      );
    }

    return i.update({
      content:'✖️ **تم إلغاء العملية**\nلم يتم تغيير أي بيانات.',
      components:[],
      embeds:[],
    });
  }

  return false;
}
JS

say "🧪 فحص JavaScript..."
node --check src/application/services/AIChatRoomService.js
node --check src/interfaces/discord/commands/ai.js
node --check src/index.js
node --check src/app.js

say "🧪 اختبار بنية القناة العامة..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';

const room=fs.readFileSync('src/application/services/AIChatRoomService.js','utf8');
const ai=fs.readFileSync('src/interfaces/discord/commands/ai.js','utf8');

assert.match(room,/PUBLIC_CHANNEL_NAME='ai-967🤖'/);
assert.match(room,/ChannelType\.GuildText/);
assert.match(room,/SendMessages:true/);
assert.match(room,/PUBLIC_MARKER/);
assert.match(room,/ButtonStyle\.Link/);
assert.match(room,/handleMessage/);
assert.doesNotMatch(room,/ChannelType\.PrivateThread/);

assert.match(ai,/openFromCommand/);
assert.match(ai,/ai:open/);
assert.doesNotMatch(ai,/ModalBuilder/);

console.log('✅ public AI room architecture verified');
NODE

say "🧪 تحقق من messageCreate..."
grep -n "aiChatRoomService?.handleMessage" src/index.js >/dev/null || die "messageCreate handler غير مربوط"

say ""
say "✅ AI Public Room v${VERSION} تم تركيبه بنجاح."
say "🛟 Backup: $BACKUP"
say ""
say "التصميم:"
say "  • قناة واحدة فقط: ai-967🤖"
say "  • قناة Text عادية وليست Announcement"
say "  • كل الأعضاء يقدرون يشوفونها ويكتبون فيها"
say "  • الأسئلة والأجوبة تظهر للجميع داخل القناة"
say "  • /ai من أي قناة يعطي رابطًا مباشرًا إلى AI-967🤖"
say "  • زر AI 967 من اللوحة يفتح نفس القناة"
say "  • لا توجد قنوات خاصة أو Threads خاصة للمستخدمين"
say ""
say "أعد التشغيل:"
say "npm start"
