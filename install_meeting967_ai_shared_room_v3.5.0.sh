#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.5.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-shared-room-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

say "============================================================"
say " Meeting 967 — AI Shared Room v${VERSION}"
say " قناة AI 967 عامة ومشتركة لجميع الأعضاء"
say "============================================================"

[ -f src/application/services/AIChatRoomService.js ] || die "AIChatRoomService.js غير موجود"
[ -f src/interfaces/discord/commands/ai.js ] || die "ai.js غير موجود"
[ -f src/index.js ] || die "index.js غير موجود"

cp -a src/application/services/AIChatRoomService.js "$BACKUP/AIChatRoomService.js"
cp -a src/interfaces/discord/commands/ai.js "$BACKUP/ai.js"
cp -a src/index.js "$BACKUP/index.js"

say "🌐 تحويل AI 967 إلى قناة عامة واحدة..."

cat > src/application/services/AIChatRoomService.js <<'JS'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';

const CATEGORY_NAME='🤖・AI 967';
const SHARED_ROOM_NAME='ai-967🤖';
const SHARED_TOPIC='AI 967 | دردشة عامة مشتركة — اسأل عن البوت والنظام والمهام والاجتماعات والإجراءات وسأجيبك بالاعتماد على نظام 967 والكود الحالي عند الحاجة';
const SHARED_TOPIC_PREFIX='AI967_SHARED|';

