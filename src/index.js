import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { createDiscordClient } from './infrastructure/discord/client.js';
import { routeInteraction } from './interfaces/discord/router.js';
import { handleVoiceState, reconcileVoice } from './interfaces/discord/voiceHandler.js';
import { handleTeamRoleSync, reconcileTeamRoleLinks } from './interfaces/discord/teamRoleSyncHandler.js';
import { ServerSyncCoordinator } from './application/services/ServerSyncCoordinator.js';
import { MembershipRoleService } from './application/services/MembershipRoleService.js';
import { MembershipActivityScheduler } from './application/services/MembershipActivityScheduler.js';
import { invalidateGuildPickerCache } from './interfaces/discord/guildPicker.js';

const app=buildApp();
const client=createDiscordClient();
let serverSync=null;
let membershipActivityScheduler=null;
let membershipRoleService=null;
let healthTimer=null;
let shuttingDown=false;
const runtimeDir=path.resolve('.runtime');
const heartbeatFile=path.join(runtimeDir,'heartbeat.json');
fs.mkdirSync(runtimeDir,{recursive:true});

function writeHeartbeat(state='starting',extra={}){
  try{
    const payload={
      state,
      pid:process.pid,
      ts:new Date().toISOString(),
      uptimeSeconds:Math.floor(process.uptime()),
      discordReady:client.isReady(),
      wsStatus:client.ws?.status ?? null,
      pingMs:Number.isFinite(client.ws?.ping)?Math.round(client.ws.ping):null,
      activeRecordings:app.recordingService?.active?.size ?? 0,
      ...extra
    };
    fs.writeFileSync(heartbeatFile,JSON.stringify(payload,null,2));
  }catch(error){
    app.logger.warn('heartbeat-write-failed',{error:error?.message??String(error)});
  }
}

async function shutdown(signal,{exitCode=0}={}){
  if(shuttingDown)return;
  shuttingDown=true;
  app.logger.info('shutdown',{signal,exitCode});
  writeHeartbeat('stopping',{signal,exitCode});
  if(healthTimer){clearInterval(healthTimer);healthTimer=null;}
  serverSync?.stop();
  membershipActivityScheduler?.stop();
  membershipRoleService?.stop();
  app.autopilotService?.stop();
  app.outputReliabilityService?.stop();
  // operations967-system-health-center-v1:index
  app.systemHealthService?.stop();
  for(const id of [...app.recordingService.active.keys()]){
    await app.recordingService.stopByMeeting(id).catch(error=>app.logger.error('recording-stop-on-shutdown-failed',{meetingId:id,error:error?.stack??String(error)}));
  }
  app.membershipReviewService?.stop();
  app.backupScheduler.stop();
  try{client.destroy();}catch{}
  try{await app.db.end();}catch(error){app.logger.error('db-close-failed',{error:error?.stack??String(error)});}
  writeHeartbeat(exitCode===0?'offline':'crashed',{signal,exitCode});
  process.exit(exitCode);
}

process.on('unhandledRejection',error=>{
  app.logger.error('unhandledRejection',{error:error?.stack??String(error)});
  writeHeartbeat('degraded',{lastError:error?.message??String(error)});
});
process.on('uncaughtException',error=>{
  app.logger.error('uncaughtException',{error:error?.stack??String(error)});
  shutdown('uncaughtException',{exitCode:1}).catch(()=>process.exit(1));
});
process.on('SIGINT',()=>shutdown('SIGINT'));
process.on('SIGTERM',()=>shutdown('SIGTERM'));


client.on('messageCreate',message=>{
  app.aiChatRoomService?.handleMessage(message).catch(error=>
    app.logger.error('ai-chat-message-event-failed',{
      error:error?.stack??String(error),
      channelId:message?.channelId,
      userId:message?.author?.id,
    })
  );
});
client.on('interactionCreate',i=>routeInteraction(i,app));
client.on('voiceStateUpdate',(o,n)=>handleVoiceState(o,n,app));
client.on('guildMemberUpdate',(o,n)=>{invalidateGuildPickerCache(n.guild.id);return handleTeamRoleSync(o,n,app);});
client.on('error',error=>app.logger.error('discord-client-error',{error:error?.stack??String(error)}));
client.on('warn',message=>app.logger.warn('discord-client-warn',{message:String(message)}));
client.on('shardError',(error,shardId)=>app.logger.error('discord-shard-error',{shardId,error:error?.stack??String(error)}));
client.on('shardDisconnect',(event,shardId)=>app.logger.warn('discord-shard-disconnect',{shardId,code:event?.code,reason:event?.reason}));
client.on('shardReconnecting',shardId=>app.logger.warn('discord-shard-reconnecting',{shardId}));
client.on('shardResume',(shardId,replayedEvents)=>app.logger.info('discord-shard-resume',{shardId,replayedEvents}));
client.on('invalidated',()=>{
  app.logger.error('discord-session-invalidated');
  shutdown('discord-session-invalidated',{exitCode:1}).catch(()=>process.exit(1));
});

