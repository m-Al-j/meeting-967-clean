#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
VERSION="3.0.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/.update-backups/ai-agent-v${VERSION}-${STAMP}"
TEST_FILE="$ROOT/tests/ai-agent-v${VERSION}.test.js"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

[ -d "$ROOT" ] || die "لم أجد المشروع: $ROOT"
[ -f "$ROOT/package.json" ] || die "package.json غير موجود"
[ -f "$ROOT/src/app.js" ] || die "src/app.js غير موجود"
[ -f "$ROOT/src/interfaces/discord/router.js" ] || die "router.js غير موجود"
[ -f "$ROOT/src/interfaces/discord/interactions/misc.js" ] || die "misc.js غير موجود"
[ -f "$ROOT/src/interfaces/discord/interactionReliability.js" ] || die "interactionReliability.js غير موجود"
[ -f "$ROOT/src/interfaces/discord/commands/panel.js" ] || die "panel.js غير موجود"
[ -f "$ROOT/src/infrastructure/discord/commandDefinitions.js" ] || die "commandDefinitions.js غير موجود"

mkdir -p "$BACKUP_DIR/src/application/services" \
         "$BACKUP_DIR/src/interfaces/discord/commands" \
         "$BACKUP_DIR/src/interfaces/discord/interactions" \
         "$BACKUP_DIR/tests"

cd "$ROOT"

say "============================================================"
say " Meeting 967 — AI Agent v${VERSION}"
say " واجهة AI 967 مستقلة + محادثة + Tools + تأكيد + صلاحيات"
say "============================================================"

say "🛟 أخذ نسخة رجوع..."
for f in \
  src/application/services/AIAgentService.js \
  src/interfaces/discord/commands/ai.js \
  src/interfaces/discord/interactions/misc.js \
  src/interfaces/discord/interactionReliability.js \
  src/interfaces/discord/router.js \
  src/interfaces/discord/commands/panel.js \
  src/infrastructure/discord/commandDefinitions.js \
  src/app.js \
  package.json \
  package-lock.json \
  tests/ai-agent-v${VERSION}.test.js
do
  if [ -f "$ROOT/$f" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp -a "$ROOT/$f" "$BACKUP_DIR/$f"
  fi
done

say "📦 تثبيت Gemini SDK الرسمي..."
npm install @google/genai

say "🧠 إنشاء محرك AI Agent..."
cat > "$ROOT/src/application/services/AIAgentService.js" <<'JS'
import {GoogleGenAI} from '@google/genai';
import {DateTime} from 'luxon';
import {parseLocalDateTime} from '../../utils/time.js';
import {AppError} from '../../core/errors/AppError.js';

const MAX_HISTORY=16;
const MAX_OUTPUT=2200;
const PENDING_TTL=10*60_000;

function clean(value,max=2400){
  return String(value??'')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,' ')
    .trim()
    .slice(0,max);
}
function norm(value){
  return clean(value,500)
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u064B-\u065F\u0670]/g,'')
    .replace(/[أإآٱ]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/ؤ/g,'و')
    .replace(/ئ/g,'ي')
    .replace(/ـ/g,'')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function clip(value,max=MAX_OUTPUT){
  const s=String(value??'').trim();
  return s.length>max?s.slice(0,max-1)+'…':s;
}
function json(value){
  try{return JSON.stringify(value,null,2).slice(0,18000);}
  catch{return String(value??'').slice(0,18000);}
}
function fmt(value,zone='Asia/Aden'){
  if(!value)return 'غير محدد';
  const dt=DateTime.fromJSDate(new Date(value),{zone});
  return dt.isValid?dt.toFormat("yyyy-MM-dd HH:mm"):String(value);
}

