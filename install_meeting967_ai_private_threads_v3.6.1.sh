#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.6.1"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-private-threads-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

say "============================================================"
say " Meeting 967 — AI Private Threads v${VERSION}"
say " بوابة عامة + Private Thread خاص لكل عضو"
say "============================================================"

[ -f src/application/services/AIChatRoomService.js ] || die "AIChatRoomService.js غير موجود"
[ -f src/interfaces/discord/commands/ai.js ] || die "ai.js غير موجود"
[ -f src/index.js ] || die "index.js غير موجود"
[ -f src/app.js ] || die "app.js غير موجود"

mkdir -p "$BACKUP/src/application/services" \
         "$BACKUP/src/interfaces/discord/commands"

cp -a src/application/services/AIChatRoomService.js "$BACKUP/src/application/services/AIChatRoomService.js"
cp -a src/interfaces/discord/commands/ai.js "$BACKUP/src/interfaces/discord/commands/ai.js"

say "🔐 تثبيت نسخة Private Thread المصححة..."

cat > src/application/services/AIChatRoomService.js <<'JS'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
} from 'discord.js';

const CATEGORY_NAME='🤖・AI 967';
const PARENT_NAME='ai-967🤖';
const PARENT_TOPIC='AI 967 | بوابة المحادثة الخاصة — اضغط AI 967 من لوحة التحكم لفتح محادثتك الخاصة مع المساعد';
const THREAD_PREFIX='ai-967-private-u-';
const THREAD_MARKER='AI967_PRIVATE|';
const LEGACY_ANNOUNCEMENT_NAME='ai-967-legacy';

const memberSubject=(message)=>({
  guild:message.guild,
  guildId:String(message.guild.id),
  userId:String(message.author.id),
  roleIds:message.member?.roles?.cache?[...message.member.roles.cache.keys()]:[],
  member:message.member,
});

export class AIChatRoomService{
  constructor({env,logger,aiAgentService}){
    Object.assign(this,{env,logger,aiAgentService});
    this.botUserId=null;
    this.active=new Set();
    this.threadCache=new Map();
  }

  _botId(guild){
    return String(
      guild.members.me?.id ??
      guild.client?.user?.id ??
      this.botUserId ??
      ''
    );
  }

  _threadOwnerId(thread){
    const name=String(thread?.name??'');
    if(!name.startsWith(THREAD_PREFIX))return null;
    const m=name.match(/-(\d{15,25})$/);
    return m?.[1]??null;
  }

