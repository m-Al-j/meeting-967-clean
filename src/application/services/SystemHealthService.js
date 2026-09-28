// operations967-system-health-center-v1:service
import fs from 'node:fs/promises';
import path from 'node:path';

const MB=1024*1024;

function bytes(value){
  const n=Number(value??0);
  return Number.isFinite(n)&&n>0?n:0;
}

function duration(seconds){
  let s=Math.max(0,Math.floor(Number(seconds)||0));
  const d=Math.floor(s/86400);s%=86400;
  const h=Math.floor(s/3600);s%=3600;
  const m=Math.floor(s/60);
  if(d)return `${d}ي ${h}س`;
  if(h)return `${h}س ${m}د`;
  return `${m}د`;
}

function configuredWorkers(){
  const result=[];
  const numbered=Object.keys(process.env)
    .map(key=>{
      const m=key.match(/^RECORDING_WORKER_TOKEN_(\d+)$/);
      return m?Number(m[1]):null;
    })
    .filter(Number.isFinite)
    .sort((a,b)=>a-b);

  for(const number of numbered){
    if(!String(process.env[`RECORDING_WORKER_TOKEN_${number}`]??'').trim())continue;
    result.push({
      number,
      teamScope:String(process.env[`RECORDING_WORKER_TEAM_${number}`]??'').trim()||'any',
    });
  }

  const legacy=String(process.env.RECORDING_WORKER_TOKENS??'')
    .split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
  let next=numbered.length?Math.max(...numbered)+1:1;
  for(const _ of legacy)result.push({number:next++,teamScope:'any'});
  return result;
}

function safeMessage(value){
  return String(value??'')
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi,'postgresql://[hidden]')
    .replace(/\b(?:Bot|Bearer)\s+[A-Za-z0-9._~+/=-]{20,}/gi,'[authorization hidden]')
    .replace(/(TOKEN|PASSWORD|SECRET|DATABASE_URL)\s*[:=]\s*[^\s,}]+/gi,'$1=[hidden]')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,500);
}

export class SystemHealthService{
  constructor({db,env,logger,recordingService,testLabService}){
    this.db=db;
    this.env=env;
    this.logger=logger;
    this.recordingService=recordingService;
    this.testLabService=testLabService;
    this.client=null;
    this.timer=null;
    this.lastIssueFingerprint=null;
    this.lastAlertAt=0;
  }

