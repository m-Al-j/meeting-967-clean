import {ActionRowBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,ButtonStyle} from 'discord.js';
import {btn,rowsFromButtons} from './ui.js';
export {filterMemberOptions,memberSearchKey,getMemberSearch,setMemberSearch,clearMemberSearch,searchSummary} from './memberSearchState.js';

export function memberSearchModal(customId,current='',title='بحث عن عضو'){
  const field=new TextInputBuilder()
    .setCustomId('query')
    .setLabel('اكتب الاسم أو اليوزر فقط')
    .setPlaceholder('مثال: م أو محمد أو @m.j404 — بدون /member')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  if(String(current??'').trim())field.setValue(String(current).slice(0,100));
  return new ModalBuilder().setCustomId(customId).setTitle(title.slice(0,45)).addComponents(new ActionRowBuilder().addComponents(field));
}

export function memberSearchRows({openId,clearId,query=''}){
  const buttons=[btn(openId,query?`تعديل البحث: ${String(query).slice(0,24)}`:'بحث بالاسم أو اليوزر',ButtonStyle.Primary,'🔎')];
  if(query)buttons.push(btn(clearId,'إلغاء البحث',ButtonStyle.Secondary,'✖️'));
  return rowsFromButtons(buttons);
}
