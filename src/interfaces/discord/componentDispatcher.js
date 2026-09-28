import {handleMeetings} from './interactions/meetings.js';
import {handleTeams} from './interactions/teams.js';
import {handleExcuses} from './interactions/excuses.js';
import {handleAttendance} from './interactions/attendance.js';
import {handleReports} from './interactions/reports.js';
import {handleRecordings} from './interactions/recordings.js';
import {handlePermissions} from './interactions/permissions.js';
import {handleMisc} from './interactions/misc.js';
import {handleTasks} from './interactions/tasks.js';
import {handleSupport} from './interactions/support.js';
import {handleDataCenter} from './interactions/dataCenter.js';
import {handleArchiveDocuments} from './interactions/archiveDocuments.js';
import {handlerForCustomId} from './interactionReliability.js';
import {handleOperations} from './interactions/operations.js';
import {handleAIInteraction} from './commands/ai.js';
import {handleMembership} from './interactions/membership.js';

const handlers={meetings:handleMeetings,tasks:handleTasks,teams:handleTeams,excuses:handleExcuses,attendance:handleAttendance,reports:handleReports,recordings:handleRecordings,permissions:handlePermissions,support:handleSupport,data:handleDataCenter,operations:handleOperations,membership:handleMembership,misc:handleMisc,archiveDocuments:handleArchiveDocuments};

export async function dispatchComponentInteraction(interaction,app){
  if(String(interaction.customId??'').startsWith('ai:')){
    const subject=await import('./context.js').then(m=>m.subjectFromInteraction(interaction,app.env));
    return handleAIInteraction(interaction,app,subject,String(interaction.customId??''));
  }
  const key=handlerForCustomId(interaction.customId??'');
  return handlers[key](interaction,app);
}

export async function resumeMemberSelection(commandInteraction,app,{customId,userId}){
  const synthetic=new Proxy(commandInteraction,{
    get(target,prop){
      if(prop==='customId')return String(customId);
      if(prop==='values')return [String(userId)];
      if(prop==='isAnySelectMenu'||prop==='isStringSelectMenu')return ()=>true;
      if(prop==='isChatInputCommand'||prop==='isButton'||prop==='isModalSubmit'||prop==='isAutocomplete')return ()=>false;
      const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
    }
  });
  return dispatchComponentInteraction(synthetic,app);
}
