// operations967-special-channel-access-v1.10.13.1
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AppError } from '../../core/errors/AppError.js';

const PREFIX='owner:access';
const PAGE_SIZE=20;
const GOLD=0xA8832F;
const MEMBER_CACHE_TTL=60_000;
const CHANNEL_CACHE_TTL=30_000;
const memberCache=new Map();
const channelCache=new Map();

const clip=(value,max=100)=>{const s=String(value??'');return s.length>max?s.slice(0,max-1)+'…':s;};
const pageNum=(value)=>Math.max(0,Number.parseInt(String(value??'0'),10)||0);
const mention=(id)=>`<@${String(id)}>`;

function embed(title,description){
  return new EmbedBuilder().setColor(GOLD).setTitle(clip(title,256)).setDescription(clip(description||'—',4000));
}
function button(id,label,style=ButtonStyle.Secondary,emoji=null,disabled=false){
  const b=new ButtonBuilder().setCustomId(id).setLabel(clip(label,80)).setStyle(style).setDisabled(Boolean(disabled));
  if(emoji)b.setEmoji(emoji);
  return b;
}
function buttonRows(buttons){
  const out=[];
  for(let i=0;i<buttons.length;i+=5)out.push(new ActionRowBuilder().addComponents(buttons.slice(i,i+5)));
  return out;
}
function selectRow(id,placeholder,options,{min=1,max=1}={}){
  const menu=new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(clip(placeholder,150)).setMinValues(min).setMaxValues(Math.max(min,Math.min(max,options.length)));
  menu.addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

async function ensureOwner(interaction,app){
  if(String(interaction.user?.id)===String(app.env.OWNER_USER_ID))return true;
  throw new AppError('FORBIDDEN','إدارة الوصول الخاص متاحة لمالك النظام فقط.');
}
async function guildFor(interaction,app){
  return interaction.guild ?? interaction.client.guilds.cache.get(String(app.env.GUILD_ID)) ?? await interaction.client.guilds.fetch(String(app.env.GUILD_ID));
}

function memberName(member){
  return String(member?.displayName??member?.user?.globalName??member?.user?.username??member?.id??'عضو');
}
function channelTypeEmoji(channel){
  if(channel.type===ChannelType.GuildVoice)return '🔊';
  if(channel.type===ChannelType.GuildStageVoice)return '🎙️';
  if(channel.type===ChannelType.GuildAnnouncement)return '📢';
  if(channel.type===ChannelType.GuildForum)return '🧵';
  if(ChannelType.GuildMedia!==undefined&&channel.type===ChannelType.GuildMedia)return '🖼️';
  return '#️⃣';
}
function isManagedPlace(channel){
  if(!channel||channel.isDMBased?.()||channel.isThread?.())return false;
  if(channel.type===ChannelType.GuildCategory)return false;
  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildMedia,
  ].filter(v=>v!==undefined).includes(channel.type) && Boolean(channel.permissionOverwrites);
}
function placeName(channel){
  const parent=channel.parent?.name?`${channel.parent.name} / `:'';
  return `${parent}${channel.name??channel.id}`;
}
function managedPermissionsFor(channel){
  if(channel.type===ChannelType.GuildVoice){
    return {ViewChannel:true,Connect:true,Speak:true};
  }
  if(channel.type===ChannelType.GuildStageVoice){
    return {ViewChannel:true,Connect:true};
  }
  return {ViewChannel:true,ReadMessageHistory:true};
}
function previousOverwriteFor(channel,userId,managed){
  const overwrite=channel.permissionOverwrites.cache.get(String(userId));
  const previous={};
  for(const name of Object.keys(managed)){
    const flag=PermissionFlagsBits[name];
    if(overwrite?.allow?.has(flag))previous[name]=true;
    else if(overwrite?.deny?.has(flag))previous[name]=false;
    else previous[name]=null;
  }
  return previous;
}
function restorePayload(previous,managed){
  const out={};
  for(const name of Object.keys(managed??{}))out[name]=Object.prototype.hasOwnProperty.call(previous??{},name)?previous[name]:null;
  return out;
}

async function humanMembers(guild,{fresh=false}={}){
  const key=String(guild.id),now=Date.now(),cached=memberCache.get(key);
  if(!fresh&&cached&&now-cached.at<MEMBER_CACHE_TTL)return cached.items;
  await guild.members.fetch().catch(()=>null);
  const items=[...guild.members.cache.values()]
    .filter(m=>m?.user&&!m.user.bot)
    .sort((a,b)=>memberName(a).localeCompare(memberName(b),'ar'));
  memberCache.set(key,{at:now,items});
  return items;
}
async function managedPlaces(guild,{fresh=false}={}){
  const key=String(guild.id),now=Date.now(),cached=channelCache.get(key);
  if(!fresh&&cached&&now-cached.at<CHANNEL_CACHE_TTL)return cached.items;
  await guild.channels.fetch().catch(()=>null);
  const items=[...guild.channels.cache.values()]
    .filter(isManagedPlace)
    .sort((a,b)=>{
      const pa=String(a.parent?.name??''),pb=String(b.parent?.name??'');
      const p=pa.localeCompare(pb,'ar');
      return p||String(a.position??0).localeCompare(String(b.position??0))||String(a.name??'').localeCompare(String(b.name??''),'ar');
    });
  channelCache.set(key,{at:now,items});
  return items;
}
function paginate(items,page){
  const pages=Math.max(1,Math.ceil(items.length/PAGE_SIZE));
  const safe=Math.max(0,Math.min(pageNum(page),pages-1));
  const start=safe*PAGE_SIZE;
  return {page:safe,pages,start,items:items.slice(start,start+PAGE_SIZE),total:items.length};
}

async function dbRowsForMember(app,userId){
  const {rows}=await app.db.query(`SELECT guild_id,user_id,channel_id,previous_overwrite,managed_permissions,granted_by,created_at,updated_at
    FROM special_channel_access WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at ASC`,[app.env.GUILD_ID,userId]);
  return rows;
}
async function dbRowsForChannel(app,channelId){
  const {rows}=await app.db.query(`SELECT guild_id,user_id,channel_id,previous_overwrite,managed_permissions,granted_by,created_at,updated_at
    FROM special_channel_access WHERE guild_id=$1 AND channel_id=$2 ORDER BY created_at ASC`,[app.env.GUILD_ID,channelId]);
  return rows;
}
async function trackedRow(app,userId,channelId){
  const {rows}=await app.db.query(`SELECT * FROM special_channel_access WHERE guild_id=$1 AND user_id=$2 AND channel_id=$3 LIMIT 1`,[app.env.GUILD_ID,userId,channelId]);
  return rows[0]??null;
}