const TOOL_DECLARATIONS=[
  {
    name:'list_teams',
    description:'اعرض الفرق النشطة في سيرفر Meeting 967 لاستخدام أسماء الفرق الصحيحة.',
    parameters:{type:'OBJECT',properties:{},required:[]},
  },
  {
    name:'find_member',
    description:'ابحث عن عضو داخل فريق بالاسم أو اسم المستخدم. استخدمه قبل إنشاء مهمة عندما يذكر المستخدم شخصًا.',
    parameters:{
      type:'OBJECT',
      properties:{
        teamName:{type:'STRING',description:'اسم الفريق'},
        memberName:{type:'STRING',description:'اسم العضو أو اسم المستخدم كما هو مكتوب'},
      },
      required:['teamName','memberName'],
    },
  },
  {
    name:'list_meetings',
    description:'اعرض الاجتماعات القادمة في 967، ويمكن تحديد فريق.',
    parameters:{
      type:'OBJECT',
      properties:{
        teamName:{type:'STRING',description:'اسم الفريق بشكل اختياري'},
        limit:{type:'INTEGER',description:'عدد النتائج، بحد أقصى 15'},
      },
      required:[],
    },
  },
  {
    name:'list_tasks',
    description:'اعرض مهام المستخدم الحالية أو مهام فريق معيّن. النتائج تتضمن معرف المهمة داخليًا ليستعمله الوكيل في التعديل.',
    parameters:{
      type:'OBJECT',
      properties:{
        scope:{type:'STRING',enum:['mine','team'],description:'mine لمهامي أو team لمهام فريق'},
        teamName:{type:'STRING',description:'اسم الفريق عند scope=team'},
        status:{type:'STRING',enum:['all','open','done','cancelled'],description:'فلتر الحالة'},
        limit:{type:'INTEGER',description:'عدد النتائج بحد أقصى 20'},
      },
      required:['scope'],
    },
  },
  {
    name:'get_personal_context',
    description:'اعرض ملخص العضو الحالي: الاجتماعات والمهام والصلاحيات والعضوية والنقاط إن كانت متاحة للنظام.',
    parameters:{type:'OBJECT',properties:{},required:[]},
  },
  {
    name:'create_task',
    description:'اطلب إنشاء مهمة جديدة. هذه أداة تنفيذية حساسة؛ التطبيق سيطلب تأكيد المستخدم قبل التنفيذ.',
    parameters:{
      type:'OBJECT',
      properties:{
        teamName:{type:'STRING',description:'الفريق الذي تتبع له المهمة'},
        meetingId:{type:'STRING',description:'معرف الاجتماع إذا كانت مرتبطة باجتماع، أو اتركه فارغًا'},
        title:{type:'STRING',description:'عنوان المهمة'},
        description:{type:'STRING',description:'تفاصيل المهمة والتعليمات'},
        assigneeName:{type:'STRING',description:'اسم الشخص المكلف بالمهمة'},
        dueAt:{type:'STRING',description:'الموعد النهائي بصيغة YYYY-MM-DD HH:mm حسب توقيت النظام'},
      },
      required:['teamName','title','assigneeName'],
    },
  },
  {
    name:'update_task',
    description:'اطلب تعديل مهمة موجودة. هذه أداة تنفيذية حساسة وتحتاج تأكيدًا.',
    parameters:{
      type:'OBJECT',
      properties:{
        taskId:{type:'STRING',description:'معرف المهمة من نتائج list_tasks'},
        title:{type:'STRING',description:'العنوان الجديد اختياري'},
        description:{type:'STRING',description:'التفاصيل الجديدة اختياري'},
        dueAt:{type:'STRING',description:'الموعد النهائي الجديد YYYY-MM-DD HH:mm اختياري'},
      },
      required:['taskId'],
    },
  },
  {
    name:'set_task_status',
    description:'اطلب تغيير حالة مهمة موجودة. التنفيذ يحتاج تأكيدًا وصلاحية مناسبة.',
    parameters:{
      type:'OBJECT',
      properties:{
        taskId:{type:'STRING',description:'معرف المهمة'},
        status:{type:'STRING',enum:['pending','in_progress','done','cancelled'],description:'الحالة الجديدة'},
      },
      required:['taskId','status'],
    },
  },
  {
    name:'create_meeting',
    description:'اطلب إنشاء اجتماع جديد لفريق. التطبيق سيطلب تأكيد المستخدم قبل الإنشاء.',
    parameters:{
      type:'OBJECT',
      properties:{
        teamName:{type:'STRING',description:'اسم الفريق'},
        name:{type:'STRING',description:'اسم الاجتماع'},
        description:{type:'STRING',description:'وصف الاجتماع'},
        scheduledAt:{type:'STRING',description:'موعد الاجتماع بصيغة YYYY-MM-DD HH:mm حسب توقيت النظام'},
      },
      required:['teamName','name','scheduledAt'],
    },
  },
  {
    name:'reschedule_meeting',
    description:'اطلب تغيير موعد اجتماع قائم. التنفيذ يحتاج تأكيدًا.',
    parameters:{
      type:'OBJECT',
      properties:{
        meetingId:{type:'STRING',description:'معرف الاجتماع من نتائج list_meetings'},
        scheduledAt:{type:'STRING',description:'الموعد الجديد YYYY-MM-DD HH:mm'},
      },
      required:['meetingId','scheduledAt'],
    },
  },
  {
    name:'cancel_meeting',
    description:'اطلب إلغاء اجتماع قائم. التنفيذ يحتاج تأكيدًا.',
    parameters:{
      type:'OBJECT',
      properties:{
        meetingId:{type:'STRING',description:'معرف الاجتماع'},
        reason:{type:'STRING',description:'سبب الإلغاء'},
      },
      required:['meetingId','reason'],
    },
  },
];

const WRITE_TOOLS=new Set([
  'create_task','update_task','set_task_status',
  'create_meeting','reschedule_meeting','cancel_meeting',
]);

export class AIAgentService{
  constructor({db,env,logger,permissionService,taskService,meetingService,teams,meetings,guilds}){
    Object.assign(this,{db,env,logger,permissionService,taskService,meetingService,teams,meetings,guilds});
    this.client=null;
    this.sessions=new Map();
    this.pending=new Map();
  }

  enabled(){return Boolean(String(this.env?.GEMINI_API_KEY??process.env.GEMINI_API_KEY??'').trim());}
  model(){return String(this.env?.GEMINI_MODEL??process.env.GEMINI_MODEL??'gemini-3.8-flash').trim();}
  key(subject){return `${subject.guildId}:${subject.userId}`;}

  _client(){
    if(!this.enabled())return null;
    if(!this.client)this.client=new GoogleGenAI({apiKey:String(this.env.GEMINI_API_KEY??process.env.GEMINI_API_KEY).trim()});
    return this.client;
  }

  reset(subject){
    this.sessions.delete(this.key(subject));
    this.pending.delete(this.key(subject));
  }

  history(subject){return this.sessions.get(this.key(subject))??[];}

  push(subject,role,text){
    const key=this.key(subject);
    const next=[...this.history(subject),{role,text:clean(text,5000)}];
    this.sessions.set(key,next.slice(-MAX_HISTORY));
  }

  async query(sql,args=[]){
    try{return (await this.db.query(sql,args)).rows??[];}
    catch(error){
      this.logger?.debug?.('ai-agent-query-failed',{error:error?.message??String(error)});
      throw new AppError('AI_DATA_FAILED','تعذر قراءة البيانات المطلوبة من قاعدة البيانات.');
    }
  }

  async teamByName(guildId,name){
    const wanted=norm(name);
    const rows=await this.teams.list(guildId);
    const exact=rows.find(x=>norm(x.name)===wanted);
    if(exact)return exact;
    const hits=rows.filter(x=>norm(x.name).includes(wanted)||wanted.includes(norm(x.name)));
    if(hits.length===1)return hits[0];
    if(!hits.length)throw new AppError('AI_TEAM_NOT_FOUND',`لم أجد فريقًا باسم ${name}.`);
    throw new AppError('AI_TEAM_AMBIGUOUS',`اسم الفريق غير واضح: ${hits.map(x=>x.name).join('، ')}.`);
  }

  async memberByName(teamId,name){
    const wanted=norm(name);
    const members=await this.teams.members(teamId);
    const exact=members.find(x=>norm(x.display_name)===wanted);
    if(exact)return exact;
    const hits=members.filter(x=>norm(x.display_name).includes(wanted)||wanted.includes(norm(x.display_name)));
    if(hits.length===1)return hits[0];
    if(!hits.length)throw new AppError('AI_MEMBER_NOT_FOUND',`لم أجد عضوًا باسم ${name} داخل الفريق.`);
    throw new AppError('AI_MEMBER_AMBIGUOUS',`وجدت أكثر من عضو مطابق: ${hits.map(x=>x.display_name).join('، ')}.`);
  }