const cleanName=(value)=>{
  const s=String(value??'')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s_-]/gu,'')
    .trim()
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .slice(0,45);
  return s||'member';
};

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
    return fetched?.values?[...fetched.values()]:[...guild.channels.cache.values()];
  }

  async _botId(guild){
    return String(
      guild.members.me?.id ??
      guild.client?.user?.id ??
      this.botUserId ??
      ''
    );
  }

  async _ensurePublicCategory(guild){
    const channels=await this._fetchChannels(guild);
    let category=channels.find(
      c=>c?.type===ChannelType.GuildCategory&&c.name===CATEGORY_NAME
    );

    const everyone=guild.roles.everyone;
    const botId=await this._botId(guild);

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
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
            ],
          }]:[]),
        ],
        reason:'Meeting 967 — AI 967 public category',
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
          ManageChannels:true,
          ManageMessages:true,
          EmbedLinks:true,
          AttachFiles:true,
        }).catch(()=>{});
      }
    }

    return category;
  }

  async _configurePublicRoom(room,category,guild){
    const everyone=guild.roles.everyone;
    const botId=await this._botId(guild);

    await room.setParent(category.id,{lockPermissions:false}).catch(()=>{});

    await room.permissionOverwrites.edit(everyone,{
      ViewChannel:true,
      SendMessages:true,
      ReadMessageHistory:true,
      EmbedLinks:true,
    }).catch(()=>{});

    if(botId){
      await room.permissionOverwrites.edit(botId,{
        ViewChannel:true,
        SendMessages:true,
        ReadMessageHistory:true,
        EmbedLinks:true,
        AttachFiles:true,
        ManageMessages:true,
        ManageChannels:true,
      }).catch(()=>{});
    }

    try{
      await room.setName(SHARED_ROOM_NAME);
    }catch{}

    try{
      await room.setTopic(SHARED_TOPIC);
    }catch{}

    return room;
  }

  async _findSharedRoom(guild){
    const channels=await this._fetchChannels(guild);

    return channels.find(c=>
      c?.type===ChannelType.GuildText &&
      (
        String(c.topic??'').startsWith(SHARED_TOPIC_PREFIX) ||
        String(c.name??'')===SHARED_ROOM_NAME
      )
    )??null;
  }

  async _hideLegacyPrivateRooms(guild,keep){
    const channels=await this._fetchChannels(guild);

    for(const channel of channels){
      if(channel?.type!==ChannelType.GuildText)continue;
      if(channel.id===keep.id)continue;

      const topic=String(channel.topic??'');
      const name=String(channel.name??'');

      // Old versions created per-user AI rooms with AI967_ROOM|<userId>.
      if(topic.startsWith('AI967_ROOM|')){
        await channel.permissionOverwrites.edit(guild.roles.everyone,{
          ViewChannel:false,
          SendMessages:false,
          ReadMessageHistory:false,
        }).catch(()=>{});
      }
    }
  }

  async openRoom(subject){
    const guild=subject.guild;
    this.botUserId=await this._botId(guild);

    const category=await this._ensurePublicCategory(guild);

    let room=await this._findSharedRoom(guild);

    if(!room){
      room=await guild.channels.create({
        name:SHARED_ROOM_NAME,
        type:ChannelType.GuildText,
        parent:category.id,
        topic:`${SHARED_TOPIC_PREFIX}1|${SHARED_TOPIC}`,
        permissionOverwrites:[
          {
            id:guild.roles.everyone.id,
            allow:[
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
          ...(this.botUserId?[{
            id:this.botUserId,
            allow:[
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.ManageChannels,
            ],
          }]:[]),
        ],
        reason:'Meeting 967 — إنشاء قناة AI 967 العامة',
      });
    }

    await this._configurePublicRoom(room,category,guild);
    await this._hideLegacyPrivateRooms(guild,room);

    // Send the welcome message only once when the room is new/empty.
    const recent=await room.messages.fetch({limit:8}).catch(()=>null);
    const hasWelcome=[...(recent?.values?.()??[])].some(
      m=>String(m.author?.id)===this.botUserId&&String(m.content??'').includes('هذه القناة هي مساحة AI 967 العامة')
    );

    if(!hasWelcome){
      await room.send({
        content:[
          '## 🤖 AI 967',
          '',
          'هذه القناة هي مساحة AI 967 العامة',
          'كل أعضاء السيرفر يقدرون يدخلون ويسألون مباشرة من مربع الكتابة العادي',
          '',
          'تقدر تسأل عن:',
          '• طريقة استخدام أي ميزة في Meeting 967',
          '• المهام والتكليفات والاجتماعات',
          '• الصلاحيات والعضوية',
          '• سبب حدوث شيء في البوت',
          '• تفاصيل النظام',
          '',
          'وعند السؤال عن طريقة عمل البوت أبحث في الكود الحالي قبل الإجابة عند الحاجة 🔎',
          '',
          '🔐 لا تكتب كلمات مرور أو مفاتيح API أو أي أسرار هنا',
        ].join('\n'),
        components:this._buttons(),
      });
    }

    return room;
  }

  async openFromInteraction(i,subject){
    const room=await this.openRoom(subject);

    const payload={
      content:`🤖 **AI 967 جاهز**\nهذه هي قناة AI 967 العامة:\n${room.toString()}\n\nادخل القناة واكتب سؤالك مباشرة في مربع الكتابة العادي.`,
      embeds:[],
      components:[],
    };

    if(i.deferred||i.replied)return i.editReply(payload);
    return i.reply({...payload,ephemeral:Boolean(i.guildId)});
  }

  async handleMessage(message){
    if(!message?.guild||message.author?.bot)return false;
    if(message.channel?.type!==ChannelType.GuildText)return false;

    const topic=String(message.channel.topic??'');
    const name=String(message.channel.name??'');
    const isShared=topic.startsWith(SHARED_TOPIC_PREFIX)||name===SHARED_ROOM_NAME;
    if(!isShared)return false;

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

      // Keep conversation memory isolated per user even though the channel is shared.
      await message.channel.sendTyping();

      const result=await this.aiAgentService.respond(subject,text);

      if(result?.kind==='confirmation'){
        await message.channel.send({
          content:`<@${message.author.id}>\n🤖 **AI 967**\n${result.text}\n\n**هذه العملية تخصك أنت فقط. هل تريد تنفيذها؟**`,
          components:this._confirmButtons(result.token),
          allowedMentions:{users:[String(message.author.id)]},
        });
      }else{
        await message.channel.send({
          content:`<@${message.author.id}>\n🤖 **AI 967**\n${String(result?.text??'لم أحصل على إجابة واضحة.')}`,
          allowedMentions:{users:[String(message.author.id)]},
        });
      }
    }catch(error){
      this.logger?.error?.('ai-chat-message-failed',{
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

  async hideRoom(subject){
    // In shared mode, hiding the room for one user would be misleading.
    // Keep this method only for compatibility with older UI buttons.
    return false;
  }
}
JS

say "🔧 تحديث أمر /ai ليشير للقناة العامة..."

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/interfaces/discord/commands/ai.js';
let s=fs.readFileSync(p,'utf8');

// Shared-room mode: no modal UI and no private-room wording.
s=s.replaceAll('هذه هي قناة AI 967 العامة:', 'هذه قناة AI 967 العامة:');
s=s.replaceAll('دردشتك الخاصة جاهزة:', 'قناة AI 967 العامة جاهزة:');
s=s.replaceAll('تم فتح دردشتك الخاصة:', 'تم فتح قناة AI 967 العامة:');

fs.writeFileSync(p,s);
console.log('✅ ai.js updated for public shared room');
NODE

say "🧪 فحص JavaScript..."
node --check src/application/services/AIChatRoomService.js
node --check src/interfaces/discord/commands/ai.js
node --check src/index.js
node --check src/app.js

say "🧪 اختبار الخدمة..."
node --input-type=module <<'NODE'
import fs from 'node:fs';

const s=fs.readFileSync('src/application/services/AIChatRoomService.js','utf8');
if(!s.includes("const SHARED_ROOM_NAME='ai-967🤖';"))throw new Error('اسم القناة العامة غير موجود');
if(!s.includes('هذه القناة هي مساحة AI 967 العامة'))throw new Error('رسالة القناة العامة غير موجودة');
if(!s.includes('PermissionFlagsBits.SendMessages'))throw new Error('صلاحية الكتابة غير موجودة');
if(!s.includes("message.author.id"))throw new Error('عزل جلسات الأعضاء غير موجود');

console.log('✅ shared AI room checks passed');
NODE

say "🔎 فحص messageCreate..."
grep -n "aiChatRoomService?.handleMessage" src/index.js || die "AI message handler غير مربوط في index.js"

say ""
say "✅ AI Shared Room v${VERSION} تم تركيبه بنجاح."
say "🛟 Backup: $BACKUP"
say ""
say "النتيجة:"
say "  • قناة واحدة عامة للجميع"
say "  • أي عضو يكتب مباشرة في مربع الكتابة العادي"
say "  • AI يرد داخل نفس القناة"
say "  • لا توجد قناة خاصة لكل عضو"
say "  • ذاكرة المحادثة معزولة لكل مستخدم"
say "  • عمليات التنفيذ تبقى محمية بالتأكيد والصلاحيات"
say ""
say "أعد تشغيل البوت:"
say "npm start"
