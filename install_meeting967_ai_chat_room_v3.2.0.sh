#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.2.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-chat-room-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

echo "============================================================"
echo " Meeting 967 — AI Chat Room v${VERSION}"
echo " شات حقيقي مستقل لكل عضو — بدون Modal"
echo "============================================================"

for f in \
  src/application/services/AIChatRoomService.js \
  src/interfaces/discord/commands/ai.js \
  src/interfaces/discord/interactions/misc.js \
  src/interfaces/discord/componentDispatcher.js \
  src/index.js \
  src/app.js
do
  if [ -f "$ROOT/$f" ]; then
    mkdir -p "$BACKUP/$(dirname "$f")"
    cp -a "$ROOT/$f" "$BACKUP/$f"
  fi
done

say(){ printf '%s\n' "$*"; }

say "💬 إنشاء خدمة غرف AI الخاصة..."

cat > src/application/services/AIChatRoomService.js <<'JS'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';

const CATEGORY_NAME='🤖・AI 967';
const TOPIC_PREFIX='AI967_ROOM|';
const AUTO_ARCHIVE_HOURS=24;

const cleanName=(value)=>{
  const s=String(value??'')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu,'')
    .trim()
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .slice(0,55);
  return s||'member';
};

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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

  _topic(userId){return `${TOPIC_PREFIX}${String(userId)}`;}
  _userIdFromTopic(topic=''){
    const s=String(topic);
    if(!s.startsWith(TOPIC_PREFIX))return null;
    const id=s.slice(TOPIC_PREFIX.length).trim();
    return /^\d{15,25}$/.test(id)?id:null;
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
        new ButtonBuilder()
          .setCustomId('ai:room:hide')
          .setLabel('إخفاء الدردشة')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔒'),
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

  async _fetchAllChannels(guild){
    const fetched=await guild.channels.fetch().catch(()=>null);
    return fetched?.values?[...fetched.values()]:[...guild.channels.cache.values()];
  }

  async _ensureCategory(guild){
    const channels=await this._fetchAllChannels(guild);
    let category=channels.find(c=>c?.type===ChannelType.GuildCategory&&c.name===CATEGORY_NAME);

    const everyone=guild.roles.everyone;
    const botId=String(guild.members.me?.id??guild.client?.user?.id??this.botUserId??'');

    if(!category){
      category=await guild.channels.create({
        name:CATEGORY_NAME,
        type:ChannelType.GuildCategory,
        permissionOverwrites:[
          {
            id:everyone.id,
            deny:[PermissionFlagsBits.ViewChannel],
          },
          ...(botId?[{
            id:botId,
            allow:[
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages,
            ],
          }]:[]),
        ],
        reason:'Meeting 967 — إنشاء مساحة AI 967',
      });
    }else{
      await category.permissionOverwrites.edit(everyone,{ViewChannel:false}).catch(()=>{});
      if(botId){
        await category.permissionOverwrites.edit(botId,{
          ViewChannel:true,
          SendMessages:true,
          ReadMessageHistory:true,
          ManageChannels:true,
          ManageMessages:true,
        }).catch(()=>{});
      }
    }

    return category;
  }

  async findRoom(guild,userId){
    const channels=await this._fetchAllChannels(guild);
    return channels.find(c=>
      c?.type===ChannelType.GuildText &&
      this._userIdFromTopic(c.topic)===String(userId)
    )??null;
  }

  async openRoom(subject){
    const guild=subject.guild;
    const userId=String(subject.userId);
    this.botUserId=String(guild.members.me?.id??guild.client?.user?.id??this.botUserId??'');

    let room=await this.findRoom(guild,userId);
    const category=await this._ensureCategory(guild);

    if(room){
      if(room.archived)await room.setArchived(false).catch(()=>{});
      if(room.locked)await room.setLocked(false).catch(()=>{});

      await room.setParent(category.id,{lockPermissions:false}).catch(()=>{});

      const member=subject.member??await guild.members.fetch(userId).catch(()=>null);
      if(member){
        await room.permissionOverwrites.edit(member,{
          ViewChannel:true,
          SendMessages:true,
          ReadMessageHistory:true,
          EmbedLinks:true,
          AttachFiles:true,
        }).catch(()=>{});
      }

      if(!room.permissionsFor(member??guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)){
        await room.permissionOverwrites.edit(userId,{
          ViewChannel:true,
          SendMessages:true,
          ReadMessageHistory:true,
          EmbedLinks:true,
          AttachFiles:true,
        }).catch(()=>{});
      }

      return room;
    }

    const everyone=guild.roles.everyone;
    const member=subject.member??await guild.members.fetch(userId).catch(()=>null);

    const base=cleanName(member?.displayName??subject.userId);
    const name=`ai-967-${base}-${userId.slice(-6)}`.slice(0,95);

    const overwrites=[
      {
        id:everyone.id,
        deny:[
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id:userId,
        allow:[
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
        ],
      },
    ];

    if(this.botUserId){
      overwrites.push({
        id:this.botUserId,
        allow:[
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageMessages,
        ],
      });
    }

    room=await guild.channels.create({
      name,
      type:ChannelType.GuildText,
      parent:category.id,
      topic:this._topic(userId),
      permissionOverwrites:overwrites,
      reason:`Meeting 967 — AI private room for ${userId}`,
    });

    const welcome=[
      '## 🤖 AI 967',
      '',
      `مرحبًا ${member??`<@${userId}>`} 👋`,
      '',
      'هذه محادثتك الخاصة مع AI 967',
      'اكتب رسالتك هنا بشكل طبيعي مثل أي دردشة',
      '',
      'يستطيع AI 967 مساعدتك في:',
      '• معلومات النظام والفرق والاجتماعات',
      '• مهامك وسياق عضويتك',
      '• تنفيذ بعض العمليات بعد التحقق من الصلاحيات والتأكيد',
      '',
      '🔐 هذه المساحة مخصصة لك وللبوت',
    ].join('\n');

    await room.send({
      content:welcome,
      components:this._buttons(),
    });

    return room;
  }

  async openFromInteraction(i,subject){
    const room=await this.openRoom(subject);
    const payload={
      content:`🤖 **AI 967 جاهز**\nتم فتح دردشتك الخاصة: ${room.toString()}\n\nاضغط على اسم الدردشة للدخول والكتابة بشكل طبيعي.`,
      components:[],
      embeds:[],
    };

    if(i.deferred||i.replied)return i.editReply(payload);
    return i.reply({...payload,ephemeral:Boolean(i.guildId)});
  }

  async hydrate(subject,channel){
    if(this.aiAgentService.history(subject).length)return;

    const messages=await channel.messages.fetch({limit:20}).catch(()=>null);
    if(!messages)return;

    const ordered=[...messages.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
    const botId=String(this.botUserId??channel.guild.members.me?.id??'');

    for(const m of ordered){
      if(!m.content?.trim())continue;
      if(String(m.author.id)===String(subject.userId)){
        this.aiAgentService.push(subject,'user',m.content);
      }else if(String(m.author.id)===botId){
        if(m.content.startsWith('## 🤖 AI 967'))continue;
        if(m.content.includes('اضغط على اسم الدردشة للدخول'))continue;
        this.aiAgentService.push(subject,'assistant',m.content.slice(0,4000));
      }
    }
  }

  async handleMessage(message){
    if(!message?.guild||message.author?.bot)return false;
    if(message.channel?.type!==ChannelType.GuildText)return false;

    const ownerId=this._userIdFromTopic(message.channel.topic);
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
      await this.hydrate(subject,message.channel);
      await message.channel.sendTyping();

      const result=await this.aiAgentService.respond(subject,text);

      if(result?.kind==='confirmation'){
        await message.channel.send({
          content:`🤖 **AI 967**\n${result.text}\n\n**هل تريد تنفيذ العملية؟**`,
          components:this._confirmButtons(result.token),
        });
      }else{
        await message.channel.send({
          content:`🤖 **AI 967**\n${String(result?.text??'لم أحصل على إجابة واضحة.')}`,
          components:[],
        });
      }
    }catch(error){
      this.logger?.error?.('ai-chat-message-failed',{
        guildId:message.guild.id,
        userId:ownerId,
        channelId:message.channel.id,
        error:error?.stack??String(error),
      });
      await message.channel.send('⚠️ حصل خطأ أثناء معالجة رسالتك. حاول مرة ثانية.').catch(()=>{});
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
      '## 📋 سياقي الحالي',
      '',
      `**الفرق:** ${teams}`,
      `**المهام المفتوحة:** ${tasks}`,
      `**الاجتماعات القادمة:** ${meetings}`,
      `**النقاط:** ${Number(ctx.points??0)}`,
      `**حالة العضوية:** ${ctx.membership?.status??'غير محددة'}`,
    ].join('\n');
  }

  async hideRoom(subject){
    const room=await this.findRoom(subject.guild,subject.userId);
    if(!room)return null;
    await room.permissionOverwrites.edit(subject.userId,{ViewChannel:false}).catch(()=>{});
    return room;
  }
}
JS

say "🔧 استبدال واجهة AI بالمساحة الحقيقية..."

cat > src/interfaces/discord/commands/ai.js <<'JS'
import {EmbedBuilder} from 'discord.js';
import {AppError} from '../../../core/errors/AppError.js';
import {subjectFromInteraction} from '../context.js';

async function getSubject(i,a){
  const s=await subjectFromInteraction(i,a.env);
  if(!s?.member)throw new AppError('AI_MEMBER_ONLY','مساعد AI 967 متاح لأعضاء السيرفر فقط.');
  if(!a.aiAgentService)throw new AppError('AI_AGENT_MISSING','خدمة AI Agent غير مفعّلة.');
  if(!a.aiChatRoomService)throw new AppError('AI_CHAT_MISSING','خدمة دردشة AI 967 غير مفعّلة.');
  return s;
}

export async function aiCommand(i,a){
  const s=await getSubject(i,a);
  const room=await a.aiChatRoomService.openRoom(s);

  const question=i.options.getString('question')?.trim();

  const payload={
    content:`🤖 **AI 967**\nدردشتك الخاصة جاهزة: ${room.toString()}`,
    embeds:[],
    components:[],
  };

  if(i.deferred||i.replied)await i.editReply(payload);
  else await i.reply({...payload,ephemeral:Boolean(i.guildId)});

  if(question){
    await a.aiChatRoomService.handleMessage({
      guild:i.guild,
      channel:room,
      author:i.user,
      member:i.member,
      content:question,
    });
  }
}

export async function handleAIInteraction(i,a,s,id){
  const subject=s??await getSubject(i,a);
  const roomService=a.aiChatRoomService;

  if(id==='ai:open'||id==='ai:ask'||id==='ai:message'){
    return roomService.openFromInteraction(i,subject);
  }

  if(id==='ai:room:new'){
    await roomService.reset(subject);
    if(i.deferred||i.replied){
      return i.editReply({
        content:'🆕 تم بدء محادثة جديدة في AI 967',
        embeds:[],
        components:[],
      });
    }
    return i.reply({content:'🆕 تم بدء محادثة جديدة في AI 967',ephemeral:Boolean(i.guildId)});
  }

  if(id==='ai:room:context'){
    const text=await roomService.contextText(subject);
    if(i.deferred||i.replied){
      return i.editReply({content:text,embeds:[],components:[]});
    }
    return i.reply({content:text,ephemeral:Boolean(i.guildId)});
  }

  if(id==='ai:room:hide'){
    await roomService.hideRoom(subject);
    if(i.deferred||i.replied){
      return i.editReply({content:'🔒 تم إخفاء دردشة AI 967. يمكنك فتحها من لوحة التحكم مرة أخرى.',embeds:[],components:[]});
    }
    return i.reply({content:'🔒 تم إخفاء دردشة AI 967. يمكنك فتحها من لوحة التحكم مرة أخرى.',ephemeral:Boolean(i.guildId)});
  }

  if(id.startsWith('ai:confirm:')){
    const token=id.slice('ai:confirm:'.length);
    const result=await a.aiAgentService.confirm(subject,token);
    const text=`✅ **تم التنفيذ**\n${result.summary}`;
    return i.update({
      content:`🤖 **AI 967**\n${text}`,
      embeds:[],
      components:[],
    });
  }

  if(id.startsWith('ai:reject:')){
    const token=id.slice('ai:reject:'.length);
    const pending=a.aiAgentService.getPending(subject,token);
    if(pending)a.aiAgentService.pending.delete(`${subject.guildId}:${subject.userId}:${token}`);
    return i.update({
      content:'✖️ **تم إلغاء العملية**\nلم يتم تغيير أي بيانات.',
      embeds:[],
      components:[],
    });
  }

  return false;
}
JS

say "🔗 ربط خدمة غرف AI بالتطبيق..."

node --input-type=module <<'NODE'
import fs from 'node:fs';

function write(p,s){fs.writeFileSync(p,s);}

// app.js
{
  const p='src/app.js';
  let s=fs.readFileSync(p,'utf8');

  if(!s.includes("AIChatRoomService")){
    const anchors=[
      "import { AIAgentService } from './application/services/AIAgentService.js';",
      "import { AIAssistantService } from './application/services/AIAssistantService.js';"
    ];
    const anchor=anchors.find(x=>s.includes(x));
    if(!anchor)throw new Error('app.js: لم أجد خدمة AI الحالية.');
    s=s.replace(anchor,anchor+"\nimport { AIChatRoomService } from './application/services/AIChatRoomService.js';");
  }

  if(!s.includes('const aiChatRoomService=')){
    const anchor=/const aiAgentService=new AIAgentService\\([^\\n]+\\);/;
    if(anchor.test(s)){
      s=s.replace(anchor,m=>m+"\n  const aiChatRoomService=new AIChatRoomService({env,logger,aiAgentService});");
    }else{
      const anchor2=/const aiAssistantService=new AIAssistantService\\([^\\n]+\\);/;
      if(anchor2.test(s)){
        s=s.replace(anchor2,m=>m+"\n  const aiChatRoomService=new AIChatRoomService({env,logger,aiAgentService:aiAssistantService});");
      }else{
        throw new Error('app.js: لم أجد إنشاء aiAgentService/aiAssistantService.');
      }
    }
  }

  if(!s.includes('aiChatRoomService,')){
    const aiMarker='aiAgentService,';
    if(s.includes(aiMarker)){
      s=s.replace(aiMarker,aiMarker+"\n    aiChatRoomService,");
    }else{
      const aiMarker2='aiAssistantService,';
      if(!s.includes(aiMarker2))throw new Error('app.js: لم أجد ai service في return.');
      s=s.replace(aiMarker2,aiMarker2+"\n    aiChatRoomService,");
    }
  }

  write(p,s);
}

// index.js — normal Discord messages in AI rooms become AI prompts.
{
  const p='src/index.js';
  let s=fs.readFileSync(p,'utf8');

  if(!s.includes('aiChatRoomService?.handleMessage')){
    const anchor="client.on('interactionCreate',i=>routeInteraction(i,app));";
    if(!s.includes(anchor))throw new Error('index.js: لم أجد interactionCreate.');
    const block=`client.on('messageCreate',message=>{\\n  app.aiChatRoomService?.handleMessage(message).catch(error=>app.logger.error('ai-chat-message-event-failed',{error:error?.stack??String(error),channelId:message?.channelId,userId:message?.author?.id}));\\n});\\n`;
    s=s.replace(anchor,anchor+"\n"+block);
  }

  write(p,s);
}

// misc.js — legacy route compatibility.
{
  const p='src/interfaces/discord/interactions/misc.js';
  let s=fs.readFileSync(p,'utf8');

  if(!s.includes("import {handleAIInteraction} from '../commands/ai.js';")){
    const anchor="import {refreshPanel,personalGuide,panelHub,panelSection} from '../commands/panel.js';";
    if(!s.includes(anchor))throw new Error('misc.js: لم أجد panel import.');
    s=s.replace(anchor,anchor+"\nimport {handleAIInteraction} from '../commands/ai.js';");
  }

  const route="  if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);";
  s=s.replace(/^\s*if\(id\.startsWith\(['"]ai:['"]\)\)return handleAIInteraction\(i,a,s,id\);\s*$/gm,'');

  const start="export async function handleMisc(i,a){const id=i.customId??'';const s=await subjectFromInteraction(i,a.env);";
  if(!s.includes(start))throw new Error('misc.js: handleMisc غير موجود.');
  s=s.replace(start,start+"\n"+route);

  write(p,s);
}

// componentDispatcher.js — direct AI route before generic handlers.
{
  const p='src/interfaces/discord/componentDispatcher.js';
  let s=fs.readFileSync(p,'utf8');

  if(!s.includes("import {handleAIInteraction} from './commands/ai.js';")){
    const anchor="import {handlerForCustomId} from './interactionReliability.js';";
    if(!s.includes(anchor))throw new Error('componentDispatcher.js: handlerForCustomId import غير موجود.');
    s=s.replace(anchor,anchor+"\nimport {handleAIInteraction} from './commands/ai.js';");
  }

  const route="  if(String(interaction.customId??'').startsWith('ai:')){\\n    const subject=await import('./context.js').then(m=>m.subjectFromInteraction(interaction,app.env));\\n    return handleAIInteraction(interaction,app,subject,String(interaction.customId??''));\\n  }\\n";
  if(!s.includes("startsWith('ai:')") || !s.includes('handleAIInteraction(interaction,app,subject')){
    const anchor="export async function dispatchComponentInteraction(interaction,app){\n";
    if(!s.includes(anchor))throw new Error('componentDispatcher.js: dispatch غير موجود.');
    s=s.replace(anchor,anchor+route);
  }

  write(p,s);
}
NODE

say "🧪 فحص syntax..."
node --check src/application/services/AIChatRoomService.js
node --check src/interfaces/discord/commands/ai.js
node --check src/interfaces/discord/interactions/misc.js
node --check src/interfaces/discord/componentDispatcher.js
node --check src/app.js
node --check src/index.js

say "🧪 اختبارات الربط..."
cat > "tests/ai-chat-room-v${VERSION}.test.js" <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');

test('AI chat room service exists',()=>{
  const s=read('src/application/services/AIChatRoomService.js');
  assert.match(s,/class AIChatRoomService/);
  assert.match(s,/ChannelType\.GuildText/);
  assert.match(s,/AI967_ROOM\|/);
  assert.match(s,/PermissionFlagsBits\.ViewChannel/);
});

test('AI listens to normal Discord messages',()=>{
  const s=read('src/index.js');
  assert.match(s,/messageCreate/);
  assert.match(s,/aiChatRoomService\?\.handleMessage/);
});

test('AI command opens a real room, not a modal',()=>{
  const s=read('src/interfaces/discord/commands/ai.js');
  assert.match(s,/openRoom/);
  assert.match(s,/openFromInteraction/);
  assert.doesNotMatch(s,/new ModalBuilder/);
});

test('AI component routing reaches the chat handler',()=>{
  const s=read('src/interfaces/discord/componentDispatcher.js');
  assert.match(s,/startsWith\('ai:'\)/);
  assert.match(s,/handleAIInteraction/);
});

test('AI room supports normal typing and action confirmation',()=>{
  const s=read('src/application/services/AIChatRoomService.js');
  assert.match(s,/message\.content/);
  assert.match(s,/ai:confirm:/);
  assert.match(s,/ai:reject:/);
  assert.match(s,/sendTyping/);
});
JS

node --test "tests/ai-chat-room-v${VERSION}.test.js"

say ""
say "✅ AI Chat Room v${VERSION} تم تثبيته وفحصه بنجاح."
say "🛟 Backup: $BACKUP"
say ""
say "الاستخدام:"
say "  /panel → AI 967"
say "  أو /ai"
say ""
say "المفترض الآن:"
say "  1) يفتح لك روم AI 967 خاص بك"
say "  2) تدخل الروم"
say "  3) يظهر لك مربع الكتابة العادي الخاص بالروم"
say "  4) تكتب مباشرة بدون Modal"
say "  5) AI يرد داخل نفس الدردشة"
say "  6) أي عملية تنفيذية حساسة تطلب تأكيد داخل الدردشة"