  async resolveZone(subject){
    const settings=await this.guilds.getSettings(subject.guildId).catch(()=>null);
    return String(settings?.timezone||this.env?.TIMEZONE||'Asia/Aden');
  }

  async personalContext(subject){
    const guildId=String(subject.guildId),userId=String(subject.userId);
    const [teams,meetings,tasks,membership,points,grants]=await Promise.all([
      this.query(`SELECT t.id,t.name
        FROM team_members tm JOIN teams t ON t.id=tm.team_id
        WHERE tm.guild_id=$1 AND tm.user_id=$2 AND tm.active=true
          AND t.active=true AND t.deleted_at IS NULL ORDER BY t.name`,[guildId,userId]),
      this.query(`SELECT m.id,m.name,m.scheduled_at,m.status,t.name AS team_name
        FROM meetings m JOIN teams t ON t.id=m.team_id
        JOIN team_members tm ON tm.team_id=t.id AND tm.guild_id=m.guild_id AND tm.user_id=$2 AND tm.active=true
        WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false
          AND m.status IN ('upcoming','ongoing') AND m.scheduled_at>=now()
        ORDER BY m.scheduled_at ASC LIMIT 8`,[guildId,userId]),
      this.query(`SELECT mt.id,mt.title,mt.status,mt.review_status,mt.due_at,t.name AS team_name
        FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id
        WHERE mt.guild_id=$1 AND mt.assignee_user_id=$2 AND t.deleted_at IS NULL
        ORDER BY COALESCE(mt.due_at,mt.created_at) ASC LIMIT 12`,[guildId,userId]),
      this.query(`SELECT status,return_at,withdrawn_at,reactivation_requested_at,reactivation_status,freeze_reason,withdraw_reason
        FROM membership_personal_states WHERE guild_id=$1 AND user_id=$2 LIMIT 1`,[guildId,userId]),
      this.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE amount>0 AND point_type<>'admin_adjustment'),0)::bigint AS points
        FROM membership_points_ledger WHERE guild_id=$1 AND user_id=$2`,[guildId,userId]).catch(()=>[]),
      this.permissionService.grants(subject).catch(()=>[]),
    ]);
    return {
      teams:teams.map(x=>({id:x.id,name:x.name})),
      meetings:meetings.map(x=>({id:x.id,name:x.name,team:x.team_name,when:x.scheduled_at,status:x.status})),
      tasks:tasks.map(x=>({id:x.id,title:x.title,team:x.team_name,status:x.status,review:x.review_status??null,due:x.due_at})),
      membership:membership[0]??null,
      points:Number(points[0]?.points??0),
      permissions:[...new Set(grants.filter(x=>String(x.effect)==='allow').map(x=>String(x.permission_key??'')).filter(Boolean))],
    };
  }

  async executeReadTool(name,args,subject){
    const zone=await this.resolveZone(subject);

    switch(name){
      case 'list_teams':{
        const rows=await this.teams.list(subject.guildId);
        return rows.map(x=>({name:x.name,memberCount:Number(x.member_count??0),defaultVoiceChannelId:x.default_voice_channel_id??null}));
      }

      case 'find_member':{
        const team=await this.teamByName(subject.guildId,args.teamName);
        const members=await this.teams.members(team.id);
        const wanted=norm(args.memberName);
        const hits=members
          .filter(x=>norm(x.display_name).includes(wanted)||wanted.includes(norm(x.display_name)))
          .slice(0,10);
        return {team:team.name,members:hits};
      }

      case 'list_meetings':{
        const team=args.teamName?await this.teamByName(subject.guildId,args.teamName):null;
        const rows=team
          ? await this.query(`SELECT m.id,m.name,m.description,m.scheduled_at,m.status,t.name AS team_name
              FROM meetings m JOIN teams t ON t.id=m.team_id
              WHERE m.guild_id=$1 AND m.team_id=$2 AND COALESCE(m.is_test,false)=false
                AND m.status IN ('upcoming','ongoing','postponed')
              ORDER BY m.scheduled_at ASC LIMIT $3`,[subject.guildId,team.id,Math.min(Number(args.limit)||10,15)])
          : await this.query(`SELECT m.id,m.name,m.description,m.scheduled_at,m.status,t.name AS team_name
              FROM meetings m JOIN teams t ON t.id=m.team_id
              WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false
                AND m.status IN ('upcoming','ongoing','postponed')
              ORDER BY m.scheduled_at ASC LIMIT $2`,[subject.guildId,Math.min(Number(args.limit)||10,15)]);
        return rows.map(x=>({...x,scheduled_at:fmt(x.scheduled_at,zone)}));
      }

      case 'list_tasks':{
        const limit=Math.min(Number(args.limit)||15,20);
        if(args.scope==='team'){
          const team=await this.teamByName(subject.guildId,args.teamName);
          await this.permissionService.assert(subject,'tasks.view',{teamId:team.id});
          let extra='';
          const p=[subject.guildId,team.id];
          if(args.status==='open')extra=` AND mt.status IN ('pending','in_progress')`;
          if(args.status==='done')extra=` AND mt.status='done'`;
          if(args.status==='cancelled')extra=` AND mt.status='cancelled'`;
          p.push(limit);
          return (await this.query(`SELECT mt.id,mt.title,mt.status,mt.review_status,mt.due_at,
                COALESCE(u.display_name,u.username,mt.assignee_user_id::text) AS assignee,t.name AS team_name
              FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id
              LEFT JOIN users u ON u.id=mt.assignee_user_id
              WHERE mt.guild_id=$1 AND mt.team_id=$2${extra}
              ORDER BY mt.due_at NULLS LAST,mt.created_at DESC LIMIT $3`,p))
              .map(x=>({...x,due_at:fmt(x.due_at,zone)}));
        }
        const rows=await this.taskService.listForUser?.(subject.guildId,subject.userId,{limit,activeOnly:false})
          ?? await this.query(`SELECT mt.id,mt.title,mt.status,mt.review_status,mt.due_at,t.name AS team_name
              FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id
              WHERE mt.guild_id=$1 AND mt.assignee_user_id=$2
              ORDER BY mt.due_at NULLS LAST,mt.created_at DESC LIMIT $3`,[subject.guildId,subject.userId,limit]);
        return rows.map(x=>({...x,due_at:fmt(x.due_at,zone)}));
      }

      case 'get_personal_context':
        return await this.personalContext(subject);

      default:
        throw new AppError('AI_TOOL_UNKNOWN','الأداة المطلوبة غير معروفة.');
    }
  }

  async permission(subject,key,context={}){
    await this.permissionService.assert(subject,key,context);
    return true;
  }

  async buildPending(name,args,subject){
    const zone=await this.resolveZone(subject);
    const base={name,args:{...args},createdAt:Date.now(),expiresAt:Date.now()+PENDING_TTL,subjectKey:this.key(subject)};
    if(name==='create_task'){
      const team=await this.teamByName(subject.guildId,args.teamName);
      await this.permission(subject,'tasks.manage',{teamId:team.id});
      const member=await this.memberByName(team.id,args.assigneeName);
      const dueAt=args.dueAt?parseLocalDateTime(String(args.dueAt),zone):null;
      if(args.meetingId){
        const meeting=await this.meetings.get(args.meetingId);
        if(!meeting||String(meeting.team_id)!==String(team.id))throw new AppError('AI_MEETING_SCOPE','الاجتماع لا يتبع الفريق المحدد.');
      }
      return {
        ...base,
        summary:'إنشاء مهمة',
        payload:{teamId:team.id,teamName:team.name,meetingId:args.meetingId||null,title:clean(args.title,180),description:clean(args.description||'',1800),assigneeUserId:member.user_id,assigneeName:member.display_name,dueAt},
      };
    }

    if(name==='update_task'){
      const task=(await this.query(`SELECT mt.*,t.name AS team_name FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id WHERE mt.id=$1 AND mt.guild_id=$2 LIMIT 1`,[args.taskId,subject.guildId]))[0];
      if(!task)throw new AppError('TASK_NOT_FOUND','المهمة غير موجودة.');
      await this.permission(subject,'tasks.manage',{teamId:task.team_id,meetingId:task.meeting_id||undefined});
      const dueAt=args.dueAt?parseLocalDateTime(String(args.dueAt),zone):undefined;
      return {...base,summary:'تعديل مهمة',payload:{taskId:task.id,oldTitle:task.title,title:args.title?clean(args.title,180):undefined,description:args.description!==undefined?clean(args.description,1800):undefined,dueAt}};
    }

    if(name==='set_task_status'){
      const task=(await this.query(`SELECT mt.*,t.name AS team_name FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id WHERE mt.id=$1 AND mt.guild_id=$2 LIMIT 1`,[args.taskId,subject.guildId]))[0];
      if(!task)throw new AppError('TASK_NOT_FOUND','المهمة غير موجودة.');
      await this.permission(subject,'tasks.manage',{teamId:task.team_id,meetingId:task.meeting_id||undefined});
      return {...base,summary:'تغيير حالة مهمة',payload:{taskId:task.id,title:task.title,status:args.status}};
    }

    if(name==='create_meeting'){
      const team=await this.teamByName(subject.guildId,args.teamName);
      await this.permission(subject,'meetings.create',{teamId:team.id});
      const settings=await this.guilds.getSettings(subject.guildId).catch(()=>null);
      const scheduledAt=parseLocalDateTime(String(args.scheduledAt),String(settings?.timezone||this.env?.TIMEZONE||'Asia/Aden'));
      if(new Date(scheduledAt).getTime()<Date.now()-5*60_000)throw new AppError('AI_MEETING_PAST','موعد الاجتماع قديم.');
      const voiceChannelId=team.default_voice_channel_id;
      if(!voiceChannelId)throw new AppError('AI_VOICE_MISSING','هذا الفريق لا يملك قناة صوتية افتراضية مرتبطة.');
      return {...base,summary:'إنشاء اجتماع',payload:{teamId:team.id,teamName:team.name,name:clean(args.name,120),description:clean(args.description||'',1500),scheduledAt,voiceChannelId}};
    }

    if(name==='reschedule_meeting'){
      const meeting=await this.meetings.get(args.meetingId);
      if(!meeting)throw new AppError('MEETING_NOT_FOUND','الاجتماع غير موجود.');
      await this.permission(subject,'meetings.edit',{teamId:meeting.team_id,meetingId:meeting.id});
      if(!['upcoming','postponed'].includes(String(meeting.status)))throw new AppError('MEETING_STATE','لا يمكن تغيير موعد اجتماع بدأ أو انتهى.');
      const settings=await this.guilds.getSettings(subject.guildId).catch(()=>null);
      const scheduledAt=parseLocalDateTime(String(args.scheduledAt),String(settings?.timezone||this.env?.TIMEZONE||'Asia/Aden'));
      return {...base,summary:'تغيير موعد اجتماع',payload:{meetingId:meeting.id,name:meeting.name,teamName:meeting.team_name,scheduledAt}};
    }

    if(name==='cancel_meeting'){
      const meeting=await this.meetings.get(args.meetingId);
      if(!meeting)throw new AppError('MEETING_NOT_FOUND','الاجتماع غير موجود.');
      await this.permission(subject,'meetings.cancel',{teamId:meeting.team_id,meetingId:meeting.id});
      return {...base,summary:'إلغاء اجتماع',payload:{meetingId:meeting.id,name:meeting.name,teamName:meeting.team_name,reason:clean(args.reason,800)}};
    }

    throw new AppError('AI_TOOL_UNKNOWN','لا يمكن تجهيز هذه العملية.');
  }

  storePending(subject,item){
    const key=this.key(subject);
    const token=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    this.pending.set(`${key}:${token}`,{...item,token});
    return token;
  }

  getPending(subject,token){
    const item=this.pending.get(`${this.key(subject)}:${token}`);
    if(!item)return null;
    if(item.expiresAt<Date.now()){
      this.pending.delete(`${this.key(subject)}:${token}`);
      return null;
    }
    return item;
  }

  async confirm(subject,token){
    const item=this.getPending(subject,token);
    if(!item)throw new AppError('AI_PENDING_EXPIRED','انتهت صلاحية العملية. أرسل الطلب من جديد.');
    const p=item.payload;
    let result;

    switch(item.name){
      case 'create_task':
        result=await this.taskService.create({
          guildId:subject.guildId,teamId:p.teamId,meetingId:p.meetingId,
          title:p.title,description:p.description,assigneeUserId:p.assigneeUserId,
          dueAt:p.dueAt,actorId:subject.userId,guild:subject.guild,
        });
        break;

      case 'update_task':{
        const task=(await this.query(`SELECT mt.*,t.name AS team_name FROM meeting_tasks mt JOIN teams t ON t.id=mt.team_id WHERE mt.id=$1 AND mt.guild_id=$2 LIMIT 1`,[p.taskId,subject.guildId]))[0];
        if(!task)throw new AppError('TASK_NOT_FOUND','المهمة غير موجودة.');
        const patch={};
        if(p.title!==undefined)patch.title=p.title;
        if(p.description!==undefined)patch.description=p.description;
        if(p.dueAt!==undefined)patch.dueAt=p.dueAt;
        if(patch.title!==undefined||patch.description!==undefined||patch.dueAt!==undefined){
          const entries=[]; const values=[];
          if(patch.title!==undefined){entries.push(`title=$${values.length+2}`);values.push(patch.title);}
          if(patch.description!==undefined){entries.push(`description=$${values.length+2}`);values.push(patch.description);}
          if(patch.dueAt!==undefined){entries.push(`due_at=$${values.length+2}`);values.push(patch.dueAt);}
          const updated=(await this.db.query(`UPDATE meeting_tasks SET ${entries.join(', ')},updated_at=now() WHERE id=$1 AND guild_id=$${values.length+2} RETURNING *`,[p.taskId,...values,subject.guildId])).rows[0];
          if(!updated)throw new AppError('TASK_NOT_FOUND','المهمة غير موجودة.');
          await this.logger?.info?.('ai-agent-task-updated',{taskId:p.taskId,actorId:subject.userId});
          result=updated;
        }else result=task;
        break;
      }

      case 'set_task_status':
        result=await this.taskService.setStatus({taskId:p.taskId,status:p.status,actorId:subject.userId,guildId:subject.guildId,allowAssignee:false});
        break;

      case 'create_meeting':
        result=await this.meetingService.create({
          guildId:subject.guildId,teamId:p.teamId,name:p.name,description:p.description,
          scheduledAt:p.scheduledAt,voiceChannelId:p.voiceChannelId,actorId:subject.userId,
        });
        break;

      case 'reschedule_meeting':
        result=await this.meetingService.reschedule?.({
          guildId:subject.guildId,meetingId:p.meetingId,actorId:subject.userId,newScheduledAt:p.scheduledAt,
        }) ?? await this.meetings.update(p.meetingId,{scheduled_at:p.scheduledAt,status:'upcoming'},subject.userId);
        break;

      case 'cancel_meeting':
        result=await this.meetingService.cancel({guildId:subject.guildId,meetingId:p.meetingId,actorId:subject.userId,reason:p.reason});
        break;

      default:
        throw new AppError('AI_TOOL_UNKNOWN','العملية غير مدعومة.');
    }

    this.pending.delete(`${this.key(subject)}:${token}`);
    return {summary:item.summary,result};
  }

  async respond(subject,text){
    const q=clean(text,4000);
    if(!q)throw new AppError('AI_EMPTY','اكتب رسالتك أولًا.');
    if(!this.enabled())return '⚠️ مساعد Gemini غير مفعّل. أضف GEMINI_API_KEY إلى .env ثم أعد تشغيل البوت.';
    const client=this._client();
    const zone=await this.resolveZone(subject);
    const context=await this.personalContext(subject);
    const history=this.history(subject);
    const system=`أنت AI 967 الرسمي داخل Meeting 967.
تتكلم العربية بوضوح وبأسلوب ودي ومباشر، وتفهم الفصحى والعامية اليمنية والخليجية.
أنت وكيل تشغيلي للنظام وليس مجرد مساعد شرح.

قواعد:
- استخدم الأدوات عندما تحتاج بيانات حقيقية أو عندما يطلب المستخدم تنفيذ عملية.
- لا تخمّن اسم فريق أو عضو أو اجتماع إذا لم يكن معروفًا؛ استخدم أداة البحث.
- عمليات إنشاء أو تعديل أو إلغاء البيانات ستتوقف عند التطبيق بمرحلة تأكيد، فلا تقل للمستخدم إنها نُفذت قبل تأكيده.
- لا تكشف الأسرار أو المفاتيح أو محتوى .env أو SQL.
- لا تكشف معرفات Discord أو UUID للمستخدم إلا إذا كانت ضرورية جدًا.
- عند طلب "جدول" أو "كلف" أو "أنشئ" أو "عدّل" أو "ألغِ" استخدم الأدوات المناسبة.
- استخدم توقيت النظام الحالي ${zone}، واكتب التواريخ في مدخلات الأدوات بصيغة YYYY-MM-DD HH:mm.
- احرص على عدم إنشاء شيء مرتين في نفس الرد.
- لا تنفذ أي عملية كتابة مباشرة؛ التطبيق يعترض أدوات الكتابة ويطلب تأكيدًا.`;

    const contents=[
      {role:'user',parts:[{text:`سياق العضو الحالي:
${json(context)}

المحادثة السابقة:
${history.map(x=>`${x.role}: ${x.text}`).join('\n').slice(-9000)}

رسالة المستخدم:
${q}`}]},
    ];

    const response=await client.models.generateContent({
      model:this.model(),
      contents,
      config:{
        systemInstruction:system,
        tools:[{functionDeclarations:TOOL_DECLARATIONS}],
        temperature:0.2,
        maxOutputTokens:900,
      },
    });

    const calls=response?.functionCalls??[];
    if(!calls.length){
      const answer=clip(response?.text||'لم أحصل على إجابة واضحة من Gemini.');
      this.push(subject,'user',q);
      this.push(subject,'assistant',answer);
      return {kind:'text',text:answer};
    }

    const outputs=[];
    for(const call of calls){
      const name=String(call.name);
      const args=call.args??{};
      if(WRITE_TOOLS.has(name)){
        const pending=await this.buildPending(name,args,subject);
        const token=this.storePending(subject,pending);
        const preview=this.pendingPreview(pending);
        const msg=`${preview}\n\nهل تريد تنفيذ العملية؟`;
        this.push(subject,'user',q);
        this.push(subject,'assistant',msg);
        return {kind:'confirmation',text:msg,token,pending};
      }
      const result=await this.executeReadTool(name,args,subject);
      outputs.push(`${name}: ${json(result)}`);
    }

    const follow=await client.models.generateContent({
      model:this.model(),
      contents:[
        {role:'user',parts:[{text:`سؤال المستخدم:
${q}

نتائج الأدوات الفعلية:
${outputs.join('\n').slice(0,16000)}

اكتب جوابًا عربيًا مباشرًا اعتمادًا على هذه النتائج فقط.`}]},
      ],
      config:{systemInstruction:system,temperature:0.2,maxOutputTokens:800},
    });
    const answer=clip(follow?.text||outputs.join('\n'));
    this.push(subject,'user',q);
    this.push(subject,'assistant',answer);
    return {kind:'text',text:answer};
  }

  pendingPreview(item){
    const p=item.payload;
    switch(item.name){
      case 'create_task':
        return `📝 **إنشاء مهمة**
**العنوان:** ${p.title}
**الفريق:** ${p.teamName}
**المكلف:** ${p.assigneeName}
**التفاصيل:** ${p.description||'لا توجد تفاصيل'}
**الموعد النهائي:** ${p.dueAt?new Date(p.dueAt).toLocaleString('ar-SA'):'غير محدد'}`;
      case 'update_task':
        return `✏️ **تعديل مهمة**
**المهمة:** ${p.oldTitle}
${p.title!==undefined?`**العنوان الجديد:** ${p.title}\n`:''}${p.description!==undefined?`**التفاصيل الجديدة:** ${p.description}\n`:''}${p.dueAt!==undefined?`**الموعد الجديد:** ${new Date(p.dueAt).toLocaleString('ar-SA')}`:''}`;
      case 'set_task_status':
        return `🔄 **تغيير حالة مهمة**
**المهمة:** ${p.title}
**الحالة الجديدة:** ${p.status}`;
      case 'create_meeting':
        return `📅 **إنشاء اجتماع**
**الاجتماع:** ${p.name}
**الفريق:** ${p.teamName}
**الموعد:** ${new Date(p.scheduledAt).toLocaleString('ar-SA')}
**الوصف:** ${p.description||'لا يوجد'}`;
      case 'reschedule_meeting':
        return `🗓️ **تغيير موعد اجتماع**
**الاجتماع:** ${p.name}
**الفريق:** ${p.teamName}
**الموعد الجديد:** ${new Date(p.scheduledAt).toLocaleString('ar-SA')}`;
      case 'cancel_meeting':
        return `🛑 **إلغاء اجتماع**
**الاجتماع:** ${p.name}
**الفريق:** ${p.teamName}
**السبب:** ${p.reason}`;
      default:return 'عملية تحتاج تأكيد.';
    }
  }
}
JS

say "💬 إنشاء واجهة Chat مستقلة..."
cat > "$ROOT/src/interfaces/discord/commands/ai.js" <<'JS'
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,EmbedBuilder} from 'discord.js';
import {AppError} from '../../../core/errors/AppError.js';
import {subjectFromInteraction} from '../context.js';

function modal(){
  return new ModalBuilder().setCustomId('ai:message').setTitle('AI 967')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('ai_text').setLabel('اكتب رسالتك').setStyle(TextInputStyle.Paragraph)
        .setRequired(true).setMaxLength(1800).setPlaceholder('مثال: كلف أحمد بمهمة تجهيز تقرير العضوية موعدها بعد 3 أيام')
    ));
}

function buttons(){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ai:message').setLabel('إرسال رسالة').setStyle(ButtonStyle.Primary).setEmoji('💬'),
    new ButtonBuilder().setCustomId('ai:new').setLabel('محادثة جديدة').setStyle(ButtonStyle.Secondary).setEmoji('🗑️'),
    new ButtonBuilder().setCustomId('ai:context').setLabel('سياقي').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
    new ButtonBuilder().setCustomId('ai:close').setLabel('إغلاق').setStyle(ButtonStyle.Secondary).setEmoji('❌'),
  );
}

function confirmButtons(token){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ai:confirm:${token}`).setLabel('تنفيذ').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`ai:reject:${token}`).setLabel('إلغاء').setStyle(ButtonStyle.Danger).setEmoji('✖️'),
  );
}