  async snapshot(client=this.client){
    const started=Date.now();
    const main={
      online:Boolean(client?.isReady?.()),
      pingMs:Number.isFinite(client?.ws?.ping)?Math.round(client.ws.ping):null,
      uptimeSeconds:Math.floor(process.uptime()),
      tag:client?.user?.tag??null,
      userId:client?.user?.id??null,
    };

    const dbStarted=Date.now();
    let database={ready:false,latencyMs:null,error:null};
    try{
      await this.db.query('SELECT 1');
      database={ready:true,latencyMs:Date.now()-dbStarted,error:null};
    }catch(error){
      database={ready:false,latencyMs:Date.now()-dbStarted,error:safeMessage(error?.message)};
    }

    const guildId=String(this.env.GUILD_ID??'');
    const pool=this.recordingService?.workerPool;
    await pool?.initializing?.catch?.(()=>{});
    const configured=configuredWorkers();
    const runtimeWorkers=Array.isArray(pool?.workers)?pool.workers:[];
    const busyValues=[...(pool?.busy?.values?.()??[])];

    const workers=configured.map(cfg=>{
      const runtime=runtimeWorkers.find(w=>Number(w.number)===Number(cfg.number));
      const lease=busyValues.find(x=>Number(x?.workerNumber)===Number(cfg.number));
      return {
        number:cfg.number,
        teamScope:String(runtime?.teamScope??cfg.teamScope??'any'),
        ready:Boolean(runtime?.client?.isReady?.()),
        pingMs:Number.isFinite(runtime?.client?.ws?.ping)?Math.round(runtime.client.ws.ping):null,
        tag:runtime?.client?.user?.tag??null,
        userId:runtime?.client?.user?.id??null,
        busy:Boolean(lease),
        meetingId:lease?.meetingId??null,
        leaseExpiresAt:lease?.expiresAt??null,
      };
    });

    const activeStates=[...(this.recordingService?.active?.values?.()??[])];
    const activeRecordings=activeStates.map(state=>({
      meetingId:state?.meeting?.id??state?.recording?.meeting_id??null,
      meetingName:String(state?.meeting?.name??state?.meeting?.title??'اجتماع').slice(0,120),
      recorderType:state?.recorderType??null,
      recorderKey:state?.recorderKey??null,
      workerNumber:state?.workerNumber??null,
      voiceChannelId:state?.meeting?.voice_channel_id??null,
      startedAt:state?.recording?.started_at??state?.startedAt??null,
    }));

    const mainRecorderKey=`main:${guildId}`;
    const mainBusy=Boolean(this.recordingService?.activeByGuild?.has?.(mainRecorderKey));
    const failover={
      ready:main.online&&!mainBusy,
      status:!main.online?'main-offline':mainBusy?'main-busy':'ready',
      mainBusy,
    };

    let meetings={ongoing:0,upcoming:0,nextAt:null};
    try{
      const {rows}=await this.db.query(`
        SELECT
          COUNT(*) FILTER(WHERE status='ongoing' AND COALESCE(is_test,false)=false)::int ongoing,
          COUNT(*) FILTER(WHERE status='upcoming' AND COALESCE(is_test,false)=false)::int upcoming,
          MIN(scheduled_at) FILTER(WHERE status='upcoming' AND COALESCE(is_test,false)=false) next_at
        FROM meetings WHERE guild_id=$1
      `,[guildId]);
      meetings={
        ongoing:Number(rows[0]?.ongoing??0),
        upcoming:Number(rows[0]?.upcoming??0),
        nextAt:rows[0]?.next_at??null,
      };
    }catch(error){
      meetings.error=safeMessage(error?.message);
    }

    let storage={
      ready:false,path:path.resolve(this.env.STORAGE_DIR||'storage'),
      totalBytes:null,freeBytes:null,freeRatio:null,recordedBytes:0,error:null,
    };
    try{
      await fs.mkdir(storage.path,{recursive:true});
      const stat=await fs.statfs(storage.path);
      const blockSize=Number(stat.bsize??stat.frsize??0);
      const totalBytes=bytes(Number(stat.blocks??0)*blockSize);
      const freeBytes=bytes(Number(stat.bavail??stat.bfree??0)*blockSize);
      storage={...storage,ready:true,totalBytes,freeBytes,freeRatio:totalBytes?freeBytes/totalBytes:null};
    }catch(error){
      storage.error=safeMessage(error?.message);
    }

    try{
      const {rows}=await this.db.query('SELECT COALESCE(SUM(bytes),0)::bigint AS bytes FROM recording_tracks');
      storage.recordedBytes=Number(rows[0]?.bytes??0);
    }catch{}

    const errors=await this.#logStats();

    let testLab=null;
    try{
      const last=await this.testLabService?.latestCompleted?.(guildId);
      if(last){
        testLab={
          status:last.status??null,
          teamName:last.team_name??null,
          completedAt:last.completed_at??last.updated_at??null,
          recorderKey:last.recorder_key??null,
          error:last.error?safeMessage(last.error):null,
        };
      }
    }catch{}

    const memory=process.memoryUsage();
    const processInfo={
      rssBytes:memory.rss,
      heapUsedBytes:memory.heapUsed,
      heapTotalBytes:memory.heapTotal,
      uptimeText:duration(process.uptime()),
    };

    const issues=[];
    if(!database.ready)issues.push({code:'database-offline',label:'PostgreSQL غير جاهز'});
    const offlineWorkers=workers.filter(w=>!w.ready);
    if(offlineWorkers.length){
      issues.push({
        code:'workers-offline',
        label:`Workers غير متصلين: ${offlineWorkers.map(w=>w.number).join(', ')}`,
      });
    }
    if(storage.ready && (
      (storage.freeRatio!=null&&storage.freeRatio<0.05) ||
      (storage.freeBytes!=null&&storage.freeBytes<512*MB)
    )){
      issues.push({code:'storage-low',label:'المساحة الحرة منخفضة'});
    }

    return {
      generatedAt:new Date().toISOString(),
      latencyMs:Date.now()-started,
      overall:issues.length?'degraded':'healthy',
      main,database,workers,
      workerSummary:{
        configured:workers.length,
        ready:workers.filter(w=>w.ready).length,
        busy:workers.filter(w=>w.busy).length,
      },
      failover,activeRecordings,meetings,storage,errors,testLab,processInfo,issues,
    };
  }