  _threadName(userId,displayName){
    const safe=String(displayName??'member')
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}\s_-]/gu,'')
      .trim()
      .replace(/\s+/g,'-')
      .replace(/-+/g,'-')
      .slice(0,38)||'member';

    return `${THREAD_PREFIX}${safe}-${String(userId)}`.slice(0,100);
  }

  _buttons(){
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ai:room:new')
          .setLabel('محادثة جديدة')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🆕'),
        new ButtonBuilder()
          .setCustomId('ai:room:context')
          .setLabel('سياقي')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋'),
      ),
    ];
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

  async _fetchChannels(guild){
    const fetched=await guild.channels.fetch().catch(()=>null);
    return fetched?.values
      ? [...fetched.values()]
      : [...guild.channels.cache.values()];
  }

  async _ensureCategory(guild){
    const channels=await this._fetchChannels(guild);
    let category=channels.find(
      c=>c?.type===ChannelType.GuildCategory&&c.name===CATEGORY_NAME
    );

    const everyone=guild.roles.everyone;
    const botId=this._botId(guild);

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
              PermissionFlagsBits.SendMessagesInThreads,
              PermissionFlagsBits.CreatePrivateThreads,
              PermissionFlagsBits.ManageThreads,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
            ],
          }]:[]),
        ],
        reason:'Meeting 967 — AI 967 private threads',
      });
    }

    if(botId){
      await category.permissionOverwrites.edit(everyone,{
        ViewChannel:true,
        ReadMessageHistory:true,
      }).catch(()=>{});

      await category.permissionOverwrites.edit(botId,{
        ViewChannel:true,
        ReadMessageHistory:true,
        SendMessages:true,
        SendMessagesInThreads:true,
        CreatePrivateThreads:true,
        ManageThreads:true,
        EmbedLinks:true,
        AttachFiles:true,
      }).catch(()=>{});
    }

    return category;
  }

  async _findParent(guild){
    const channels=await this._fetchChannels(guild);

    return channels.find(c=>
      c?.type===ChannelType.GuildText &&
      String(c.name)===PARENT_NAME
    )??null;
  }

  async _findLegacyAnnouncement(guild){
    const channels=await this._fetchChannels(guild);

    return channels.find(c=>
      c?.type===ChannelType.GuildAnnouncement &&
      String(c.name)===PARENT_NAME
    )??null;
  }

  async _prepareLegacyAnnouncement(guild){
    const announcement=await this._findLegacyAnnouncement(guild);
    if(!announcement)return;

    try{
      await announcement.setName(LEGACY_ANNOUNCEMENT_NAME);
      await announcement.setTopic(
        'AI 967 | قناة إعلانات قديمة — المحادثات الخاصة موجودة في ai-967🤖'
      );
      this.logger?.info?.('ai-legacy-announcement-renamed',{
        guildId:guild.id,
        channelId:announcement.id,
      });
    }catch(error){
      this.logger?.warn?.('ai-legacy-announcement-rename-failed',{
        guildId:guild.id,
        channelId:announcement.id,
        error:error?.message??String(error),
      });
    }
  }

  async _configureParent(parent,category,guild){
    const everyone=guild.roles.everyone;
    const botId=this._botId(guild);

    await parent.setParent(category.id,{lockPermissions:false}).catch(()=>{});
    await parent.setName(PARENT_NAME).catch(()=>{});
    await parent.setTopic(PARENT_TOPIC).catch(()=>{});

    // Main room is a public entry/landing room.
    // Members do NOT post ordinary messages here.
    await parent.permissionOverwrites.edit(everyone,{
      ViewChannel:true,
      ReadMessageHistory:true,
      SendMessages:false,
      CreatePublicThreads:false,
      CreatePrivateThreads:false,
      SendMessagesInThreads:true,
    }).catch(()=>{});

    if(botId){
      await parent.permissionOverwrites.edit(botId,{
        ViewChannel:true,
        ReadMessageHistory:true,
        SendMessages:true,
        SendMessagesInThreads:true,
        CreatePrivateThreads:true,
        ManageThreads:true,
        EmbedLinks:true,
        AttachFiles:true,
      }).catch(()=>{});
    }

    return parent;
  }

  async _getOrCreateParent(guild,category){
    let parent=await this._findParent(guild);

    // The screenshot showed the old channel as an Announcement Channel.
    // Private Threads are a Guild Text feature, so preserve the old channel
    // and create/use a proper Text Channel with the desired name.
    if(!parent){
      await this._prepareLegacyAnnouncement(guild);

      parent=await guild.channels.create({
        name:PARENT_NAME,
        type:ChannelType.GuildText,
        parent:category.id,
        topic:PARENT_TOPIC,
        permissionOverwrites:[
          {
            id:guild.roles.everyone.id,
            allow:[
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.SendMessagesInThreads,
            ],
            deny:[
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.CreatePublicThreads,
              PermissionFlagsBits.CreatePrivateThreads,
            ],
          },
          ...(this.botUserId?[{
            id:this.botUserId,
            allow:[
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.SendMessagesInThreads,
              PermissionFlagsBits.CreatePrivateThreads,
              PermissionFlagsBits.ManageThreads,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
            ],
          }]:[]),
        ],
        reason:'Meeting 967 — AI 967 text gateway for private conversations',
      });
    }

    return this._configureParent(parent,category,guild);
  }

  async _findUserThread(parent,userId){
    const cached=this.threadCache.get(String(userId));

    if(cached){
      const hit=parent.threads.cache.get(String(cached));
      if(hit&&!hit.archived)return hit;
    }

    const active=parent.threads.cache.find(
      t=>!t.archived&&this._threadOwnerId(t)===String(userId)
    );

    if(active){
      this.threadCache.set(String(userId),String(active.id));
      return active;
    }

    return null;
  }

  async openRoom(subject,{fresh=false}={}){
    const guild=subject.guild;
    this.botUserId=this._botId(guild);

    const category=await this._ensureCategory(guild);
    const parent=await this._getOrCreateParent(guild,category);

    let thread=await this._findUserThread(parent,subject.userId);

    if(fresh&&thread){
      await thread.setArchived(true,'Meeting 967 — بدء محادثة AI جديدة').catch(()=>{});
      thread=null;
      this.threadCache.delete(String(subject.userId));
      this.aiAgentService.reset(subject);
    }

    if(!thread){
      try{
        thread=await parent.threads.create({
          name:this._threadName(
            subject.userId,
            subject.member?.displayName??'member'
          ),
          type:ChannelType.PrivateThread,
          invitable:false,
          autoArchiveDuration:ThreadAutoArchiveDuration.OneDay,
          reason:`Meeting 967 — private AI conversation for ${subject.userId}`,
        });
      }catch(error){
        this.logger?.error?.('ai-private-thread-create-failed',{
          guildId:guild.id,
          userId:subject.userId,
          parentId:parent.id,
          error:error?.stack??String(error),
        });

        throw new Error(
          'تعذر إنشاء المحادثة الخاصة. تأكد أن البوت يملك Create Private Threads وManage Threads في قناة AI 967.'
        );
      }

      // Bot created the thread. Add the requesting member explicitly.
      await thread.members.add(String(subject.userId));

      this.threadCache.set(
        String(subject.userId),
        String(thread.id)
      );

      await thread.send({
        content:[
          '## 🤖 AI 967',
          '',
          `مرحبًا ${subject.member?.displayName??`<@${subject.userId}>`} 👋`,
          '',
          'هذه **محادثتك الخاصة مع AI 967**',
          'رسائلك وردود AI داخل هذه المحادثة لا تظهر لأعضاء السيرفر الآخرين',
          '',
          'اكتب رسالتك مباشرة باستخدام مربع الكتابة العادي',
          '',
          '🔎 عند السؤال عن طريقة عمل البوت أبحث في الكود الحالي عند الحاجة',
          '🧠 وأستخدم سياق حسابك وصلاحياتك وبيانات النظام عندما تكون مطلوبة',
          '🔐 لا ترسل كلمات مرور أو مفاتيح API أو أسرار',
        ].join('\n'),
        components:this._buttons(),
      });
    }else{
      await thread.members.add(String(subject.userId)).catch(()=>{});
      if(thread.archived)await thread.setArchived(false).catch(()=>{});
      this.threadCache.set(String(subject.userId),String(thread.id));
    }

    return {parent,thread};
  }

  async openFromInteraction(i,subject,{fresh=false}={}){
    const {thread}=await this.openRoom(subject,{fresh});

    const payload={
      content:
        `🤖 **AI 967**\n`+
        `تم فتح محادثتك الخاصة:\n`+
        `${thread.toString()}\n\n`+
        `ادخل إليها واكتب رسالتك في مربع الكتابة العادي.`,
      embeds:[],
      components:[],
    };

    if(i.deferred||i.replied)return i.editReply(payload);
    return i.reply({...payload,ephemeral:Boolean(i.guildId)});
  }

  isPrivateAIThread(channel){
    if(!channel?.isThread?.())return false;
    if(channel.type!==ChannelType.PrivateThread)return false;
    return this._threadOwnerId(channel)!=null;
  }

  async handleMessage(message){
    if(!message?.guild||message.author?.bot)return false;

    // Never process messages in the public gateway channel.
    if(!this.isPrivateAIThread(message.channel))return false;

    const ownerId=this._threadOwnerId(message.channel);

    // Only the owner of this private AI thread can talk to its AI.
    if(!ownerId||String(message.author.id)!==String(ownerId))return false;

    const text=String(message.content??'').trim();
    if(!text)return false;

    const key=`${message.guild.id}:${ownerId}`;

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
      this.logger?.error?.('ai-private-thread-message-failed',{
        guildId:message.guild.id,
        userId:ownerId,
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

  async reset(subject){
    this.aiAgentService.reset(subject);
    return true;
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

say "🧪 فحص JavaScript..."
node --check src/application/services/AIChatRoomService.js
node --check src/interfaces/discord/commands/ai.js
node --check src/index.js
node --check src/app.js

say "🧪 اختبار الخصوصية ومسار الرسائل..."
node --input-type=module <<'NODE'
import fs from 'node:fs';

const room=fs.readFileSync('src/application/services/AIChatRoomService.js','utf8');
const ai=fs.readFileSync('src/interfaces/discord/commands/ai.js','utf8');

for(const x of [
  'ChannelType.GuildText',
  'ChannelType.PrivateThread',
  'thread.members.add',
  'isPrivateAIThread',
  'SendMessages:false',
  'SendMessagesInThreads:true',
  'message.channel',
  'ownerId'
]){
  if(!room.includes(x))throw new Error(`Missing: ${x}`);
}

if(!ai.includes('openRoom'))throw new Error('ai.js لا يستخدم openRoom');
if(ai.includes('new ModalBuilder'))throw new Error('الواجهة القديمة Modal ما زالت في ai.js');

console.log('✅ Private thread architecture verified');
NODE

say "🧪 تحقق من messageCreate..."
grep -n "aiChatRoomService?.handleMessage" src/index.js >/dev/null || die "AI messageCreate handler غير مربوط"

say ""
say "✅ AI Private Threads v${VERSION} جاهز."
say "🛟 Backup: $BACKUP"
say ""
say "النتيجة:"
say "  • ai-967🤖 = بوابة عامة"
say "  • لا أحد يكتب أسئلة AI في البوابة نفسها"
say "  • AI 967 ينشئ Private Thread لكل عضو"
say "  • رسالة العضو + جواب AI داخل الـThread الخاص فقط"
say "  • لا يوجد خلط بين جلسات الأعضاء"
say "  • محادثة جديدة = Private Thread جديد"
say ""
say "أعد التشغيل:"
say "npm start"