function transcript(ai,subject){
  const history=ai.history(subject);
  if(!history.length)return 'ابدأ برسالتك الأولى باستخدام زر **إرسال رسالة**.';
  return history.slice(-8).map(x=>{
    const who=x.role==='user'?'👤':'🤖';
    return `${who} ${String(x.text??'').slice(0,850)}`;
  }).join('\n\n').slice(0,3900);
}

async function render(i,a,s,{notice=null}={}){
  const embed=new EmbedBuilder().setTitle('🤖 AI 967').setDescription(transcript(a.aiAgentService,s))
    .setFooter({text:'Meeting 967 • محادثة مستقلة'});
  const content=notice?`${notice}\n\nاستخدم الأزرار أسفل الواجهة لمتابعة المحادثة.`:'استخدم الأزرار أسفل الواجهة لإرسال رسالتك وإدارة المحادثة.';
  return i.reply({content,embeds:[embed],components:[buttons()],ephemeral:Boolean(i.guildId)});
}

export async function aiCommand(i,a){
  const s=await subjectFromInteraction(i,a.env);
  if(!s?.member)throw new AppError('AI_MEMBER_ONLY','مساعد AI 967 متاح لأعضاء السيرفر فقط.');
  if(!a.aiAgentService)throw new AppError('AI_AGENT_MISSING','خدمة AI Agent غير مفعّلة.');
  a.aiAgentService.reset(s);
  const question=i.options.getString('question')?.trim();
  if(!question)return render(i,a,s);
  await i.deferReply({ephemeral:Boolean(i.guildId)});
  const result=await a.aiAgentService.respond(s,question);
  if(result.kind==='confirmation'){
    const embed=new EmbedBuilder().setTitle('🤖 AI 967').setDescription(`${result.text}\n\nاضغط **تنفيذ** أو **إلغاء**.`).setFooter({text:'Meeting 967 • يحتاج تأكيد'});
    return i.editReply({embeds:[embed],components:[confirmButtons(result.token),buttons()]});
  }
  const embed=new EmbedBuilder().setTitle('🤖 AI 967').setDescription(`${result.text}\n\n${transcript(a.aiAgentService,s)}`).setFooter({text:'Meeting 967 • محادثة مستقلة'});
  return i.editReply({embeds:[embed],components:[buttons()]});
}

