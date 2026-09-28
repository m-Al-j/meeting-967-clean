import { pool } from './infrastructure/db/pool.js';
import { getAppEnv } from './config/env.js';
import { createLogger } from './utils/logger.js';
import { DraftStore } from './utils/draftStore.js';
import { RateLimiter } from './utils/rateLimiter.js';
import { GuildRepository } from './infrastructure/repositories/GuildRepository.js';
import { TeamRepository } from './infrastructure/repositories/TeamRepository.js';
import { MeetingRepository } from './infrastructure/repositories/MeetingRepository.js';
import { AttendanceRepository } from './infrastructure/repositories/AttendanceRepository.js';
import { ExcuseRepository } from './infrastructure/repositories/ExcuseRepository.js';
import { PermissionRepository } from './infrastructure/repositories/PermissionRepository.js';
import { AuditRepository } from './infrastructure/repositories/AuditRepository.js';
import { ReportRepository } from './infrastructure/repositories/ReportRepository.js';
import { RecordingRepository } from './infrastructure/repositories/RecordingRepository.js';
import { BackupRepository } from './infrastructure/repositories/BackupRepository.js';
import { TaskRepository } from './infrastructure/repositories/TaskRepository.js';
import { AutomationRepository } from './infrastructure/repositories/AutomationRepository.js';
import { OutputRepository } from './infrastructure/repositories/OutputRepository.js';
import { PermissionService } from './application/services/PermissionService.js';
import { AuditService } from './application/services/AuditService.js';
import { TeamService } from './application/services/TeamService.js';
import { AttendanceService } from './application/services/AttendanceService.js';
import { ExcuseService } from './application/services/ExcuseService.js';
import { MeetingService } from './application/services/MeetingService.js';
import { ReportService } from './application/services/ReportService.js';
import { RecordingService } from './application/services/RecordingService.js';
import { BackupService } from './application/services/BackupService.js';
import { BackupScheduler } from './application/services/BackupScheduler.js';
import { DeliveryService } from './application/services/DeliveryService.js';
import { TaskService } from './application/services/TaskService.js';
import { AutopilotService } from './application/services/AutopilotService.js';
import { OutputReliabilityService } from './application/services/OutputReliabilityService.js';
import { MemberSuggestionService } from './application/services/MemberSuggestionService.js';
import { MembershipActivityService } from './application/services/MembershipActivityService.js';
import { SupportRepository } from './infrastructure/repositories/SupportRepository.js';
import { OperationsRepository } from './infrastructure/repositories/OperationsRepository.js';
import { SupportService } from './application/services/SupportService.js';
import { AIAgentService } from './application/services/AIAgentService.js';
import { AIChatRoomService } from './application/services/AIChatRoomService.js';
import { OperationsService } from './application/services/OperationsService.js';
import { installFirstDmWelcome } from './application/services/FirstDmWelcome.js';
// test-lab-v1.9.3:app-import
import { TestLabService } from './application/services/TestLabService.js';
// operations967-system-health-center-v1:app
import { SystemHealthService } from './application/services/SystemHealthService.js';

