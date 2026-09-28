import { DateTime } from 'luxon';

export class MembershipActivityScheduler {
  constructor({service,guild,logger,ownerUserId}){
    Object.assign(this,{service,guild,logger,ownerUserId});
    this.timer=null;
    this.running=false;
  }

  async tick(){
    if(this.running||!this.guild?.id) return;
    this.running=true;
    try{
      const zone=await this.service.timezone(this.guild.id);
      const now=DateTime.now().setZone(zone);

      if(now.day<=3){
        const result=await this.service.evaluatePreviousMonth({
          guildId:this.guild.id,
          actorId:this.ownerUserId
        });
        if(result?.evaluated){
          this.logger?.info?.('membership-monthly-evaluation-complete',{
            guildId:this.guild.id,
            evaluated:result.evaluated,
            notices:result.notices,
            periodStart:result.periodStart,
            periodEnd:result.periodEnd
          });
        }
      }

      const notices=await this.service.pendingNotices(this.guild.id,100);
      for(const notice of notices){
        const user=await this.guild.client.users.fetch(String(notice.user_id)).catch(()=>null);
        if(!user){
          await this.service.markNotice(notice.id,'failed');
          continue;
        }
        try{
          await user.send(`📋 **Meeting 967**\n\n${notice.message}`);
          await this.service.markNotice(notice.id,'sent');
        }catch(error){
          await this.service.markNotice(notice.id,'failed');
          this.logger?.warn?.('membership-notice-delivery-failed',{
            noticeId:notice.id,
            userId:String(notice.user_id),
            error:error?.message??String(error)
          });
        }
      }
    }catch(error){
      this.logger?.error?.('membership-activity-tick-failed',{
        error:error?.stack??String(error)
      });
    }finally{
      this.running=false;
    }
  }

  start(){
    if(this.timer) return;
    this.timer=setInterval(()=>this.tick().catch(()=>{}),60*60*1000);
    this.timer.unref?.();
    this.tick().catch(()=>{});
    this.logger?.info?.('membership-activity-scheduler-started',{
      intervalMinutes:60,
      mode:'monthly-evaluation-first-three-days'
    });
  }

  stop(){
    if(!this.timer) return;
    clearInterval(this.timer);
    this.timer=null;
    this.logger?.info?.('membership-activity-scheduler-stopped');
  }
}