export function openAIChat(i,a){
  const s=i.__meeting967SubjectPromise?null:null;
  return (async()=>{const subject=await subjectFromInteraction(i,a.env);a.aiAgentService.reset(subject);return render(i,a,subject);})();
}

export async function submitAIMessage(i,a){
  const s=await subjectFromInteraction(i,a.env);
  const text=i.fields.getTextInputValue('ai_text');
  await i.deferReply({ephemeral:Boolean(i.guildId)});
  const result=await a.aiAgentService.respond(s,text);
  if(result.kind==='confirmation'){
    const embed=new EmbedBuilder().setTitle('🤖 AI 967').setDescription(`${result.text}\n\nاضغط **تنفيذ** أو **إلغاء**.`).setFooter({text:'Meeting 967 • يحتاج تأكيد'});
    return i.editReply({embeds:[embed],components:[confirmButtons(result.token),buttons()]});
  }
  const embed=new EmbedBuilder().setTitle('🤖 AI 967').setDescription(`${result.text}\n\n${transcript(a.aiAgentService,s)}`).setFooter({text:'Meeting 967 • محادثة مستقلة'});
  return i.editReply({embeds:[embed],components:[buttons()]});
}

export async function handleAIInteraction(i,a,s,id){
  if(id==='ai:open')return render(i,a,s);
  if(id==='ai:message' && i.isButton?.())return i.showModal(modal());
  if(id==='ai:message' && i.isModalSubmit?.())return submitAIMessage(i,a);
  if(id==='ai:new'){
    a.aiAgentService.reset(s);
    return i.update(await aiPayload(i,a,s,'تم بدء محادثة جديدة ✅'));
  }
  if(id==='ai:context'){
    const ctx=await a.aiAgentService.personalContext(s);
    return i.update(await aiPayload(i,a,s,`📋 **سياقي الحالي**\n\`\`\`json\n${JSON.stringify(ctx,null,2).slice(0,2500)}\n\`\`\``));
  }
  if(id==='ai:close'){
    a.aiAgentService.reset(s);
    return i.update({content:'تم إغلاق واجهة AI 967.',embeds:[],components:[]});
  }
  if(id.startsWith('ai:confirm:')){
    const token=id.slice('ai:confirm:'.length);
    const result=await a.aiAgentService.confirm(s,token);
    const msg=`✅ **تم التنفيذ**\n${result.summary}\n\n${JSON.stringify(result.result).slice(0,1800)}`;
    return i.update(await aiPayload(i,a,s,msg));
  }
  if(id.startsWith('ai:reject:')){
    const token=id.slice('ai:reject:'.length);
    const pending=a.aiAgentService.getPending(s,token);
    if(pending)a.aiAgentService.pending.delete(`${s.guildId}:${s.userId}:${token}`);
    return i.update(await aiPayload(i,a,s,'✖️ تم إلغاء العملية ولم يتم تغيير أي بيانات.'));
  }
  return false;
}

