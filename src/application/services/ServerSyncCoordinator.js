export class ServerSyncCoordinator {
  constructor({teamService,guild,actorId,logger,debounceMs=3500,intervalMs=300000}){
    this.teamService=teamService;
    this.guild=guild;
    this.actorId=actorId;
    this.logger=logger;
    this.debounceMs=debounceMs;
    this.intervalMs=intervalMs;
    this.timer=null;
    this.interval=null;
    this.running=false;
    this.pending=false;
    this.lastResult=null;
    this.lastError=null;
  }

  async run(reason='automatic'){
    if(this.running){this.pending=true;return this.lastResult;}
    this.running=true;
    try{
      const refreshMembers=reason==='periodic-safety-check';
      const out=await this.teamService.autoImportFromGuild({guild:this.guild,actorId:this.actorId,refreshMembers});

      this.teamService._supportSyncActorId=String(this.actorId);

      const supportSync=await this.teamService.syncSupportRoleChannelAccess({
        guild:this.guild,
        reason:`Meeting 967 — automatic support-role channel sync by ${this.actorId}`
      }).catch(error=>({
        pairs:0,
        channels:0,
        updated:0,
        skipped:0,
        errors:1,
        error:String(error?.message??error)
      }));

      const result={
        ...out,
        supportPairs:supportSync.pairs??0,
        supportChannelsUpdated:supportSync.updated??0,
        supportChannelsScanned:supportSync.channels??0,
        supportSyncErrors:supportSync.errors??0
      };

      this.lastResult={...result,reason,at:new Date().toISOString()};
      this.lastError=null;

      console.log(
        `⚡ Auto sync [${reason}]: ` +
        `${out.teams} teams | ` +
        `${out.syncedMembers} all members | ` +
        `${out.mergedDuplicates??0} duplicates merged | ` +
        `${out.linkedVoice} voice | ` +
        `${out.linkedText} text | ` +
        `${out.errors?.length??0} warnings | ` +
        `${supportSync.updated??0} support channel grants`
      );

      return result;
    }catch(error){
      this.lastError={reason,message:error?.message??String(error),at:new Date().toISOString()};
      this.logger?.error?.('automatic server sync failed',{reason,error:error?.stack??String(error)});
      return null;
    }finally{
      this.running=false;
      if(this.pending){this.pending=false;this.schedule('pending-change',250);}
    }
  }

  schedule(reason='discord-structure-change',delayMs=this.debounceMs){
    if(this.timer)clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=null;void this.run(reason);},delayMs);
    this.timer.unref?.();
  }

  start(){
    if(this.interval)return;
    this.interval=setInterval(()=>void this.run('periodic-safety-check'),this.intervalMs);
    this.interval.unref?.();
  }

  stop(){
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    if(this.interval){clearInterval(this.interval);this.interval=null;}
  }
}
