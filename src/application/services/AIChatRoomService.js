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

const WELCOME_MESSAGE="## 🤖 AI 967\n\nمرحبًا بك في AI 967\n\nمساعدك الذكي المخصص لكل ما يتعلق بـ Meeting 967.\n\nيمكنك استخدام AI 967 للاستفسار عن البوت، وفهم طريقة استخدامه، ومعرفة مهامك وصلاحياتك، ومتابعة الاجتماعات والعضوية، والحصول على المساعدة عند مواجهة أي مشكلة.\n\n💡 كيف تستخدمه؟\n\nاستخدم الأمر:\n\n\"/ai\"\n\nثم اكتب سؤالك بشكل مباشر وواضح، وسيقوم AI 967 بتحليل سؤالك والإجابة بناءً على معلومات النظام والصلاحيات والبيانات المتاحة لك.\n\n🔎 يمكنك السؤال عن أمور البوت مثل:\n\nكيف أكلف شخصًا بمهمة؟\n\nكيف أعدل موعد اجتماع؟\n\nما هي صلاحياتي؟\n\nما هي مهامي الحالية؟\n\nكيف أستخدم إحدى ميزات البوت؟\n\nواجهت مشكلة في البوت، كيف أحلها؟\n\nما هي تفاصيل مهمة معينة؟\n\nوأي استفسار آخر يتعلق بـ Meeting 967.\n\n🤖 AI 967\n\nمساعد ذكي يساعدك على فهم النظام، والوصول إلى المعلومات، وإنجاز مهامك بسهولة أكبر.";

export class AIChatRoomService{
  constructor({env,logger,aiAgentService}){
    Object.assign(this,{env,logger,aiAgentService});
    this.botUserId=null;
    this.active=new Set();
    this._welcomeLocks=new Set();
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

        // AI 967 welcome is strictly idempotent:
    // clean known legacy messages once, then keep the current welcome untouched.
    const botId=this.botId(guild);
    const recent=await channel.messages.fetch({limit:50}).catch(()=>null);
    const botMessages=[...(recent?.values?.()??[])].filter(message=>
      String(message.author?.id)===String(botId)
    );

    const legacyMarkers=[
      'هذه هي المساحة العامة الموحدة للمساعد الذكي داخل Meeting 967',
      'هذه المساحة مخصصة لمساعدتك في كل ما يتعلق بـ Meeting 967',
      'هذه القناة هي مساحة AI 967 العامة',
      'هذه القناة هي بوابة AI 967',
      '🔎 عند السؤال عن كيفية عمل ميزة في البوت يمكن لـAI الرجوع إلى الكود الحالي'
    ];

    for(const message of botMessages){
      const content=String(message.content??'');
      if(legacyMarkers.some(marker=>content.includes(marker))){
        await message.delete('Meeting 967 — إزالة رسالة AI 967 القديمة').catch(error=>{
          this.logger?.warn?.('ai-welcome-delete-failed',{
            channelId:channel.id,
            messageId:message.id,
            error:error?.message??String(error),
          });
        });
      }
    }

    const currentWelcome=botMessages.find(message=>
      String(message.content??'')===WELCOME_MESSAGE
    );

    if(!currentWelcome){
      await channel.send({content:WELCOME_MESSAGE});
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