async function audit(app,actorId,action,userId,channel,extra={}){
  await app.audit?.log?.({
    guildId:String(app.env.GUILD_ID),actorId:String(actorId),action,targetType:'discord_channel',targetId:String(channel?.id??extra.channelId??''),
    newValue:{userId:String(userId),channelName:channel?placeName(channel):null,...extra},
  }).catch(()=>{});
}


// special-access-member-notification-v1.10.15
function specialAccessKindLabel(channel){
  if(channel?.type===ChannelType.GuildVoice)return 'قناة صوتية';
  if(channel?.type===ChannelType.GuildStageVoice)return 'منصة صوتية';
  if(channel?.type===ChannelType.GuildAnnouncement)return 'قناة إعلانات';
  if(channel?.type===ChannelType.GuildForum)return 'منتدى';
  if(ChannelType.GuildMedia!==undefined&&channel?.type===ChannelType.GuildMedia)return 'قناة وسائط';
  return 'قناة نصية';
}
function specialAccessJumpUrl(guildId,channelId){
  return 'https://discord.com/channels/'+String(guildId)+'/'+String(channelId);
}
async function specialAccessMemberDmAllowed(app,guildId){
  try{
    const {rows}=await app.db.query('SELECT delivery_mode,member_delivery_enabled FROM member_delivery_control WHERE guild_id=$1 LIMIT 1',[String(guildId)]);
    const row=rows?.[0];
    if(!row)return true;
    const mode=String(row.delivery_mode??'').toLowerCase();
    if(mode==='off')return false;
    if(!mode&&row.member_delivery_enabled===false)return false;
    return true;
  }catch(error){
    if(['42P01','42703'].includes(String(error?.code??'')))return true;
    app.logger?.warn?.('special-access-notification-delivery-mode-check-failed',{guildId:String(guildId),error:error?.message??String(error)});
    return true;
  }
}
function specialAccessJumpRows(guild,channels){
  const buttons=channels.slice(0,25).map(channel=>{
    const b=new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(clip('فتح '+String(channel.name??'المكان'),80))
      .setURL(specialAccessJumpUrl(guild.id,channel.id));
    const emoji=channelTypeEmoji(channel);
    if(emoji)b.setEmoji(emoji);
    return b;
  });
  return buttonRows(buttons);
}
async function notifySpecialAccessGranted(app,guild,userId,channels){
  const unique=[];
  const seen=new Set();
  for(const channel of channels??[]){
    if(!channel?.id||seen.has(String(channel.id)))continue;
    seen.add(String(channel.id));
    unique.push(channel);
  }
  if(!unique.length)return {status:'nothing'};
  if(!await specialAccessMemberDmAllowed(app,guild.id)){
    app.logger?.info?.('special-access-notification-suppressed',{guildId:String(guild.id),userId:String(userId),channels:unique.map(x=>String(x.id)),reason:'member-delivery-off'});
    return {status:'suppressed'};
  }
  const member=guild.members.cache.get(String(userId))??await guild.members.fetch(String(userId)).catch(()=>null);
  if(!member||member.user?.bot)return {status:'member_missing'};
  const displayName=memberName(member);
  const lines=unique.map(channel=>'• '+channelTypeEmoji(channel)+' <#'+channel.id+'> — **'+specialAccessKindLabel(channel)+'**');
  const description=[
    'مرحبًا **'+clip(displayName,80)+'** 👋',
    '',
    unique.length===1?'تم منحك **وصولًا خاصًا جديدًا** إلى المكان التالي:':'تم منحك **وصولًا خاصًا جديدًا** إلى **'+unique.length+' أماكن**:',
    '',
    ...lines,
    '',
    'يمكنك الانتقال مباشرة باستخدام الزر'+(unique.length===1?' أدناه.':' أو الأزرار أدناه.'),
    '',
    '_هذا الوصول مستقل عن عضوية الفرق ولا يغيّر رتبك في السيرفر._',
  ].join('\n');
  const payload={embeds:[embed('🔐 وصول جديد — Operations 967',description)],components:specialAccessJumpRows(guild,unique)};
  try{
    await member.send(payload);
    app.logger?.info?.('special-access-notification-sent',{guildId:String(guild.id),userId:String(userId),channels:unique.map(x=>String(x.id))});
    return {status:'sent'};
  }catch(error){
    app.logger?.warn?.('special-access-notification-failed',{guildId:String(guild.id),userId:String(userId),channels:unique.map(x=>String(x.id)),error:error?.message??String(error)});
    return {status:'failed',error};
  }
}


// special-access-existing-notification-v1.10.15.1
async function notifyExistingSpecialAccess(app,guild,userId,channels){
  const unique=[];
  const seen=new Set();
  for(const channel of channels??[]){
    if(!channel?.id||seen.has(String(channel.id)))continue;
    seen.add(String(channel.id));
    unique.push(channel);
  }
  if(!unique.length)return {status:'nothing',places:0,messages:0};
  if(!await specialAccessMemberDmAllowed(app,guild.id)){
    app.logger?.info?.('special-access-existing-notification-suppressed',{guildId:String(guild.id),userId:String(userId),channels:unique.map(x=>String(x.id)),reason:'member-delivery-off'});
    return {status:'suppressed',places:unique.length,messages:0};
  }
  const member=guild.members.cache.get(String(userId))??await guild.members.fetch(String(userId)).catch(()=>null);
  if(!member||member.user?.bot)return {status:'member_missing',places:unique.length,messages:0};
  const displayName=memberName(member);
  let messages=0;
  try{
    for(let offset=0;offset<unique.length;offset+=25){
      const chunk=unique.slice(offset,offset+25);
      const page=Math.floor(offset/25)+1;
      const pages=Math.ceil(unique.length/25);
      const lines=chunk.map(channel=>'• '+channelTypeEmoji(channel)+' <#'+channel.id+'> — **'+specialAccessKindLabel(channel)+'**');
      const description=[
        'مرحبًا **'+clip(displayName,80)+'** 👋',
        '',
        unique.length===1?'تمت إضافتك سابقًا إلى المكان التالي ضمن **الوصول الخاص** في Operations 967:':'تمت إضافتك سابقًا إلى الأماكن التالية ضمن **الوصول الخاص** في Operations 967:',
        '',
        ...lines,
        pages>1?'':'',
        pages>1?'**الجزء '+page+' من '+pages+'**':'',
        '',
        'يمكنك الانتقال مباشرة باستخدام '+(chunk.length===1?'الزر أدناه.':'الأزرار أدناه.'),
        '',
        '_هذا الوصول مستقل عن عضوية الفرق ولا يغيّر رتبك في السيرفر._',
      ].filter(Boolean).join('\n');
      await member.send({embeds:[embed('📨 إشعار وصول حالي — Operations 967',description)],components:specialAccessJumpRows(guild,chunk)});
      messages++;
    }
    app.logger?.info?.('special-access-existing-notification-sent',{guildId:String(guild.id),userId:String(userId),channels:unique.map(x=>String(x.id)),messages});
    return {status:'sent',places:unique.length,messages};
  }catch(error){
    app.logger?.warn?.('special-access-existing-notification-failed',{guildId:String(guild.id),userId:String(userId),channels:unique.map(x=>String(x.id)),messages,error:error?.message??String(error)});
    return {status:'failed',places:unique.length,messages,error};
  }
}