function scheduleStructureSync(guildId,reason){
  if(!serverSync||String(guildId)!==String(app.env.GUILD_ID))return;
  serverSync.schedule(reason);
}
client.on('roleCreate',role=>{invalidateGuildPickerCache(role.guild.id);scheduleStructureSync(role.guild.id,'role-created');});
client.on('roleUpdate',(_oldRole,newRole)=>{invalidateGuildPickerCache(newRole.guild.id);scheduleStructureSync(newRole.guild.id,'role-updated');});
client.on('roleDelete',role=>{invalidateGuildPickerCache(role.guild.id);scheduleStructureSync(role.guild.id,'role-deleted');});
client.on('channelCreate',channel=>scheduleStructureSync(channel.guild?.id,'channel-created'));
client.on('channelUpdate',(_oldChannel,newChannel)=>scheduleStructureSync(newChannel.guild?.id,'channel-updated'));
client.on('channelDelete',channel=>scheduleStructureSync(channel.guild?.id,'channel-deleted'));


// membership-monthly-role-new-member-handler-v1.0.20
client.on('guildMemberAdd',member=>{
  invalidateGuildPickerCache(member.guild.id);
  scheduleStructureSync(member.guild.id,'member-added');
  if(!member.user?.bot){
    setTimeout(()=>{
      Promise.resolve(
        membershipRoleService?.handleNewMember?.(member)
      ).catch(error=>{
        app.logger?.warn?.('membership-monthly-role-new-member-sync-failed',{
          guildId:String(member.guild.id),
          userId:String(member.id),
          error:error?.stack??String(error)
        });
      });
    },1000).unref?.();
  }
});

client.on('guildMemberRemove',member=>{invalidateGuildPickerCache(member.guild.id);scheduleStructureSync(member.guild.id,'member-removed');});

async function initializeAfterReady(c){
  app.logger.info('Discord ready',{tag:c.user.tag,id:c.user.id});
  const guild=await c.guilds.fetch(app.env.GUILD_ID);
  await app.guilds.ensure({guildId:guild.id,name:guild.name,ownerUserId:app.env.OWNER_USER_ID});
  serverSync=new ServerSyncCoordinator({teamService:app.teamService,guild,actorId:app.env.OWNER_USER_ID,logger:app.logger});
  await serverSync.run('startup');
  await reconcileVoice(app,guild);
  await reconcileTeamRoleLinks(guild,app);
  membershipRoleService=new MembershipRoleService({db:app.db,logger:app.logger,env:app.env});
  membershipRoleService.start(guild);

  serverSync.start();
  app.backupScheduler.start();
  app.membershipReviewService?.start(guild);
  app.autopilotService?.start(guild);
  membershipActivityScheduler=new MembershipActivityScheduler({service:app.membershipActivityService,guild,logger:app.logger,ownerUserId:app.env.OWNER_USER_ID});
  membershipActivityScheduler.start();
  app.outputReliabilityService?.start(guild);
  app.systemHealthService?.start(c);
  writeHeartbeat('online',{tag:c.user.tag,guildId:guild.id});
  healthTimer=setInterval(()=>writeHeartbeat(client.isReady()?'online':'reconnecting'),30000);
  healthTimer.unref?.();
  console.log(`🟢 Meeting 967 Online: ${c.user.tag}`);
  console.log('🛡️ Runtime heartbeat: every 30 seconds');
  console.log('🔄 Server structure sync: automatic (startup + Discord events + every 5 minutes)');
  console.log('🤖 Meeting Autopilot: scheduler active (15-second loop)');
  console.log('📦 Output reliability: automatic recording/report/delivery reconciliation every 30 seconds');
}

client.once('clientReady',c=>{
  initializeAfterReady(c).catch(error=>{
    app.logger.error('startup-initialization-failed',{error:error?.stack??String(error)});
    shutdown('startup-initialization-failed',{exitCode:1}).catch(()=>process.exit(1));
  });
});

writeHeartbeat('logging-in');
try{
  await client.login(app.env.DISCORD_TOKEN);
}catch(error){
  app.logger.error('discord-login-failed',{error:error?.stack??String(error)});
  writeHeartbeat('login-failed',{lastError:error?.message??String(error)});
  throw error;
}
