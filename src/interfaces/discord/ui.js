import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,StringSelectMenuBuilder,ChannelSelectMenuBuilder,RoleSelectMenuBuilder,UserSelectMenuBuilder,ChannelType} from 'discord.js';
export const e=(title,description='')=>new EmbedBuilder().setTitle(title).setDescription(description).setColor(0xC59A45).setTimestamp();
export const btn=(id,label,style=ButtonStyle.Secondary,emoji=null)=>{const b=new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);if(emoji)b.setEmoji(emoji);return b;};
export const rowsFromButtons=(buttons)=>{const rows=[];for(let i=0;i<buttons.length;i+=5)rows.push(new ActionRowBuilder().addComponents(buttons.slice(i,i+5)));return rows;};
export const stringSelect=(id,placeholder,options,min=1,max=1)=>new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(min).setMaxValues(max).addOptions(options.slice(0,25)));
export const voiceSelect=(id)=>new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder('اختر القناة الصوتية').setChannelTypes(ChannelType.GuildVoice,ChannelType.GuildStageVoice).setMinValues(1).setMaxValues(1));
export const textSelect=(id,placeholder)=>new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement));
export const roleSelect=(id)=>new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder('اختر رتبة Discord'));
export const userSelect=(id,placeholder='اختر عضوًا',min=1,max=1)=>new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(min).setMaxValues(max));

export const navigationRow=(backId='panel:refresh',backLabel='رجوع',includeHome=true)=>{const buttons=[btn(backId,backLabel,ButtonStyle.Secondary,'⬅️')];if(includeHome&&backId!=='panel:refresh')buttons.push(btn('panel:refresh','الرئيسية',ButtonStyle.Secondary,'🏠'));return new ActionRowBuilder().addComponents(buttons);};
export const withNavigation=(components=[],backId='panel:refresh',backLabel='رجوع',includeHome=true)=>[...components,navigationRow(backId,backLabel,includeHome)];