async function currentAccessNotificationConfirm(interaction,app,userId=null){
  const guild=await guildFor(interaction,app);
  const params=[String(app.env.GUILD_ID)];
  let where='guild_id=$1';
  if(userId){params.push(String(userId));where+=' AND user_id=$2';}
  const {rows}=await app.db.query('SELECT COUNT(*)::int AS grants,COUNT(DISTINCT user_id)::int AS users FROM special_channel_access WHERE '+where,params);
  const x=rows?.[0]??{};
  const grants=Number(x.grants??0);
  const users=Number(x.users??0);
  let target='كل أصحاب الوصول الخاص الحالي';
  if(userId){
    const member=guild.members.cache.get(String(userId))??await guild.members.fetch(String(userId)).catch(()=>null);
    target=member?memberName(member):'العضو '+String(userId);
  }
  const desc=[
    '**المستهدف:** '+clip(target,180),
    '**عدد الأعضاء:** '+users,
    '**عدد الوصولات:** '+grants,
    '',
    grants?'سيتم إرسال إشعار بالوصولات **الموجودة حاليًا** فقط. لن يعاد منح أي صلاحية ولن تتغير الرتب أو الفرق.':'لا توجد وصولات حالية لإرسال إشعار عنها.',
    '',
    'إذا كان عضو أغلق الرسائل الخاصة، سيتم تجاوزه وتظهر النتيجة لك فقط.',
    '',
    '**مهم:** يمكنك إعادة الإرسال لاحقًا يدويًا، لذلك استخدم التأكيد عند الحاجة فقط.',
  ].join('\n');
  const confirmId=userId?PREFIX+':notify-member-confirm:'+String(userId):PREFIX+':notify-current-confirm';
  const cancelId=userId?PREFIX+':member-view:'+String(userId):PREFIX;
  return interaction.update({embeds:[embed('📨 تأكيد إشعار الوصولات الحالية',desc)],components:buttonRows([
    button(confirmId,'تأكيد الإرسال',ButtonStyle.Success,'📨',grants===0),
    button(cancelId,'إلغاء',ButtonStyle.Secondary,'↩️'),
  ])});
}

async function currentAccessNotificationSend(interaction,app,userId=null){
  const guild=await guildFor(interaction,app);
  const params=[String(app.env.GUILD_ID)];
  let where='guild_id=$1';
  if(userId){params.push(String(userId));where+=' AND user_id=$2';}
  const {rows}=await app.db.query('SELECT user_id,channel_id FROM special_channel_access WHERE '+where+' ORDER BY user_id,channel_id',params);
  const grouped=new Map();
  for(const row of rows??[]){
    const uid=String(row.user_id);
    if(!grouped.has(uid))grouped.set(uid,[]);
    grouped.get(uid).push(String(row.channel_id));
  }
  let sent=0,failed=0,suppressed=0,missing=0,places=0,messages=0;
  for(const [uid,channelIds] of grouped){
    const channels=[];
    for(const channelId of channelIds){
      const channel=guild.channels.cache.get(String(channelId))??await guild.channels.fetch(String(channelId)).catch(()=>null);
      if(channel)channels.push(channel);
    }
    if(!channels.length){missing++;continue;}
    const result=await notifyExistingSpecialAccess(app,guild,uid,channels);
    places+=Number(result.places??0);
    messages+=Number(result.messages??0);
    if(result.status==='sent')sent++;
    else if(result.status==='suppressed')suppressed++;
    else if(result.status==='member_missing')missing++;
    else if(result.status==='failed')failed++;
  }
  await app.audit?.log?.({
    guildId:String(app.env.GUILD_ID),actorId:String(interaction.user.id),action:'access.special.notify_existing',targetType:userId?'user':'guild',targetId:userId?String(userId):String(app.env.GUILD_ID),
    newValue:{users:grouped.size,sent,failed,suppressed,missing,places,messages},
  }).catch(()=>{});
  const lines=[
    '✅ **اكتمل إرسال إشعارات الوصولات الحالية.**',
    '📨 وصل الإشعار إلى: **'+sent+' عضو**',
    '📍 الأماكن المشمولة: **'+places+'**',
  ];
  if(messages>sent)lines.push('✉️ رسائل Discord المرسلة: **'+messages+'**');
  if(failed)lines.push('⚠️ تعذر إرسال الخاص إلى: **'+failed+' عضو**');
  if(missing)lines.push('⚠️ أعضاء/قنوات غير متاحة حاليًا: **'+missing+'**');
  if(suppressed)lines.push('🔕 تم منع الإرسال بسبب وضع OFF لـ: **'+suppressed+' عضو**');
  await interaction.followUp?.({content:lines.join('\n'),ephemeral:Boolean(interaction.guildId)}).catch(()=>{});
  if(userId)return memberView(interaction,app,userId);
  return home(interaction,app);
}