async function aiPayload(i,a,s,notice){
  const embed=new EmbedBuilder().setTitle('🤖 AI 967').setDescription(transcript(a.aiAgentService,s)).setFooter({text:'Meeting 967 • محادثة مستقلة'});
  return {content:`${notice}\n\nاستخدم الأزرار أسفل الواجهة.`,embeds:[embed],components:[buttons()]};
}
JS

say "🔗 ربط AI Agent بالتطبيق..."
node --input-type=module <<'NODE'
import fs from 'node:fs';

const appPath='src/app.js';
let app=fs.readFileSync(appPath,'utf8');
if(!app.includes("AIAgentService")){
  const anchor="import { SupportService } from './application/services/SupportService.js';";
  if(!app.includes(anchor))throw new Error('app.js: لم أجد نقطة الاستيراد المناسبة.');
  app=app.replace(anchor,anchor+"\nimport { AIAgentService } from './application/services/AIAgentService.js';");
}
if(!app.includes('const aiAgentService=new AIAgentService')){
  const anchor='  const supportService=new SupportService({support,audit,logger,ownerUserId:env.OWNER_USER_ID});';
  if(!app.includes(anchor))throw new Error('app.js: لم أجد supportService لإنشاء AI Agent بعده.');
  app=app.replace(anchor,anchor+"\n  const aiAgentService=new AIAgentService({db:pool,env,logger,permissionService,taskService,meetingService,teams,meetings,guilds});");
}
if(!/return \\{[\\s\\S]*aiAgentService,/.test(app)){
  const anchor='  return {';
  if(!app.includes(anchor))throw new Error('app.js: return object غير موجود.');
  app=app.replace(anchor,anchor+"\n    aiAgentService,");
}
fs.writeFileSync(appPath,app);

const routerPath='src/interfaces/discord/router.js';
let router=fs.readFileSync(routerPath,'utf8');
if(!router.includes("import { aiCommand } from './commands/ai.js';")){
  const anchor="import { healthCommand } from './commands/health.js';";
  if(!router.includes(anchor))throw new Error('router.js: لم أجد healthCommand.');
  router=router.replace(anchor,anchor+"\nimport { aiCommand } from './commands/ai.js';");
}
router=router.replace(
  /const commands=\{([^}]*)\};/,
  (m,body)=>body.includes('ai:aiCommand')?m:`const commands={${body.trim().replace(/,\s*$/,'')},ai:aiCommand};`
);
fs.writeFileSync(routerPath,router);