import { MemberPerformanceService } from './application/services/MemberPerformanceService.js';
import { AIAssistantService } from './application/services/AIAssistantService.js';
import { PointsService } from './application/services/PointsService.js';
import { MembershipReviewService } from './application/services/MembershipReviewService.js';
export function buildApp(){
  const env=getAppEnv();
  const logger=createLogger(env.LOG_LEVEL);
  installFirstDmWelcome({db:pool,logger});
  const guilds=new GuildRepository(pool);
  const teams=new TeamRepository(pool);
  const meetings=new MeetingRepository(pool);
  const attendance=new AttendanceRepository(pool);
  const excuses=new ExcuseRepository(pool);
  const permissions=new PermissionRepository(pool);
  const auditRepo=new AuditRepository(pool);
  const reports=new ReportRepository(pool);
  const recordings=new RecordingRepository(pool);
  const backups=new BackupRepository(pool);
  const tasks=new TaskRepository(pool);
  const automation=new AutomationRepository(pool);
  const outputs=new OutputRepository(pool);
  const support=new SupportRepository(pool);
  const operations=new OperationsRepository(pool);
  const audit=new AuditService(auditRepo);
  const permissionService=new PermissionService({repo:permissions,ownerUserId:env.OWNER_USER_ID});
  const teamService=new TeamService({teams,guilds,audit});
  const attendanceService=new AttendanceService({attendance,excuses,audit});
  const excuseService=new ExcuseService({excuses,meetings,teams,audit});
  const reportService=new ReportService({meetings,attendance,reports,guilds,recordings,excuses,tasks,env});
  const recordingService=new RecordingService({recordings,env,logger});
  const deliveryService=new DeliveryService({permissionService,recordings,outputs,meetings,tasks,audit,ownerUserId:env.OWNER_USER_ID,logger});
  const taskService=new TaskService({tasks,teams,meetings,guilds,audit,logger,permissionService});
  const meetingService=new MeetingService({meetings,teams,guilds,audit,attendance:attendanceService,reportService,recordingService,deliveryService,taskService});
  const autopilotService=new AutopilotService({meetings,guilds,teams,tasks,automation,attendance,meetingService,recordingService,taskService,audit,logger,ownerUserId:env.OWNER_USER_ID,permissionService});
  const outputReliabilityService=new OutputReliabilityService({meetings,guilds,reports,recordings,outputs,reportService,recordingService,deliveryService,audit,logger,ownerUserId:env.OWNER_USER_ID});
  const backupService=new BackupService({repo:backups,env});
  const backupScheduler=new BackupScheduler({guilds,backups,backupService,env,logger});
  const memberSuggestionService=new MemberSuggestionService({logger});
  const membershipActivityService=new MembershipActivityService({db:pool,audit,env,logger});
  const supportService=new SupportService({support,audit,logger,ownerUserId:env.OWNER_USER_ID});
  const aiAgentService=new AIAgentService({db:pool,env,logger,permissionService,taskService,meetingService,teams,meetings,guilds});
  const aiChatRoomService=new AIChatRoomService({env,logger,aiAgentService:aiAgentService});
  const operationsService=new OperationsService({operations,audit,teams});
  // test-lab-v1.9.3:app-service
  const testLabService=new TestLabService({db:pool,meetings,teams,guilds,attendanceService,reportService,recordingService,env,logger});
  const systemHealthService=new SystemHealthService({db:pool,env,logger,recordingService,testLabService});
  const memberSyncAt=new Map();
  const memberSyncTtlMs=300_000;

  async function syncMember(guild,user){
    const key=`${guild.id}:${user.id}`;
    const now=Date.now();
    const last=memberSyncAt.get(key)??0;
    if(now-last<memberSyncTtlMs)return;
    memberSyncAt.set(key,now);
    try{
      const member=guild.members.cache.get(String(user.id))??await guild.members.fetch(user.id).catch(()=>null);
      await Promise.all([
        guilds.upsertUser({userId:user.id,username:user.username,displayName:member?.displayName??user.globalName??user.username}),
        guilds.ensureMember(guild.id,user.id)
      ]);
    }catch(error){
      memberSyncAt.delete(key);
      throw error;
    }
  }

    const memberPerformanceService=new MemberPerformanceService({db:pool,audit,env});
    const aiAssistantService=new AIAssistantService({db:pool,env,logger,permissionService});
  const pointsService=new PointsService({db:pool,audit,env,logger});
  const membershipReviewService=new MembershipReviewService({db:pool,audit,env,logger});
  return {
    aiAgentService,
    aiChatRoomService,
    aiAssistantService,
    membershipReviewService,memberPerformanceService,pointsService,
    env,logger,db:pool,guilds,teams,meetings,attendance,excuses,permissions,auditRepo,reports,recordings,backups,tasks,automation,outputs,support,operations,
    audit,permissionService,teamService,attendanceService,excuseService,taskService,reportService,recordingService,deliveryService,
    meetingService,autopilotService,outputReliabilityService,backupService,backupScheduler,memberSuggestionService,membershipActivityService,supportService,operationsService,
    // test-lab-v1.9.3:app-return
    testLabService,systemHealthService,drafts:new DraftStore(),rateLimiter:new RateLimiter(),syncMember
  };
}
