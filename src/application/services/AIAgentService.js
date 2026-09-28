import {GoogleGenAI} from '@google/genai';
import {DateTime} from 'luxon';
import {parseLocalDateTime} from '../../utils/time.js';
import {AppError} from '../../core/errors/AppError.js';
import {AICodebaseService} from './AICodebaseService.js';
import { AIMemberAccessService } from './AIMemberAccessService.js';
import {GroqAIProvider} from './GroqAIProvider.js';

const MAX_HISTORY=16;
const MAX_OUTPUT=3200;
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
    description:'ابحث عن عضو آخر ضمن نطاق صلاحياتك. teamName اختياري؛ إذا لم تحدده يستخدم النظام الفرق المسموح لك برؤية أعضائها.',
    parameters:{
      type:'OBJECT',
      properties:{
        teamName:{type:'STRING',description:'اسم الفريق'},
        memberName:{type:'STRING',description:'اسم العضو أو اسم المستخدم كما هو مكتوب'},
      },
      required:['memberName'],
    },
  },
  {
    name:'get_member_info',
    description:'اعرض معلومات عضو آخر وفق صلاحيات الطالب ونطاق الفريق. لا تعرض أي بيانات خارج النطاق المسموح.',
    parameters:{
      type:'OBJECT',
      properties:{
        memberName:{type:'STRING',description:'اسم العضو أو اسم المستخدم'},
        teamName:{type:'STRING',description:'اسم الفريق بشكل اختياري لتقييد النطاق'},
      },
      required:['memberName'],
    },
  },
  {
    name:'list_member_meetings',
    description:'اعرض اجتماعات عضو معيّن وفق نطاق صلاحيات الطالب. استخدمها مباشرة عندما يسأل المستخدم عن اجتماعات عضو أو اجتماعات شخص معيّن، ولا تستخدم list_meetings العامة لهذا الغرض.',
    parameters:{
      type:'OBJECT',
      properties:{
        memberName:{type:'STRING',description:'اسم العضو أو اسم المستخدم أو معرف Discord'},
        status:{type:'STRING',enum:['all','upcoming','ongoing','past'],description:'فلتر الاجتماعات: الكل أو القادمة أو الجارية أو السابقة'},
        limit:{type:'INTEGER',description:'عدد النتائج بحد أقصى 20'},
      },
      required:['memberName'],
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
    this.codebase=new AICodebaseService({logger});
    this.memberAccess=new AIMemberAccessService({db,permissionService,logger});
  }

  enabled(){return Boolean(String(this.env?.GROQ_API_KEY??process.env.GROQ_API_KEY??this.env?.GEMINI_API_KEY??process.env.GEMINI_API_KEY??'').trim());}
  model(){return String(this.env?.GEMINI_MODEL??process.env.GEMINI_MODEL??'gemini-3.8-flash').trim();}
  groqModel(){return String(this.env?.GROQ_MODEL??process.env.GROQ_MODEL??'openai/gpt-oss-20b').trim();}
  aiProvider(){return String(this.env?.AI_PROVIDER??process.env.AI_PROVIDER??'auto').trim().toLowerCase();}
  _groq(){return new GroqAIProvider({apiKey:String(this.env?.GROQ_API_KEY??process.env.GROQ_API_KEY??'').trim(),model:this.groqModel(),logger:this.logger});}
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
        const result=await this.memberAccess.findMember(subject,args);
        return result;
      }

      case 'get_member_info':{
        return await this.memberAccess.info(subject,{
          memberName:args.memberName,
          teamName:args.teamName,
        });
      }

      case 'list_member_meetings':{
        return await this.memberAccess.listMemberMeetings(subject,{
          memberName:args.memberName,
          status:args.status,
          limit:args.limit,
        });
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

    const provider=this.aiProvider();
    const groqEnabled=this._groq().enabled();
    const geminiEnabled=Boolean(String(this.env?.GEMINI_API_KEY??process.env.GEMINI_API_KEY??'').trim());

    if(!groqEnabled && !geminiEnabled){
      return '⚠️ AI 967 غير مفعّل حاليًا. أضف GROQ_API_KEY أو GEMINI_API_KEY إلى .env.';
    }

    const zone=await this.resolveZone(subject);
    const context=await this.personalContext(subject);
    const history=this.history(subject);
    const codeEvidence=await this.codebase.evidence(q);
    const system=`أنت AI 967 الرسمي داخل Meeting 967، والمساعد التشغيلي الذكي للنظام.

مصادر الحقيقة مرتبة:
1) نتائج أدوات النظام وقاعدة البيانات الحالية.
2) دليل الكود الفعلي.
3) معرفة Meeting 967 المضمنة في السياق.
4) المعرفة العامة فقط عند عدم وجود تعارض.

هدفك: فهم سؤال العضو وربطه فعليًا بوظائف Meeting 967 ثم إعطاء جواب واضح ومباشر.

اللغة:
- العربية أولًا، وتفهم الفصحى والعامية اليمنية والخليجية.
- افهم: وش، ايش، إيش، وين، فين، كيف، ليش، ابغى، ابي، ما يشتغل، وش عندي، وش فيه.
- لا تطلب إعادة صياغة السؤال إذا كان المقصود واضحًا.

قواعد:
- الأسئلة عن الاجتماعات والمهام والعضوية والنقاط والصلاحيات والبيانات الحية تحتاج أدوات النظام.
- سؤال اجتماع عضو معيّن: استخدم list_member_meetings مباشرة.
- لا تخمّن أسماء الفرق أو الأعضاء أو الاجتماعات.
- لا تدّعي تنفيذ إنشاء أو تعديل أو إلغاء قبل التأكيد.
- لا تكشف التوكنات أو مفاتيح API أو كلمات المرور أو محتوى .env.
- لا تكشف معرّفات Discord إلا عند الحاجة التقنية المباشرة.
- إذا لم تجد معلومة موثوقة بعد البحث قل بوضوح إن المعلومة غير متاحة حاليًا.
- ابدأ بالإجابة مباشرة، وتجنب الحشو.
- المنطقة الزمنية الحالية: ${zone}. صيغة الإدخال للتواريخ: YYYY-MM-DD HH:mm.`;

    if((provider==='groq'||provider==='auto') && groqEnabled){
      try{
        const groq=this._groq();
        const messages=[
          {role:'system',content:system},
          {role:'user',content:`سياق العضو الحالي:\n${json(context)}\n\nالمحادثة السابقة:\n${history.map(x=>`${x.role}: ${x.text}`).join('\n').slice(-9000)}\n\nرسالة المستخدم:\n${q}\n\nدليل الكود الفعلي المرتبط بالسؤال:\n${codeEvidence??'لا يوجد دليل كودي مباشر.'}`},
        ];

        for(let round=0;round<4;round++){
          const response=await groq.chat({messages,tools:TOOL_DECLARATIONS});
          const msg=response?.choices?.[0]?.message;
          if(!msg)throw new Error('Groq returned no message');

          const calls=Array.isArray(msg.tool_calls)?msg.tool_calls:[];
          if(!calls.length){
            let answer=String(msg.content??'').trim();
            if(!answer){
              const retry=await groq.chat({messages,tools:[]});
              const retryMsg=retry?.choices?.[0]?.message;
              answer=String(retryMsg?.content??'').trim();
            }
            if(!answer)throw new Error('Groq returned an empty answer');
            answer=clip(answer);
            this.push(subject,'user',q);
            this.push(subject,'assistant',answer);
            return {kind:'text',text:answer};
          }

          messages.push({role:'assistant',content:msg.content??'',tool_calls:calls});

          for(const call of calls){
            const name=String(call?.function?.name??'');
            let args={};
            try{args=JSON.parse(String(call?.function?.arguments??'{}'));}catch{throw new Error(`أداة ${name} أرسلت arguments غير صالحة`);}

            if(WRITE_TOOLS.has(name)){
              const pending=await this.buildPending(name,args,subject);
              const token=this.storePending(subject,pending);
              const preview=this.pendingPreview(pending);
              const msgText=`${preview}\n\nهل تريد تنفيذ العملية؟`;
              this.push(subject,'user',q);
              this.push(subject,'assistant',msgText);
              return {kind:'confirmation',text:msgText,token,pending};
            }

            const result=await this.executeReadTool(name,args,subject);
            messages.push({
              role:'tool',
              tool_call_id:String(call.id),
              content:json(result),
            });
          }
        }
        throw new Error('Groq agent loop exceeded maximum iterations');
      }catch(error){
        this.logger?.warn?.('ai-groq-failed',{message:String(error?.message??error).slice(0,600),status:error?.status??null});
        if(provider==='groq' || !geminiEnabled){
          return {kind:'text',text:'تعذر تشغيل الذكاء الاصطناعي حاليًا. جرّب مرة أخرى بعد قليل.'};
        }
      }
    }

    if(geminiEnabled){
      const client=this._client();
      const contents=[{role:'user',parts:[{text:`سياق العضو الحالي:\n${json(context)}\n\nالمحادثة السابقة:\n${history.map(x=>`${x.role}: ${x.text}`).join('\n').slice(-9000)}\n\nرسالة المستخدم:\n${q}\n\nدليل الكود الفعلي الحالي:\n${codeEvidence??'لا يوجد دليل كودي مباشر.'}`}]},];
      const response=await client.models.generateContent({
        model:this.model(),
        contents,
        config:{
          systemInstruction:system,
          tools:[{functionDeclarations:TOOL_DECLARATIONS}],
          temperature:0.2,
          maxOutputTokens:4096,
          thinkingConfig:{thinkingLevel:'medium'},
        },
      });

      const calls=response?.functionCalls??[];
      if(!calls.length){
        let answer=String(response?.text??'').trim();
        if(!answer){
          const retry=await client.models.generateContent({
            model:this.model(),
            contents,
            config:{systemInstruction:system,temperature:0.15,maxOutputTokens:4096,thinkingConfig:{thinkingLevel:'low'}},
          });
          answer=String(retry?.text??'').trim();
        }
        if(!answer)answer='ما قدرت أطلع ردًا موثوقًا حاليًا. جرّب السؤال بصياغة أقصر.';
        answer=clip(answer);
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
          const msgText=`${preview}\n\nهل تريد تنفيذ العملية؟`;
          this.push(subject,'user',q);
          this.push(subject,'assistant',msgText);
          return {kind:'confirmation',text:msgText,token,pending};
        }
        const result=await this.executeReadTool(name,args,subject);
        outputs.push(`${name}: ${json(result)}`);
      }

      const follow=await client.models.generateContent({
        model:this.model(),
        contents:[{role:'user',parts:[{text:`سؤال المستخدم:\n${q}\n\nنتائج الأدوات الفعلية:\n${outputs.join('\n').slice(0,16000)}\n\nاكتب جوابًا عربيًا مباشرًا اعتمادًا على النتائج فقط.`}]}],
        config:{systemInstruction:system,temperature:0.2,maxOutputTokens:2500,thinkingConfig:{thinkingLevel:'medium'}},
      });
      const answer=clip(follow?.text||outputs.join('\n'));
      this.push(subject,'user',q);
      this.push(subject,'assistant',answer);
      return {kind:'text',text:answer};
    }

    return {kind:'text',text:'تعذر تشغيل AI 967 حاليًا.'};
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