async function grantOne(app,guild,actorId,userId,channelId){
  const member=guild.members.cache.get(String(userId))??await guild.members.fetch(String(userId)).catch(()=>null);
  if(!member||member.user?.bot)throw new AppError('ACCESS_MEMBER_NOT_FOUND',`العضو ${userId} غير موجود حاليًا في السيرفر.`);
  const channel=guild.channels.cache.get(String(channelId))??await guild.channels.fetch(String(channelId)).catch(()=>null);
  if(!isManagedPlace(channel))throw new AppError('ACCESS_CHANNEL_NOT_FOUND',`القناة ${channelId} غير متاحة لإدارة الوصول الخاص.`);
  const existing=await trackedRow(app,userId,channelId);
  const managed=existing?.managed_permissions&&Object.keys(existing.managed_permissions).length?existing.managed_permissions:managedPermissionsFor(channel);
  if(existing){
    await channel.permissionOverwrites.edit(member,managed,{reason:`Operations 967 special access re-sync by ${actorId}`});
    await app.db.query('UPDATE special_channel_access SET updated_at=now(),granted_by=$4 WHERE guild_id=$1 AND user_id=$2 AND channel_id=$3',[app.env.GUILD_ID,userId,channelId,actorId]);
    await audit(app,actorId,'access.special.resync',userId,channel,{managedPermissions:managed});
    return {status:'resynced',channel};
  }
  const previous=previousOverwriteFor(channel,userId,managed);
  await channel.permissionOverwrites.edit(member,managed,{reason:`Operations 967 special access grant by ${actorId}`});
  try{
    await app.db.query(`INSERT INTO special_channel_access(guild_id,user_id,channel_id,previous_overwrite,managed_permissions,granted_by)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,[app.env.GUILD_ID,userId,channelId,JSON.stringify(previous),JSON.stringify(managed),actorId]);
  }catch(error){
    await channel.permissionOverwrites.edit(member,restorePayload(previous,managed),{reason:'Operations 967 rollback after database failure'}).catch(()=>{});
    throw error;
  }
  await audit(app,actorId,'access.special.grant',userId,channel,{managedPermissions:managed,previousOverwrite:previous});
  return {status:'granted',channel};
}

async function removeOne(app,guild,actorId,userId,channelId){
  const row=await trackedRow(app,userId,channelId);
  if(!row)return {status:'not_tracked',channel:null};
  const channel=guild.channels.cache.get(String(channelId))??await guild.channels.fetch(String(channelId)).catch(()=>null);
  const member=guild.members.cache.get(String(userId))??await guild.members.fetch(String(userId)).catch(()=>null);
  const previous=row.previous_overwrite??{};
  const managed=row.managed_permissions??{};
  if(channel&&member){
    await channel.permissionOverwrites.edit(member,restorePayload(previous,managed),{reason:`Operations 967 special access remove by ${actorId}`});
  }
  try{
    await app.db.query('DELETE FROM special_channel_access WHERE guild_id=$1 AND user_id=$2 AND channel_id=$3',[app.env.GUILD_ID,userId,channelId]);
  }catch(error){
    if(channel&&member)await channel.permissionOverwrites.edit(member,managed,{reason:'Operations 967 rollback after database failure'}).catch(()=>{});
    throw error;
  }
  await audit(app,actorId,'access.special.remove',userId,channel,{channelId:String(channelId),restoredOverwrite:previous,channelMissing:!channel,memberMissing:!member});
  return {status:channel&&member?'removed':'record_cleaned',channel};
}

async function home(interaction,app){
  const {rows}=await app.db.query(`SELECT COUNT(*)::int AS grants,COUNT(DISTINCT user_id)::int AS users,COUNT(DISTINCT channel_id)::int AS channels
    FROM special_channel_access WHERE guild_id=$1`,[app.env.GUILD_ID]);
  const x=rows[0]??{};
  const components=buttonRows([
    button(`${PREFIX}:member:0`,'إدارة عضو',ButtonStyle.Primary,'👤'),
    button(`${PREFIX}:place:0`,'إدارة مكان',ButtonStyle.Primary,'📍'),
    button(`${PREFIX}:all:0`,'كل الوصولات',ButtonStyle.Secondary,'📋'),
    button(`${PREFIX}:notify-current`,'إشعار الوصولات الحالية',ButtonStyle.Secondary,'📨'),
    button('admin:teams','الأعضاء والفرق',ButtonStyle.Secondary,'👥'),
    button(`${PREFIX}:refresh`,'تحديث',ButtonStyle.Secondary,'🔄'),
    button('panel:refresh','العودة للوحة',ButtonStyle.Secondary,'↩️'),
  ]);
  return interaction.update({embeds:[embed('🔐 إدارة الوصول الخاص',[
    'هذه الطبقة **مستقلة تمامًا عن عضوية الفرق**: تمنح عضوًا دخول قناة محددة بدون إضافته إلى الفريق.',
    '',
    `**الأعضاء ذوو الوصول الخاص:** ${Number(x.users??0)}`,
    `**الأماكن المستخدمة:** ${Number(x.channels??0)}`,
    `**إجمالي منح الوصول:** ${Number(x.grants??0)}`,
    '',
    'يمكنك منح مكان واحد أو عدة أماكن في عملية واحدة. الإزالة تستعيد حالة Permission Overwrite السابقة التي كانت موجودة قبل المنح.',
    '',
    'ملاحظة: الوصول الخاص **إضافي**؛ لا يسحب وصولًا يحصل عليه العضو أصلًا من رتبة أو فريق آخر.',
  ].join('\n'))],components});
}

// operations967-special-channel-access-search-v1.10.13.3
function cleanMemberQuery(value){
  return String(value??'').trim().replace(/^@+/,'').trim();
}

function memberSearchScore(member,query){
  const q=query.toLocaleLowerCase('ar');
  const values=[member?.displayName,member?.nickname,member?.user?.globalName,member?.user?.username,member?.id]
    .filter(Boolean).map(v=>String(v).toLocaleLowerCase('ar'));
  let score=100;
  for(const v of values){
    if(v===q)score=Math.min(score,0);
    else if(v.startsWith(q))score=Math.min(score,10);
    else if(v.includes(q))score=Math.min(score,20);
  }
  return score;
}

async function searchGuildMembers(guild,rawQuery){
  const query=cleanMemberQuery(rawQuery);
  if(!query)return [];
  const found=new Map();
  const add=m=>{if(m&&!m.user?.bot)found.set(String(m.id),m);};

  // Discord ID: fetch exactly that member without scanning the server.
  if(/^\d{15,22}$/.test(query)){
    add(guild.members.cache.get(query)??await guild.members.fetch(query).catch(()=>null));
  }

  // Discord's guild member search handles username/nickname efficiently.
  if(query.length>=1){
    const remote=await guild.members.search({query,limit:25}).catch(()=>null);
    if(remote)for(const m of remote.values())add(m);
  }

  // Also match cached display/global names and contains-search, without listing everyone.
  const q=query.toLocaleLowerCase('ar');
  for(const m of guild.members.cache.values()){
    if(m.user?.bot)continue;
    const hay=[m.displayName,m.nickname,m.user?.globalName,m.user?.username,m.id]
      .filter(Boolean).map(v=>String(v).toLocaleLowerCase('ar'));
    if(hay.some(v=>v.includes(q)))add(m);
  }

  return [...found.values()]
    .sort((a,b)=>memberSearchScore(a,query)-memberSearchScore(b,query)||memberName(a).localeCompare(memberName(b),'ar'))
    .slice(0,25);
}

async function memberSearchModal(interaction){
  const input=new TextInputBuilder()
    .setCustomId('member_query')
    .setLabel('اسم العضو أو اليوزر أو Discord ID')
    .setPlaceholder('مثال: محمد أو m.j404 أو 123456789...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(100);
  const modal=new ModalBuilder()
    .setCustomId(`${PREFIX}:member-search-submit`)
    .setTitle('🔎 البحث عن عضو')
    .addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

// operations967-special-channel-access-search-runtime-v1.10.13.4
async function acknowledgeMemberSearch(interaction){
  if(interaction.deferred||interaction.replied)return;
  if(interaction.isModalSubmit?.()){
    if(interaction.isFromMessage?.()){
      await interaction.deferUpdate();
      return;
    }
    await interaction.deferReply();
  }
}

async function renderMemberSearch(interaction,payload){
  if(interaction.deferred||interaction.replied)return interaction.editReply(payload);
  if(typeof interaction.update==='function')return interaction.update(payload);
  return interaction.reply(payload);
}

async function memberSearchResults(interaction,app,rawQuery){
  // Discord interactions must be acknowledged quickly. Do this before guild/API search.
  await acknowledgeMemberSearch(interaction);

  const guild=await guildFor(interaction,app);
  const query=cleanMemberQuery(rawQuery);
  let matches=[];
  let searchWarning='';
  try{
    matches=await searchGuildMembers(guild,query);
  }catch(error){
    // Never crash the whole access center just because Discord member-search API failed.
    searchWarning='\n\n⚠️ تعذر البحث البعيد مؤقتًا؛ جرب Discord ID أو أعد البحث.';
    const q=query.toLocaleLowerCase('ar');
    matches=[...guild.members.cache.values()]
      .filter(m=>!m.user?.bot)
      .filter(m=>[m.displayName,m.nickname,m.user?.globalName,m.user?.username,m.id]
        .filter(Boolean).some(v=>String(v).toLocaleLowerCase('ar').includes(q)))
      .sort((a,b)=>memberSearchScore(a,query)-memberSearchScore(b,query)||memberName(a).localeCompare(memberName(b),'ar'))
      .slice(0,25);
  }

  const components=[];
  if(matches.length){
    components.push(selectRow(`${PREFIX}:member-pick:search`,'اختر العضو من نتائج البحث',matches.map(m=>({
      label:clip(memberName(m),100),
      description:clip(`@${m.user.username} • ID ${m.id}`,100),
      value:String(m.id),
    }))));
  }
  components.push(...buttonRows([
    button(`${PREFIX}:member-search`,'بحث جديد',ButtonStyle.Primary,'🔎'),
    button(`${PREFIX}:member:0`,'العودة',ButtonStyle.Secondary,'↩️'),
    button(`${PREFIX}`,'المركز',ButtonStyle.Secondary,'🔐'),
  ]));

  const desc=matches.length
    ? `بحثك: **${clip(query,100)}**\nالنتائج: **${matches.length}**\n\nاختر العضو المطلوب من القائمة.${searchWarning}`
    : `لم أجد عضوًا مطابقًا لـ **${clip(query,100)}**.\n\nجرّب الاسم الظاهر في السيرفر، اسم المستخدم بدون @، أو Discord ID.${searchWarning}`;

  return renderMemberSearch(interaction,{
    embeds:[embed('🔎 نتائج بحث الأعضاء',desc)],
    components:components.slice(0,5),
  });
}

async function memberPicker(interaction,app,page=0){
  const components=buttonRows([
    button(`${PREFIX}:member-search`,'بحث عن عضو',ButtonStyle.Primary,'🔎'),
    button(`${PREFIX}`,'المركز',ButtonStyle.Secondary,'🔐'),
  ]);
  return interaction.update({
    embeds:[embed('👤 إدارة وصول عضو','بدل عرض جميع أعضاء السيرفر، ابحث مباشرة عن الشخص المطلوب.\n\n**يمكنك البحث بـ:**\n• الاسم الظاهر في السيرفر\n• اسم المستخدم @username\n• Discord ID\n\nلن تظهر قائمة الأعضاء كاملة تلقائيًا.')],
    components,
  });
}

async function memberView(interaction,app,userId){
  const guild=await guildFor(interaction,app);
  const member=guild.members.cache.get(String(userId))??await guild.members.fetch(String(userId)).catch(()=>null);
  const rows=await dbRowsForMember(app,userId);
  const lines=[];
  for(const r of rows.slice(0,30)){
    const ch=guild.channels.cache.get(String(r.channel_id))??await guild.channels.fetch(String(r.channel_id)).catch(()=>null);
    lines.push(ch?`${channelTypeEmoji(ch)} **${clip(placeName(ch),100)}** — <#${ch.id}>`:`⚠️ قناة محذوفة/غير متاحة — ID: ${r.channel_id}`);
  }
  const title=member?memberName(member):`عضو ${userId}`;
  const desc=[
    `**العضو:** ${member?mention(userId):clip(title,100)}`,
    `**عدد الأماكن الخاصة:** ${rows.length}`,
    '',
    rows.length?'**الأماكن:**':'لا يوجد وصول خاص محفوظ لهذا العضو حتى الآن.',
    ...(lines.length?lines:['']),
    rows.length>30?`… و${rows.length-30} مكان آخر.`:'',
    '',
    'هذه القائمة تعرض فقط الوصولات التي أنشأها **مركز الوصول الخاص**، ولا تخلطها مع عضوية الفرق أو الرتب.',
  ].filter(Boolean).join('\n');
  const components=buttonRows([
    button(`${PREFIX}:member-add:${userId}:0`,'إضافة أماكن',ButtonStyle.Success,'➕'),
    button(`${PREFIX}:member-remove:${userId}:0`,'إزالة أماكن',ButtonStyle.Danger,'➖',rows.length===0),
    button(`${PREFIX}:member-view:${userId}`,'تحديث',ButtonStyle.Secondary,'🔄'),
    button(`${PREFIX}:notify-member:${userId}`,'إرسال إشعار الوصول',ButtonStyle.Secondary,'📨',rows.length===0),
    button(`${PREFIX}:member:0`,'تغيير العضو',ButtonStyle.Secondary,'👤'),
    button(`${PREFIX}`,'المركز',ButtonStyle.Secondary,'↩️'),
  ]);
  return interaction.update({embeds:[embed(`🔐 وصول ${clip(title,180)}`,desc)],components});
}

async function memberAdd(interaction,app,userId,page=0){
  const guild=await guildFor(interaction,app);
  const [places,tracked]=await Promise.all([managedPlaces(guild),dbRowsForMember(app,userId)]);
  const trackedIds=new Set(tracked.map(x=>String(x.channel_id)));
  const available=places.filter(ch=>!trackedIds.has(String(ch.id)));
  const p=paginate(available,page);
  const components=[];
  if(p.items.length){
    components.push(selectRow(`${PREFIX}:member-add-submit:${userId}:${p.page}`,'حدد مكانًا واحدًا أو عدة أماكن',p.items.map(ch=>({
      label:clip(placeName(ch),100),description:clip(`${channelTypeEmoji(ch)} ${ch.name} • ID ${ch.id}`,100),value:String(ch.id),emoji:channelTypeEmoji(ch),
    })),{min:1,max:Math.min(25,p.items.length)}));
  }
  components.push(...buttonRows([
    button(`${PREFIX}:member-add:${userId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'◀️',p.page<=0),
    button(`${PREFIX}:member-add:${userId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'▶️',p.page>=p.pages-1),
    button(`${PREFIX}:member-view:${userId}`,'العودة للعضو',ButtonStyle.Primary,'↩️'),
  ]));
  const text=p.total?`الأماكن غير الممنوحة لهذا العضو: **${p.total}**\nالصفحة **${p.page+1}/${p.pages}**\n\nيمكنك تحديد **عدة أماكن مرة واحدة** من هذه الصفحة.`:'هذا العضو لديه بالفعل كل القنوات القابلة للإدارة، أو لا توجد قنوات متاحة.';
  return interaction.update({embeds:[embed('➕ إضافة وصول خاص',text)],components:components.slice(0,5)});
}

async function memberAddSubmit(interaction,app,userId){
  const guild=await guildFor(interaction,app);
  let granted=0,resynced=0,failed=0;
  const failures=[];
  const grantedChannels=[];
  for(const channelId of interaction.values??[]){
    try{
      const result=await grantOne(app,guild,interaction.user.id,userId,channelId);
      if(result.status==='granted'){
        granted++;
        if(result.channel)grantedChannels.push(result.channel);
      }else resynced++;
    }catch(error){failed++;failures.push(String(channelId)+': '+String(error?.message??error));}
  }
  const notice=await notifySpecialAccessGranted(app,guild,userId,grantedChannels);
  const notices=[];
  if(notice.status==='failed'||notice.status==='member_missing')notices.push('⚠️ تم منح الوصول، لكن تعذر إرسال الرسالة الخاصة للعضو.');
  if(notice.status==='suppressed')notices.push('🔕 تم منح الوصول، وإشعار العضو لم يُرسل لأن وضع إرسال الأعضاء مضبوط على OFF.');
  if(failed)notices.push('⚠️ تم منح '+granted+'، إعادة مزامنة '+resynced+'، وفشل '+failed+'.\n'+clip(failures.join('\n'),1500));
  if(notices.length)await interaction.followUp?.({content:notices.join('\n'),ephemeral:Boolean(interaction.guildId)}).catch(()=>{});
  return memberView(interaction,app,userId);
}
async function memberRemove(interaction,app,userId,page=0){
  const guild=await guildFor(interaction,app);
  const tracked=await dbRowsForMember(app,userId);
  const p=paginate(tracked,page);
  const components=[];
  if(p.items.length){
    const options=[];
    for(const r of p.items){
      const ch=guild.channels.cache.get(String(r.channel_id))??await guild.channels.fetch(String(r.channel_id)).catch(()=>null);
      options.push({label:clip(ch?placeName(ch):`قناة ${r.channel_id}`,100),description:clip(ch?`${channelTypeEmoji(ch)} ${ch.name}`:'القناة غير موجودة — سيتم تنظيف السجل',100),value:String(r.channel_id)});
    }
    components.push(selectRow(`${PREFIX}:member-remove-submit:${userId}:${p.page}`,'حدد ما تريد سحب وصوله',options,{min:1,max:Math.min(25,options.length)}));
  }
  components.push(...buttonRows([
    button(`${PREFIX}:member-remove:${userId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'◀️',p.page<=0),
    button(`${PREFIX}:member-remove:${userId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'▶️',p.page>=p.pages-1),
    button(`${PREFIX}:member-view:${userId}`,'العودة للعضو',ButtonStyle.Primary,'↩️'),
  ]));
  return interaction.update({embeds:[embed('➖ إزالة وصول خاص',tracked.length?`حدد مكانًا واحدًا أو عدة أماكن لسحبها.\n\n**مهم:** النظام سيعيد حالة صلاحيات العضو التي كانت موجودة على القناة **قبل** أن يمنحها هذا المركز.\n\nالصفحة **${p.page+1}/${p.pages}** — الإجمالي **${p.total}**.`:'لا يوجد وصول خاص لهذا العضو.')],components:components.slice(0,5)});
}
async function memberRemoveSubmit(interaction,app,userId){
  const guild=await guildFor(interaction,app);
  let removed=0,cleaned=0,failed=0;
  const failures=[];
  for(const channelId of interaction.values??[]){
    try{
      const result=await removeOne(app,guild,interaction.user.id,userId,channelId);
      if(result.status==='removed')removed++;else cleaned++;
    }catch(error){failed++;failures.push(`${channelId}: ${error?.message??String(error)}`);}
  }
  if(failed){
    await interaction.followUp?.({content:`⚠️ سُحب ${removed}، نُظف ${cleaned}، وفشل ${failed}.\n${clip(failures.join('\n'),1500)}`,ephemeral:Boolean(interaction.guildId)}).catch(()=>{});
  }
  return memberView(interaction,app,userId);
}

async function placePicker(interaction,app,page=0){
  const guild=await guildFor(interaction,app);
  const all=await managedPlaces(guild);
  const p=paginate(all,page);
  const components=[];
  if(p.items.length){
    components.push(selectRow(`${PREFIX}:place-pick:${p.page}`,'اختر المكان لعرض أعضائه',p.items.map(ch=>({label:clip(placeName(ch),100),description:clip(`${channelTypeEmoji(ch)} ${ch.name} • ID ${ch.id}`,100),value:String(ch.id),emoji:channelTypeEmoji(ch)}))));
  }
  components.push(...buttonRows([
    button(`${PREFIX}:place:${p.page-1}`,'السابق',ButtonStyle.Secondary,'◀️',p.page<=0),
    button(`${PREFIX}:place:${p.page+1}`,'التالي',ButtonStyle.Secondary,'▶️',p.page>=p.pages-1),
    button(`${PREFIX}`,'المركز',ButtonStyle.Primary,'🔐'),
  ]));
  return interaction.update({embeds:[embed('📍 اختر مكانًا',`القنوات القابلة للوصول الخاص: **${p.total}**\nالصفحة **${p.page+1}/${p.pages}**\n\nالتصنيف يظهر قبل اسم القناة حتى تعرف مكانها داخل السيرفر. عناوين الـCategories نفسها غير قابلة للاختيار حتى لا تمنح نطاقًا واسعًا بالخطأ.`)],components:components.slice(0,5)});
}

async function placeView(interaction,app,channelId){
  const guild=await guildFor(interaction,app);
  const channel=guild.channels.cache.get(String(channelId))??await guild.channels.fetch(String(channelId)).catch(()=>null);
  const rows=await dbRowsForChannel(app,channelId);
  const members=await humanMembers(guild);
  const byId=new Map(members.map(m=>[String(m.id),m]));
  const lines=rows.slice(0,30).map(r=>{
    const m=byId.get(String(r.user_id));
    return `• ${m?mention(r.user_id):`ID ${r.user_id}`} — ${m?clip(memberName(m),80):'غادر السيرفر/غير متاح'}`;
  });
  const name=channel?placeName(channel):`قناة ${channelId}`;
  const desc=[
    channel?`**المكان:** ${channelTypeEmoji(channel)} <#${channel.id}>`:`⚠️ القناة غير موجودة حاليًا — ID ${channelId}`,
    `**أعضاء الوصول الخاص:** ${rows.length}`,
    '',
    rows.length?'**الأعضاء:**':'لا يوجد أعضاء مضافون لهذا المكان عبر مركز الوصول الخاص.',
    ...lines,
    rows.length>30?`… و${rows.length-30} عضو آخر.`:'',
  ].filter(Boolean).join('\n');
  return interaction.update({embeds:[embed(`📍 ${clip(name,210)}`,desc)],components:buttonRows([
    button(`${PREFIX}:place-add-members:${channelId}:0`,'إضافة أعضاء',ButtonStyle.Success,'➕',!channel),
    button(`${PREFIX}:place-remove-members:${channelId}:0`,'إزالة أعضاء',ButtonStyle.Danger,'➖',rows.length===0),
    button(`${PREFIX}:place-view:${channelId}`,'تحديث',ButtonStyle.Secondary,'🔄'),
    button(`${PREFIX}:place:0`,'تغيير المكان',ButtonStyle.Secondary,'📍'),
    button(`${PREFIX}`,'المركز',ButtonStyle.Secondary,'↩️'),
  ])});
}

async function placeAddMembers(interaction,app,channelId,page=0){
  const guild=await guildFor(interaction,app);
  const [members,tracked]=await Promise.all([humanMembers(guild),dbRowsForChannel(app,channelId)]);
  const trackedIds=new Set(tracked.map(x=>String(x.user_id)));
  const available=members.filter(m=>!trackedIds.has(String(m.id)));
  const p=paginate(available,page);
  const components=[];
  if(p.items.length){
    components.push(selectRow(`${PREFIX}:place-add-members-submit:${channelId}:${p.page}`,'حدد عضوًا واحدًا أو عدة أعضاء',p.items.map(m=>({label:clip(memberName(m),100),description:clip(`@${m.user.username} • ID ${m.id}`,100),value:String(m.id)})),{min:1,max:Math.min(25,p.items.length)}));
  }
  components.push(...buttonRows([
    button(`${PREFIX}:place-add-members:${channelId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'◀️',p.page<=0),
    button(`${PREFIX}:place-add-members:${channelId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'▶️',p.page>=p.pages-1),
    button(`${PREFIX}:place-view:${channelId}`,'العودة للمكان',ButtonStyle.Primary,'↩️'),
  ]));
  return interaction.update({embeds:[embed('➕ إضافة أعضاء للمكان',p.total?`الأعضاء غير المضافين لهذا المكان: **${p.total}**\nالصفحة **${p.page+1}/${p.pages}**\n\nيمكنك تحديد عدة أعضاء مرة واحدة.`:'لا يوجد أعضاء آخرون متاحون للإضافة.')],components:components.slice(0,5)});
}

async function placeAddMembersSubmit(interaction,app,channelId){
  const guild=await guildFor(interaction,app);
  let granted=0,resynced=0,failed=0,noticeFailed=0,noticeSuppressed=0;
  const failures=[];
  for(const userId of interaction.values??[]){
    try{
      const result=await grantOne(app,guild,interaction.user.id,userId,channelId);
      if(result.status==='granted'){
        granted++;
        const notice=await notifySpecialAccessGranted(app,guild,userId,result.channel?[result.channel]:[]);
        if(notice.status==='failed'||notice.status==='member_missing')noticeFailed++;
        if(notice.status==='suppressed')noticeSuppressed++;
      }else resynced++;
    }catch(error){failed++;failures.push(String(userId)+': '+String(error?.message??error));}
  }
  const notices=[];
  if(noticeFailed)notices.push('⚠️ الوصول تم بنجاح، لكن تعذر إرسال DM إلى '+noticeFailed+' عضو.');
  if(noticeSuppressed)notices.push('🔕 لم تُرسل إشعارات إلى '+noticeSuppressed+' عضو لأن وضع إرسال الأعضاء مضبوط على OFF.');
  if(failed)notices.push('⚠️ تم منح '+granted+'، إعادة مزامنة '+resynced+'، وفشل '+failed+'.\n'+clip(failures.join('\n'),1500));
  if(notices.length)await interaction.followUp?.({content:notices.join('\n'),ephemeral:Boolean(interaction.guildId)}).catch(()=>{});
  return placeView(interaction,app,channelId);
}
async function placeRemoveMembers(interaction,app,channelId,page=0){
  const guild=await guildFor(interaction,app);
  const tracked=await dbRowsForChannel(app,channelId);
  const members=await humanMembers(guild);
  const byId=new Map(members.map(m=>[String(m.id),m]));
  const p=paginate(tracked,page);
  const components=[];
  if(p.items.length){
    const options=p.items.map(r=>{const m=byId.get(String(r.user_id));return {label:clip(m?memberName(m):`عضو ${r.user_id}`,100),description:clip(m?`@${m.user.username} • ID ${m.id}`:'غير موجود حاليًا — سيتم تنظيف السجل',100),value:String(r.user_id)};});
    components.push(selectRow(`${PREFIX}:place-remove-members-submit:${channelId}:${p.page}`,'حدد من تريد إزالة وصوله',options,{min:1,max:Math.min(25,options.length)}));
  }
  components.push(...buttonRows([
    button(`${PREFIX}:place-remove-members:${channelId}:${p.page-1}`,'السابق',ButtonStyle.Secondary,'◀️',p.page<=0),
    button(`${PREFIX}:place-remove-members:${channelId}:${p.page+1}`,'التالي',ButtonStyle.Secondary,'▶️',p.page>=p.pages-1),
    button(`${PREFIX}:place-view:${channelId}`,'العودة للمكان',ButtonStyle.Primary,'↩️'),
  ]));
  return interaction.update({embeds:[embed('➖ إزالة أعضاء من المكان',tracked.length?`حدد عضوًا واحدًا أو عدة أعضاء.\nالصفحة **${p.page+1}/${p.pages}** — الإجمالي **${p.total}**.`:'لا يوجد أعضاء مضافون لهذا المكان.')],components:components.slice(0,5)});
}
async function placeRemoveMembersSubmit(interaction,app,channelId){
  const guild=await guildFor(interaction,app);
  let removed=0,failed=0;const failures=[];
  for(const userId of interaction.values??[]){
    try{await removeOne(app,guild,interaction.user.id,userId,channelId);removed++;}
    catch(error){failed++;failures.push(`${userId}: ${error?.message??String(error)}`);}
  }
  if(failed)await interaction.followUp?.({content:`⚠️ تمت إزالة ${removed} وفشل ${failed}.\n${clip(failures.join('\n'),1500)}`,ephemeral:Boolean(interaction.guildId)}).catch(()=>{});
  return placeView(interaction,app,channelId);
}

async function allAccess(interaction,app,page=0){
  const guild=await guildFor(interaction,app);
  const {rows}=await app.db.query(`SELECT user_id,channel_id,granted_by,created_at FROM special_channel_access WHERE guild_id=$1 ORDER BY created_at DESC`,[app.env.GUILD_ID]);
  const p=paginate(rows,page);
  const members=await humanMembers(guild);
  const byId=new Map(members.map(m=>[String(m.id),m]));
  const lines=[];
  for(const r of p.items){
    const m=byId.get(String(r.user_id));
    const ch=guild.channels.cache.get(String(r.channel_id))??await guild.channels.fetch(String(r.channel_id)).catch(()=>null);
    lines.push(`• ${m?mention(r.user_id):`ID ${r.user_id}`} → ${ch?`${channelTypeEmoji(ch)} <#${ch.id}>`:`⚠️ قناة ${r.channel_id}`}`);
  }
  const components=buttonRows([
    button(`${PREFIX}:all:${p.page-1}`,'السابق',ButtonStyle.Secondary,'◀️',p.page<=0),
    button(`${PREFIX}:all:${p.page+1}`,'التالي',ButtonStyle.Secondary,'▶️',p.page>=p.pages-1),
    button(`${PREFIX}:all:${p.page}`,'تحديث',ButtonStyle.Secondary,'🔄'),
    button(`${PREFIX}`,'المركز',ButtonStyle.Primary,'↩️'),
  ]);
  return interaction.update({embeds:[embed('📋 كل الوصولات الخاصة',rows.length?`${lines.join('\n')}\n\n**الصفحة ${p.page+1}/${p.pages} — الإجمالي ${p.total}**`:'لا يوجد أي وصول خاص محفوظ حتى الآن.')],components});
}

export async function handleOwnerAccessCenterInteraction(interaction,app){
  const id=String(interaction.customId??'');
  if(id!==PREFIX&&!id.startsWith(`${PREFIX}:`))return false;
  await ensureOwner(interaction,app);
  // operations967-special-channel-access-dm-v1.10.13.2
  // يعمل هذا المركز في DM أيضًا؛ guildFor يحل السيرفر من GUILD_ID عند غياب interaction.guild.


  if(id===PREFIX||id===`${PREFIX}:refresh`){await home(interaction,app);return true;}
  const p=id.split(':');
  const action=p[2];

  if(action==='notify-current'){await currentAccessNotificationConfirm(interaction,app,null);return true;}
  if(action==='notify-current-confirm'){await currentAccessNotificationSend(interaction,app,null);return true;}
  if(action==='notify-member'){await currentAccessNotificationConfirm(interaction,app,p[3]);return true;}
  if(action==='notify-member-confirm'){await currentAccessNotificationSend(interaction,app,p[3]);return true;}

  if(action==='member'&&p.length===4){await memberPicker(interaction,app,p[3]);return true;}
  if(action==='member-search'){await memberSearchModal(interaction);return true;}
  if(action==='member-search-submit'){const query=interaction.fields?.getTextInputValue('member_query')??'';await memberSearchResults(interaction,app,query);return true;}
  if(action==='member-pick'){const userId=String(interaction.values?.[0]??'');if(userId)await memberView(interaction,app,userId);else await memberPicker(interaction,app,p[3]);return true;}
  if(action==='member-view'){await memberView(interaction,app,p[3]);return true;}
  if(action==='member-add'){await memberAdd(interaction,app,p[3],p[4]);return true;}
  if(action==='member-add-submit'){await memberAddSubmit(interaction,app,p[3]);return true;}
  if(action==='member-remove'){await memberRemove(interaction,app,p[3],p[4]);return true;}
  if(action==='member-remove-submit'){await memberRemoveSubmit(interaction,app,p[3]);return true;}

  if(action==='place'&&p.length===4){await placePicker(interaction,app,p[3]);return true;}
  if(action==='place-pick'){const channelId=String(interaction.values?.[0]??'');if(channelId)await placeView(interaction,app,channelId);else await placePicker(interaction,app,p[3]);return true;}
  if(action==='place-view'){await placeView(interaction,app,p[3]);return true;}
  if(action==='place-add-members'){await placeAddMembers(interaction,app,p[3],p[4]);return true;}
  if(action==='place-add-members-submit'){await placeAddMembersSubmit(interaction,app,p[3]);return true;}
  if(action==='place-remove-members'){await placeRemoveMembers(interaction,app,p[3],p[4]);return true;}
  if(action==='place-remove-members-submit'){await placeRemoveMembersSubmit(interaction,app,p[3]);return true;}

  if(action==='all'){await allAccess(interaction,app,p[3]);return true;}
  await home(interaction,app);return true;
}