  async #logStats(){
    const file=path.resolve(process.env.MEETING967_LOG_FILE||'logs/meeting967.log');
    const result={
      file,
      errors1h:0,errors24h:0,warnings1h:0,warnings24h:0,
      lastErrorAt:null,lastErrorMessage:null,
    };
    try{
      const stat=await fs.stat(file);
      const max=2*MB;
      const length=Math.min(Number(stat.size)||0,max);
      if(!length)return result;
      const start=Math.max(0,(Number(stat.size)||0)-length);
      const handle=await fs.open(file,'r');
      try{
        const buffer=Buffer.alloc(length);
        await handle.read(buffer,0,length,start);
        const now=Date.now();
        for(const raw of buffer.toString('utf8').split(/\r?\n/)){
          const idx=raw.indexOf('{');
          if(idx<0)continue;
          let row;
          try{row=JSON.parse(raw.slice(idx));}catch{continue;}
          const ts=new Date(row.ts??row.timestamp??'').getTime();
          if(!Number.isFinite(ts))continue;
          const age=now-ts;
          const level=String(row.level??'').toLowerCase();
          if(level==='error'){
            if(age<=3600_000)result.errors1h++;
            if(age<=86400_000)result.errors24h++;
            if(!result.lastErrorAt || ts>new Date(result.lastErrorAt).getTime()){
              result.lastErrorAt=new Date(ts).toISOString();
              result.lastErrorMessage=safeMessage(row.message??'error');
            }
          }else if(level==='warn'){
            if(age<=3600_000)result.warnings1h++;
            if(age<=86400_000)result.warnings24h++;
          }
        }
      }finally{
        await handle.close().catch(()=>{});
      }
    }catch{}
    return result;
  }

  start(client){
    this.client=client;
    if(this.timer)return;
    const run=()=>this.#monitor().catch(error=>{
      this.logger?.warn?.('system-health-monitor-failed',{error:safeMessage(error?.message)});
    });
    const first=setTimeout(run,20_000);
    first.unref?.();
    this.timer=setInterval(run,60_000);
    this.timer.unref?.();
    this.logger?.info?.('system-health-monitor-started',{intervalMs:60_000});
  }

  stop(){
    if(this.timer)clearInterval(this.timer);
    this.timer=null;
    this.client=null;
  }

  async #monitor(){
    if(!this.client?.isReady?.())return;
    const snapshot=await this.snapshot(this.client);
    const fingerprint=snapshot.issues.map(x=>x.code+':'+x.label).sort().join('|');

    if(this.lastIssueFingerprint===null){
      this.lastIssueFingerprint=fingerprint;
      return;
    }
    if(fingerprint===this.lastIssueFingerprint)return;

    const previous=this.lastIssueFingerprint;
    this.lastIssueFingerprint=fingerprint;
    if(Date.now()-this.lastAlertAt<5*60_000)return;

    const ownerId=String(this.env.OWNER_USER_ID??'').trim();
    if(!ownerId)return;
    const owner=await this.client.users.fetch(ownerId).catch(()=>null);
    if(!owner)return;

    if(snapshot.issues.length){
      const text=[
        '⚠️ **تنبيه صحة Operations 967**',
        ...snapshot.issues.map(x=>`• ${x.label}`),
        '',
        `Workers: ${snapshot.workerSummary.ready}/${snapshot.workerSummary.configured}`,
        `PostgreSQL: ${snapshot.database.ready?'✅':'❌'}`,
        'افتح: `/panel` → مركز الاجتماعات → صحة النظام للتفاصيل.',
      ].join('\n');
      await owner.send({content:text.slice(0,1900)}).catch(()=>{});
      this.lastAlertAt=Date.now();
      this.logger?.warn?.('system-health-owner-alert',{issues:snapshot.issues.map(x=>x.code)});
    }else if(previous){
      await owner.send({
        content:'✅ **Operations 967 عاد إلى الحالة السليمة.**\nالمشاكل التشغيلية التي كان مركز الصحة يراقبها لم تعد موجودة.',
      }).catch(()=>{});
      this.lastAlertAt=Date.now();
      this.logger?.info?.('system-health-owner-recovery');
    }
  }
}
