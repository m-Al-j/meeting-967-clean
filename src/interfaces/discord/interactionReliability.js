import {PICKER_SEARCH_VALUE} from './guildPicker.js';
const MODAL_OPENERS = [
  id => id === 'ai:ask',
  id => id === 'ai:message',
  id => id === 'excuse:meeting',
  id => id.startsWith('excuse:approve:'),
  id => id.startsWith('excuse:reject:'),
  id => id === 'team:create',
  // Team-manager search opens a modal and must never be pre-deferred.
  id => id === 'perm:team-manager-search',
  id => id.startsWith('team:rename:') && !id.startsWith('team:rename-submit:'),
  id => id === 'settings:late',
  id => id === 'settings:autopilot-timing',
  id => id === 'settings:timezone',
  id => id === 'archive:search',
  id => id === 'owner:messages:user-search',
  id => id.startsWith('owner:messages:compose:'),
  id => id === 'support:problem',
  id => id === 'support:help',
  id => id === 'ai:open',
  id => id === 'meeting:create:team',
  id => id.startsWith('meeting:cancel:') && !id.startsWith('meeting:cancel-submit:'),
  id => id.startsWith('meeting:reschedule:') && !id.startsWith('meeting:reschedule-submit:'),
  id => id.startsWith('meeting:postpone:') && !id.startsWith('meeting:postpone-submit:'),
  id => id.startsWith('meeting:edit:') && !id.startsWith('meeting:edit-submit:'),
  id => id.startsWith('meeting:decision:') && !id.startsWith('meeting:decision-submit:'),
  id => id === 'task:standalone-team-select',
  id => id.startsWith('meeting:task:') && !id.startsWith('meeting:task-submit:'),
  id => id.startsWith('membership:freeze:') && !id.startsWith('membership:freeze-submit:'),
  id => id === 'member:membership:freeze',
  id => id.startsWith('owner:meeting-center:recipients-search-open:'),
  id => id === 'task:create-team',
  id => id.startsWith('task:submit:') && !id.startsWith('task:submit-save:'),
  id => id.startsWith('task:reject:') && !id.startsWith('task:reject-save:'),
  id => id.startsWith('task:edit:') && !id.startsWith('task:edit-save:'),
  id => id.startsWith('task:live-details:') && !id.startsWith('task:live-details-save:'),
  id => id==='ops:wf-template',
  id => id.startsWith('ops:decision-meta:') && !id.startsWith('ops:decision-meta-save:'),
  id => id.startsWith('ops:decision-complete:') && !id.startsWith('ops:decision-complete-save:'),
  id => id.startsWith('ops:wf-due:') && !id.startsWith('ops:wf-due-save:'),
  // Member search buttons must open a modal before any automatic defer.
  // operations967-owner-access-member-search-modal-opener-v1.10.13.5
  id => (id.endsWith(':member-search') || id.includes(':member-search:')) && !id.includes(':member-search-submit:') && !id.endsWith(':member-search-submit')
];

export function isModalOpener(interaction){
  if(!interaction?.isButton?.() && !interaction?.isAnySelectMenu?.()) return false;
  // Selecting the search entry inside a member list must open a modal. Do not
  // defer it first because Discord forbids showModal after deferUpdate.
  if(interaction?.isAnySelectMenu?.() && String(interaction.values?.[0]??'')===PICKER_SEARCH_VALUE)return true;
  const id=String(interaction.customId??'');
  return MODAL_OPENERS.some(fn=>fn(id));
}