const miscPath='src/interfaces/discord/interactions/misc.js';
let misc=fs.readFileSync(miscPath,'utf8');
if(!misc.includes("from '../commands/ai.js'")){
  const anchor="import {refreshPanel,personalGuide,panelHub,panelSection} from '../commands/panel.js';";
  if(!misc.includes(anchor))throw new Error('misc.js: لم أجد panel import.');
  misc=misc.replace(anchor,anchor+"\nimport {handleAIInteraction} from '../commands/ai.js';");
}
if(!misc.includes("if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);")){
  const anchor="export async function handleMisc(i,a){const id=i.customId??'';const s=await subjectFromInteraction(i,a.env);";
  if(!misc.includes(anchor))throw new Error('misc.js: handleMisc shape مختلف عن المتوقع.');
  misc=misc.replace(anchor,anchor+"\n  if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);");
}
fs.writeFileSync(miscPath,misc);

const relPath='src/interfaces/discord/interactionReliability.js';
let rel=fs.readFileSync(relPath,'utf8');
const additions=[
  "  id => id === 'ai:message',",
];
for(const line of additions){
  if(!rel.includes(line)){
    const anchor="const MODAL_OPENERS = [";
    if(!rel.includes(anchor))throw new Error('interactionReliability.js: MODAL_OPENERS غير موجود.');
    rel=rel.replace(anchor,anchor+"\n"+line);
  }
}
fs.writeFileSync(relPath,rel);