export function handlerForCustomId(id=''){
  id=String(id);
  if(id==='admin:archive-documents'||id.startsWith('archive-docs:')) return 'archiveDocuments';
  if(id==='admin:permissions'||id.startsWith('perm:')) return 'permissions';
  if(id==='admin:data-center'||id.startsWith('data:')) return 'data';
  if(id==='admin:operations'||id.startsWith('ops:')) return 'operations';
  if(id==='admin:membership'||id==='member:membership'||id.startsWith('member:membership:')||id.startsWith('membership:')) return 'membership';
  if(id.startsWith('support:')||id==='admin:support') return 'support';
  if(id==='admin:tasks'||id==='member:tasks'||id.startsWith('task:')||id.startsWith('meeting:task:')) return 'tasks';
  if(id==='admin:teams'||id==='member:team'||id.startsWith('team:')) return 'teams';
  if(id==='admin:excuses'||id==='member:excuse'||id==='member:excuses'||id.startsWith('excuse:')) return 'excuses';
  if(id==='admin:attendance'||id.startsWith('attendance:')) return 'attendance';
  if(id==='admin:reports'||id.startsWith('report:')) return 'reports';
  if(id==='admin:recordings'||id.startsWith('recording:')) return 'recordings';
  if(id==='admin:meetings'||id==='member:meetings'||id==='member:past-meetings'||id.startsWith('meeting:')) return 'meetings';
  return 'misc';
}

export function safeInteraction(interaction){
  if(interaction?.__meeting967SafeProxy) return interaction.__meeting967SafeProxy;
  const originalReply=interaction.reply?.bind(interaction);
  const originalUpdate=interaction.update?.bind(interaction);
  const originalEditReply=interaction.editReply?.bind(interaction);
  const originalFollowUp=interaction.followUp?.bind(interaction);
  const originalDeferReply=interaction.deferReply?.bind(interaction);
  const originalDeferUpdate=interaction.deferUpdate?.bind(interaction);

  const proxy=new Proxy(interaction,{
    get(target,prop){
      if(prop==='__rawInteraction') return target;
      if(prop==='reply') return async payload=>{
        if(!target.deferred&&!target.replied) return originalReply(payload);
        if(target.deferred&&originalEditReply) return originalEditReply(payload);
        return originalFollowUp(payload);
      };
      if(prop==='update') return async payload=>{
        if(!target.deferred&&!target.replied) return originalUpdate(payload);
        return originalEditReply(payload);
      };
      if(prop==='editReply') return originalEditReply;
      if(prop==='followUp') return originalFollowUp;
      if(prop==='deferReply') return async payload=>{
        if(target.deferred||target.replied) return undefined;
        return originalDeferReply(payload);
      };
      if(prop==='deferUpdate') return async()=>{
        if(target.deferred||target.replied) return undefined;
        return originalDeferUpdate();
      };
      const value=Reflect.get(target,prop,target);
      return typeof value==='function'?value.bind(target):value;
    },
    set(target,prop,value){return Reflect.set(target,prop,value,target);}
  });
  try{interaction.__meeting967SafeProxy=proxy;}catch{}
  return proxy;
}

// components-v2-launcher-v1.9.6.4
const COMPONENTS_V2_FLAG=1<<15;
function sourceIsComponentsV2(interaction){
  const flags=Number(interaction?.message?.flags?.bitfield??interaction?.message?.flags??0);
  return (flags&COMPONENTS_V2_FLAG)!==0;
}

export async function acknowledgeEarly(interaction){
  if(interaction.deferred||interaction.replied) return;
  if(interaction.isChatInputCommand?.()){
    await interaction.deferReply({ephemeral:Boolean(interaction.guildId)});
    return;
  }
  if(interaction.isModalSubmit?.()){
    await interaction.deferReply({ephemeral:Boolean(interaction.guildId)});
    return;
  }
  if((interaction.isButton?.()||interaction.isAnySelectMenu?.())&&!isModalOpener(interaction)){
    const id=String(interaction.customId??'');
    // A Components V2 dashboard is a launcher. Existing feature handlers are
    // legacy menus that call update(); open them in a fresh ephemeral response
    // so they never try to replace the V2 message with embeds (Discord forbids it).
    if(sourceIsComponentsV2(interaction)&&id!=='panel:refresh'){
      await interaction.deferReply({ephemeral:Boolean(interaction.guildId)});
      return;
    }
    // Live meeting task-board controls always run in an ephemeral flow so a
    // leader cannot accidentally replace the shared voice-channel board.
    if(id.startsWith('task:live-')){
      await interaction.deferReply({ephemeral:Boolean(interaction.guildId)});
      return;
    }
    await interaction.deferUpdate();
  }
}