const panelPath='src/interfaces/discord/commands/panel.js';
let panel=fs.readFileSync(panelPath,'utf8');
panel=panel.replaceAll("['ai:open','مساعد 967','🤖']", "['ai:open','AI 967','🤖']");
panel=panel.replaceAll("v2Button('ai:open','مساعد 967','🤖')", "v2Button('ai:open','AI 967','🤖')");
if(!panel.includes("ai:open")){
  const anchor="  actions.push(v2Button('panel:guide','دليل الاستخدام','📖'));";
  if(panel.includes(anchor)){
    panel=panel.replace(anchor,"  actions.push(v2Button('ai:open','AI 967','🤖'));\n"+anchor);
  }else{
    throw new Error('panel.js: لم أجد نقطة إضافة زر AI 967.');
  }
}
fs.writeFileSync(panelPath,panel);

const cmdPath='src/infrastructure/discord/commandDefinitions.js';
let cmds=fs.readFileSync(cmdPath,'utf8');
if(!cmds.includes("setName('ai')")){
  const aiBlock=`\nconst ai = new SlashCommandBuilder()\n  .setName('ai')\n  .setDescription('افتح واجهة AI 967')\n  .addStringOption(option => option\n    .setName('question')\n    .setDescription('سؤال أو طلب اختياري')\n    .setRequired(false)\n    .setMaxLength(1800));\n`;
  const marker=/export const commandBuilders = \[/;
  if(!marker.test(cmds))throw new Error('commandDefinitions.js: commandBuilders غير موجود.');
  cmds=cmds.replace(marker,aiBlock+"\nexport const commandBuilders = [");
  const listStart=cmds.indexOf('export const commandBuilders = [');
  const bracketEnd=cmds.indexOf('];',listStart);
  if(bracketEnd<0)throw new Error('commandDefinitions.js: تعذر تعديل commandBuilders.');
  const inside=cmds.slice(listStart,bracketEnd);
  const trimmed=inside.trimEnd();
  const sep=trimmed.endsWith(',')?'':',';
  cmds=cmds.slice(0,listStart)+trimmed+sep+' ai\n'+cmds.slice(bracketEnd);
}
fs.writeFileSync(cmdPath,cmds);
NODE

say "🧪 إنشاء اختبارات AI Agent..."
cat > "$TEST_FILE" <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');

test('AI Agent service exists and exposes operational tools',()=>{
  const s=read('src/application/services/AIAgentService.js');
  assert.match(s,/class AIAgentService/);
  for(const name of ['create_task','update_task','set_task_status','create_meeting','reschedule_meeting','cancel_meeting','list_tasks','list_meetings']){
    assert.match(s,new RegExp(name));
  }
  assert.match(s,/new GoogleGenAI/);
});

test('write tools require confirmation before execution',()=>{
  const s=read('src/application/services/AIAgentService.js');
  assert.match(s,/WRITE_TOOLS/);
  assert.match(s,/buildPending/);
  assert.match(s,/storePending/);
  assert.match(s,/confirm\(subject,token\)/);
});

test('AI UI is separate and has conversation controls',()=>{
  const s=read('src/interfaces/discord/commands/ai.js');
  assert.match(s,/AI 967/);
  assert.match(s,/إرسال رسالة/);
  assert.match(s,/محادثة جديدة/);
  assert.match(s,/سياقي/);
  assert.match(s,/إغلاق/);
  assert.match(s,/ai:confirm:/);
  assert.match(s,/ai:reject:/);
});

test('AI routing and modal opener are wired',()=>{
  const misc=read('src/interfaces/discord/interactions/misc.js');
  const rel=read('src/interfaces/discord/interactionReliability.js');
  const router=read('src/interfaces/discord/router.js');
  assert.match(misc,/handleAIInteraction/);
  assert.match(rel,/id => id === 'ai:message'/);
  assert.match(router,/aiCommand/);
});

test('AI service is available from app container',()=>{
  const s=read('src/app.js');
  assert.match(s,/AIAgentService/);
  assert.match(s,/aiAgentService/);
});
JS

say "🧪 فحص JavaScript..."
node --check src/application/services/AIAgentService.js
node --check src/interfaces/discord/commands/ai.js
node --check src/interfaces/discord/interactions/misc.js
node --check src/interfaces/discord/interactionReliability.js
node --check src/interfaces/discord/router.js
node --check src/interfaces/discord/commands/panel.js
node --check src/infrastructure/discord/commandDefinitions.js
node --check src/app.js

say "🧪 تشغيل الاختبارات..."
node --test "$TEST_FILE"

say "🔎 تحقق من الربط..."
grep -q "aiAgentService" src/app.js
grep -q "aiCommand" src/interfaces/discord/router.js
grep -q "handleAIInteraction" src/interfaces/discord/interactions/misc.js
grep -q "id => id === 'ai:message'" src/interfaces/discord/interactionReliability.js
grep -q "ai:open" src/interfaces/discord/commands/panel.js

say "✅ AI Agent v${VERSION} تم تركيبه بنجاح."
say ""
say "الواجهة:"
say "  /panel  → AI 967"
say "  أو /ai"
say ""
say "العمليات:"
say "  الاجتماعات: إنشاء، إعادة جدولة، إلغاء، عرض القادمة"
say "  المهام: إنشاء، تعديل، تغيير حالة، عرض المهام"
say "  الأعضاء: بحث بالاسم قبل الإسناد"
say "  البيانات الشخصية: سياق العضو والصلاحيات والاجتماعات والمهام والعضوية والنقاط عند توفرها"
say "  الأمان: عمليات الكتابة لا تنفذ إلا بعد زر تأكيد"
say ""
say "🛟 Backup: $BACKUP_DIR"
say "➡️ أعد تشغيل البوت بالطريقة المعتادة بعد نجاح التثبيت."
