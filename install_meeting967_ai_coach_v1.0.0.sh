#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/.update-backups/ai-coach-v1.0.0-$STAMP"

say(){ printf '%s\n' "$*"; }

[ -d "$ROOT" ] || { say "❌ لم أجد المشروع: $ROOT"; exit 1; }
[ -f "$ROOT/package.json" ] || { say "❌ package.json غير موجود"; exit 1; }
[ -f "$ROOT/src/application/services/AIAssistantService.js" ] || { say "❌ AIAssistantService.js غير موجود — يبدو أن نسخة AI السابقة لم تُثبت."; exit 1; }
[ -f "$ROOT/src/interfaces/discord/commands/ai.js" ] || { say "❌ commands/ai.js غير موجود"; exit 1; }

mkdir -p "$BACKUP_DIR" "$ROOT/knowledge/ai" "$ROOT/tools"

say "============================================================"
say " Meeting 967 — Local AI Coach v1.0.0"
say " مدرب 967 محلي — بدون API وبدون إنترنت"
say "============================================================"

say "🛟 إنشاء نسخة رجوع..."
cp -f "$ROOT/src/application/services/AIAssistantService.js" "$BACKUP_DIR/AIAssistantService.js" 2>/dev/null || true
cp -f "$ROOT/package.json" "$BACKUP_DIR/package.json"
[ -f "$ROOT/package-lock.json" ] && cp -f "$ROOT/package-lock.json" "$BACKUP_DIR/package-lock.json" || true
[ -f "$ROOT/knowledge/ai/intents.json" ] && cp -f "$ROOT/knowledge/ai/intents.json" "$BACKUP_DIR/intents.json" || true

say "🧠 تركيب المدرب المحلي..."
cat > "$ROOT/src/application/services/AIAssistantService.js" <<'JS'
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_Q = 1200;
const TRAINING_TTL = 60_000;
const INTENT_THRESHOLD = 1;

const DEFAULT_TRAINING = [
  { intent:'help', phrases:['مساعدة','كيف استخدم المساعد','وش يقدر يسوي المساعد','وش تعرف','ماذا يمكنك'] },
  { intent:'next_meeting', phrases:['متى اجتماعي القادم','وش اجتماعي الجاي','متى الاجتماع حقي','عندي اجتماع قريب','ما هو اجتماعي القادم','وش أقرب اجتماع لي'] },
  { intent:'today_meetings', phrases:['اجتماعاتي اليوم','عندي اجتماع اليوم','وش عندي اليوم','اجتماع اليوم','اجتماعات اليوم'] },
  { intent:'meeting_details', phrases:['تفاصيل الاجتماع','معلومات الاجتماع','تفاصيل اجتماعي','بيانات الاجتماع'] },
  { intent:'attendance', phrases:['كم اجتماع حضرت','كم حضرت','نسبة حضوري','سجل حضوري','حضوري','غيابي','كم غبت'] },
  { intent:'excuses', phrases:['اعتذاراتي','كم اعتذار عندي','حالة اعتذاري','الاعتذارات','كيف اقدم اعتذار','كيف أقدم اعتذار'] },
  { intent:'tasks', phrases:['وش علي من مهام','مهامي','تكليفاتي','المهام الموكلة لي','عندي مهام متأخرة','هل عندي مهام متأخرة'] },
  { intent:'performance', phrases:['تقييمي','كم تقييمي','تقرير أدائي','أدائي','نتيجتي','نتيجة التقييم'] },
  { intent:'points', phrases:['كم نقطة عندي','نقاطي','كم نقاطي','رصيدي من النقاط','كم جمعت نقاط'] },
  { intent:'rank', phrases:['وش رتبتي','رتبتي','ما هي رتبتي','الرتبة الشهرية','آخر رتبة'] },
  { intent:'membership', phrases:['حالة عضويتي','وضعي في العضوية','عضويتي','أنا مجمد','أنا منسحب','هل عضويتي مجمدة','حالة العضوية'] },
  { intent:'reactivation', phrases:['متى اقدر ارجع','متى أقدر أرجع','إعادة التفعيل','اعادة التفعيل','طلب التفعيل','هل اقدر ارجع للعضوية'] },
  { intent:'team', phrases:['وش فريقي','فريقي','أي فريق أنا','الفريق اللي انا فيه','فرقي'] },
  { intent:'permissions', phrases:['وش صلاحياتي','صلاحياتي','ماذا أستطيع','ايش اقدر اسوي','وش اقدر اسوي','صلاحية'] },
  { intent:'summary', phrases:['ملخص وضعي','اعطني ملخص','وش وضعي','ملخص حسابي','ابغى اعرف وضعي'] },
];

const AR_STOP = new Set(['من','في','على','عن','الى','إلى','ما','ماذا','كيف','هل','انا','أنا','انت','أنت','هذا','هذه','هو','هي','و','او','أو','لي','لك','عندي','وش','ايش','ابي','أبي','بس','طيب']);

function clean(value,max=MAX_Q){
  return String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,' ').trim().slice(0,max);
}
function norm(value){
  return clean(value,MAX_Q)
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u064B-\u065F\u0670]/g,'')
    .replace(/[أإآٱ]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/ؤ/g,'و')
    .replace(/ئ/g,'ي')
    .replace(/[ة]/g,'ه')
    .replace(/[ـ]/g,'')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function words(value){return norm(value).split(/\s+/).filter(x=>x.length>1&&!AR_STOP.has(x));}
function clip(value,max=1800){const s=String(value??'').trim();return s.length>max?s.slice(0,max-1)+'…':s;}
function fmtDate(value){
  if(!value)return 'غير محدد';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return 'غير محدد';
  return d.toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'});
}
function pct(value){
  const n=Number(value||0);
  return `${n.toFixed(1)}%`;
}
function esc(value,max=120){return String(value??'—').replace(/[\r\n]+/g,' ').slice(0,max);}

export class AIAssistantService {
  constructor({db,env,logger,permissionService}){
    Object.assign(this,{db,env,logger,permissionService});
    this.training=null;
    this.trainingLoadedAt=0;
  }

  knowledgeDir(){
    return path.resolve(this.env?.AI_KNOWLEDGE_DIR || path.join(process.cwd(),'knowledge','ai'));
  }

  async loadTraining(){
    const now=Date.now();
    if(this.training && now-this.trainingLoadedAt<TRAINING_TTL)return this.training;
    let data=[];
    try{
      const raw=await fs.readFile(path.join(this.knowledgeDir(),'intents.json'),'utf8');
      data=JSON.parse(raw);
    }catch(error){
      this.logger?.warn?.('ai-coach-training-read-failed',{error:error?.message??String(error)});
    }
    const source=Array.isArray(data)&&data.length?data:DEFAULT_TRAINING;
    this.training=source.map(x=>({intent:String(x.intent||''),phrases:Array.isArray(x.phrases)?x.phrases.map(String):[]})).filter(x=>x.intent&&x.phrases.length);
    this.trainingLoadedAt=now;
    return this.training;
  }

  classify(question){
    const q=norm(question);
    if(!q)return {intent:'help',score:0};
    let best={intent:'help',score:0};
    for(const entry of (this.training??DEFAULT_TRAINING)){
      let score=0;
      for(const phrase of entry.phrases){
        const p=norm(phrase);
        if(!p)continue;
        if(q===p)score=Math.max(score,100);
        else if(q.includes(p))score=Math.max(score,20+p.split(' ').length);
        else {
          const qw=new Set(words(q));
          const pw=words(p);
          const hit=pw.filter(x=>qw.has(x)).length;
          if(hit)score=Math.max(score,hit);
        }
      }
      if(score>best.score)best={intent:entry.intent,score};
    }
    return best.score>=INTENT_THRESHOLD?best:{intent:'help',score:0};
  }

  async query(sql,args=[]){
    try{return (await this.db.query(sql,args)).rows??[];}
    catch(error){this.logger?.debug?.('ai-coach-query-failed',{error:error?.message??String(error)});return [];} 
  }

  async grants(subject){
    try{return await this.permissionService?.grants?.(subject) ?? [];}catch{return [];} 
  }

  async nextMeeting(subject){
    const rows=await this.query(`SELECT m.name,m.scheduled_at,m.status,t.name AS team_name
      FROM meetings m JOIN teams t ON t.id=m.team_id
      JOIN team_members tm ON tm.team_id=t.id AND tm.guild_id=m.guild_id AND tm.user_id=$2 AND tm.active=true
      WHERE m.guild_id=$1 AND m.status IN ('upcoming','ongoing') AND m.scheduled_at>=now()
      AND COALESCE(m.is_test,false)=false
      ORDER BY m.scheduled_at ASC LIMIT 1`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'ما عندي اجتماع قادم مسجل لك حاليًا.';
    const r=rows[0];
    return `أقرب اجتماع لك: **${esc(r.name)}**\nالفريق: ${esc(r.team_name)}\nالموعد: **${fmtDate(r.scheduled_at)}**\nالحالة: ${esc(r.status)}`;
  }

  async todayMeetings(subject){
    const rows=await this.query(`SELECT m.name,m.scheduled_at,m.status,t.name AS team_name
      FROM meetings m JOIN teams t ON t.id=m.team_id
      JOIN team_members tm ON tm.team_id=t.id AND tm.guild_id=m.guild_id AND tm.user_id=$2 AND tm.active=true
      WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false
      AND m.scheduled_at >= date_trunc('day',now())
      AND m.scheduled_at < date_trunc('day',now()) + interval '1 day'
      ORDER BY m.scheduled_at ASC LIMIT 12`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'ما عندك اجتماعات مسجلة لك اليوم.';
    return `اجتماعاتك اليوم (${rows.length}):\n`+rows.map((r,i)=>`${i+1}) **${esc(r.name)}** — ${fmtDate(r.scheduled_at)} — ${esc(r.team_name)}`).join('\n');
  }

  async meetingDetails(subject,question){
    const raw=norm(question).replace(/تفاصيل|معلومات|بيانات|اجتماع|اجتماعي|عن|ماذا/g,' ').replace(/\s+/g,' ').trim();
    if(raw.length<2)return 'اكتب اسم الاجتماع أو جزءًا منه وأنا أبحث لك عنه.';
    const rows=await this.query(`SELECT m.name,m.scheduled_at,m.status,t.name AS team_name,m.voice_channel_id
      FROM meetings m JOIN teams t ON t.id=m.team_id
      WHERE m.guild_id=$1 AND COALESCE(m.is_test,false)=false AND lower(m.name) LIKE lower($2)
      ORDER BY CASE WHEN m.scheduled_at>=now() THEN 0 ELSE 1 END,m.scheduled_at DESC LIMIT 5`,[subject.guildId,`%${raw}%`]);
    if(!rows.length)return `ما لقيت اجتماع يطابق **${esc(raw)}** ضمن بيانات السيرفر.`;
    return rows.map((r,i)=>`${i+1}) **${esc(r.name)}**\nالفريق: ${esc(r.team_name)}\nالموعد: ${fmtDate(r.scheduled_at)}\nالحالة: ${esc(r.status)}`).join('\n\n');
  }

  async attendance(subject){
    const total=(await this.query(`SELECT COUNT(*)::int AS n FROM meeting_member_snapshots s JOIN meetings m ON m.id=s.meeting_id WHERE m.guild_id=$1 AND s.user_id=$2 AND m.status='ended' AND COALESCE(m.is_test,false)=false`,[subject.guildId,subject.userId]))[0]?.n??0;
    const rows=(await this.query(`SELECT
      COUNT(*) FILTER(WHERE a.status IN ('present','late'))::int AS attended,
      COUNT(*) FILTER(WHERE a.status='late')::int AS late,
      COUNT(*) FILTER(WHERE a.status='absent')::int AS absent,
      COUNT(*) FILTER(WHERE a.status='excused')::int AS excused
      FROM attendance a JOIN meetings m ON m.id=a.meeting_id
      WHERE m.guild_id=$1 AND a.user_id=$2 AND m.status='ended' AND COALESCE(m.is_test,false)=false`,[subject.guildId,subject.userId]))[0]??{};
    const attended=Number(rows.attended||0);
    const rate=Number(total)>0?(attended/Number(total))*100:0;
    return `سجل حضورك الحالي:\nالاجتماعات المنتهية المسجلة لك: **${Number(total)}**\nالحضور: **${attended}**\nالمتأخر: **${Number(rows.late||0)}**\nالغياب: **${Number(rows.absent||0)}**\nالمعتذر: **${Number(rows.excused||0)}**\nنسبة الحضور التقريبية: **${pct(rate)}**`;
  }

  async excuses(subject,question){
    if(/كيف|طريقة|اقدم|أقدم|ارفع|أرفع/.test(norm(question)))return 'لتقديم اعتذار استخدم **/panel → مساحتي → اعتذاراتي** ثم اختر الاجتماع واتبع النموذج الموجود في الواجهة.';
    const r=(await this.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE e.status='approved')::int AS approved,
      COUNT(*) FILTER(WHERE e.status='pending')::int AS pending,
      COUNT(*) FILTER(WHERE e.status='rejected')::int AS rejected
      FROM excuses e JOIN meetings m ON m.id=e.meeting_id WHERE m.guild_id=$1 AND e.user_id=$2`,[subject.guildId,subject.userId]))[0]??{};
    return `اعتذاراتك:\nالإجمالي: **${Number(r.total||0)}**\nالمقبول: **${Number(r.approved||0)}**\nقيد المراجعة: **${Number(r.pending||0)}**\nالمرفوض: **${Number(r.rejected||0)}**`;
  }

  async tasks(subject){
    const rows=await this.query(`SELECT title,status,review_status,due_at
      FROM meeting_tasks WHERE guild_id=$1 AND assignee_user_id=$2 AND status<>'cancelled'
      ORDER BY COALESCE(due_at,created_at) ASC LIMIT 12`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'ما عندك مهام مسجلة حاليًا.';
    const overdue=rows.filter(r=>['pending','in_progress'].includes(String(r.status))&&r.due_at&&new Date(r.due_at)<new Date()).length;
    return `عندك **${rows.length}** مهام ظاهرة لي، منها **${overdue}** متأخرة.\n`+rows.slice(0,8).map((r,i)=>`${i+1}) **${esc(r.title,90)}** — ${esc(r.status)} — مراجعة: ${esc(r.review_status||'—')} — الاستحقاق: ${fmtDate(r.due_at)}`).join('\n');
  }

  async performance(subject){
    const rows=await this.query(`SELECT period_type,range_start,range_end,score,generated_at
      FROM member_performance_reports WHERE guild_id=$1 AND user_id=$2 ORDER BY generated_at DESC LIMIT 3`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'ما عندي تقرير تقييم مسجل لك حاليًا.';
    const r=rows[0];
    return `آخر تقييم مسجل لك:\nالفترة: **${esc(r.period_type)}**\nالنتيجة: **${r.score===null?'غير متوفرة':Number(r.score)}**\nمن: ${fmtDate(r.range_start)}\nإلى: ${fmtDate(r.range_end)}\nتاريخ إنشاء التقرير: ${fmtDate(r.generated_at)}`;
  }

  async points(subject){
    const rows=await this.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE amount>0 AND point_type<>'admin_adjustment'),0)::bigint AS points
      FROM membership_points_ledger WHERE guild_id=$1 AND user_id=$2`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'نظام النقاط غير متاح في قاعدة البيانات الحالية.';
    const awards=await this.query(`SELECT month_start,role_key,points FROM membership_monthly_rank_awards
      WHERE guild_id=$1 AND user_id=$2 ORDER BY month_start DESC LIMIT 1`,[subject.guildId,subject.userId]);
    const out=`إجمالي نقاطك الإيجابية: **${Number(rows[0].points||0)}** نقطة`;
    if(awards.length)return `${out}\nآخر رتبة شهرية مسجلة: **${esc(awards[0].role_key)}** — ${Number(awards[0].points||0)} نقطة`;
    return out;
  }

  async rank(subject){
    const rows=await this.query(`SELECT month_start,role_key,points FROM membership_monthly_rank_awards
      WHERE guild_id=$1 AND user_id=$2 ORDER BY month_start DESC LIMIT 1`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'ما عندي رتبة شهرية مكتسبة مسجلة لك حاليًا.';
    return `آخر رتبة شهرية لك: **${esc(rows[0].role_key)}**\nنقاط الشهر: **${Number(rows[0].points||0)}**\nالشهر: ${fmtDate(rows[0].month_start)}`;
  }

  async membership(subject,question){
    const rows=await this.query(`SELECT status,return_at,withdrawn_at,reactivation_requested_at,reactivation_status,freeze_reason,withdraw_reason
      FROM membership_personal_states WHERE guild_id=$1 AND user_id=$2 LIMIT 1`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'ما لقيت سجل حالة عضوية شخصية لك حاليًا.';
    const r=rows[0];
    if(/كيف|طريقة|انسحاب|انحسب|تجميد/.test(norm(question))){
      if(/انسحاب/.test(norm(question)))return 'مسار الانسحاب موجود داخل **/panel → مساحتي → إدارة عضويتي → انسحاب** ثم تكتب السبب وتؤكد الطلب.';
      if(/تجميد/.test(norm(question)))return 'مسار التجميد موجود داخل **/panel → مساحتي → إدارة عضويتي → تجميد العضوية** ثم تكمل النموذج الموجود.';
    }
    return `حالة عضويتك: **${esc(r.status)}**\n${r.return_at?`تاريخ العودة: **${fmtDate(r.return_at)}**\n`:''}${r.freeze_reason?`سبب التجميد: ${esc(r.freeze_reason,180)}\n`:''}${r.withdrawn_at?`تاريخ الانسحاب: ${fmtDate(r.withdrawn_at)}\n`:''}${r.reactivation_requested_at?`طلب إعادة التفعيل: **${esc(r.reactivation_status||'مرفوع')}** بتاريخ ${fmtDate(r.reactivation_requested_at)}\n`:''}`.trim();
  }

  async reactivation(subject){
    const rows=await this.query(`SELECT status,return_at,withdrawn_at,reactivation_requested_at,reactivation_status
      FROM membership_personal_states WHERE guild_id=$1 AND user_id=$2 LIMIT 1`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'ما عندي حالة عضوية شخصية مسجلة لك.';
    const r=rows[0];
    if(r.reactivation_status)return `حالة طلب إعادة التفعيل الحالية: **${esc(r.reactivation_status)}**${r.reactivation_requested_at?`\nالتاريخ: ${fmtDate(r.reactivation_requested_at)}`:''}`;
    if(!r.withdrawn_at)return 'أنت لست في حالة انسحاب مسجلة حاليًا، لذلك لا يظهر لك طلب إعادة تفعيل.';
    const d=new Date(r.withdrawn_at); d.setDate(d.getDate()+7);
    const now=new Date();
    return now>=d?`أنت وصلت إلى موعد الأهلية حسب سجل الانسحاب. الخطوة التالية هي **طلب إعادة التفعيل** من لوحة العضوية.`:`بحسب سجل الانسحاب، تكتمل الأهلية بعد: **${fmtDate(d)}**.`;
  }

  async team(subject){
    const rows=await this.query(`SELECT t.name FROM teams t JOIN team_members tm ON tm.team_id=t.id
      WHERE tm.guild_id=$1 AND tm.user_id=$2 AND tm.active=true AND t.deleted_at IS NULL ORDER BY t.name`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'ما عندك فريق فعال مسجل حاليًا.';
    return `فرقك الحالية: ${rows.map(r=>`**${esc(r.name)}**`).join('، ')}`;
  }

  async permissions(subject){
    const grants=await this.grants(subject);
    const allowed=[...new Set(grants.filter(g=>String(g.effect)==='allow').map(g=>String(g.permission_key??g.permission??'')).filter(Boolean))];
    if(subject.userId===this.env?.OWNER_USER_ID)return 'أنت مالك النظام، لذلك لديك صلاحيات المالك وفق إعدادات Operations 967.';
    if(!allowed.length)return 'ما ظهر لي أي صلاحيات مسموحة إضافية في سياق حسابك الحالي.';
    return `أبرز الصلاحيات المسموحة لك (${allowed.length}):\n${allowed.slice(0,25).map(x=>`• ${esc(x,90)}`).join('\n')}${allowed.length>25?'\n…':''}`;
  }

  async summary(subject){
    const [meeting,att,task,team,membership,points]=await Promise.all([
      this.nextMeeting(subject),this.attendance(subject),this.tasks(subject),this.team(subject),this.membership(subject,'حالة عضويتي'),this.points(subject)
    ]);
    return `**ملخص وضعك في 967**\n\n${team}\n\n${membership}\n\n${meeting}\n\n${task}\n\n${points}\n\n${att}`;
  }

  help(){
    return `أنا **مدرب 967 المحلي** وأشتغل من داخل البوت بدون API وبدون إرسال بياناتك إلى خدمة خارجية.\n\nأقدر أجاوبك عن:\n• الاجتماعات والمواعيد\n• الحضور والغياب\n• الاعتذارات\n• المهام والتكليفات\n• التقييم\n• النقاط والرتب\n• العضوية والتجميد والانسحاب وإعادة التفعيل\n• الفرق\n• الصلاحيات\n\nمثال: **متى اجتماعي القادم؟** أو **كم نقطة عندي؟** أو **وش علي من مهام؟**`;
  }

  async answer({subject,question}){
    const q=clean(question);
    if(!q)throw new Error('اكتب سؤالك أولًا.');
    if(!subject?.guildId||!subject?.userId)throw new Error('تعذر تحديد سياق العضو.');
    const training=await this.loadTraining();
    const result=this.classify(q);
    this.logger?.info?.('ai-coach-query',{intent:result.intent,score:result.score,guildId:subject.guildId,userId:subject.userId});
    let answer;
    switch(result.intent){
      case 'next_meeting': answer=await this.nextMeeting(subject); break;
      case 'today_meetings': answer=await this.todayMeetings(subject); break;
      case 'meeting_details': answer=await this.meetingDetails(subject,q); break;
      case 'attendance': answer=await this.attendance(subject); break;
      case 'excuses': answer=await this.excuses(subject,q); break;
      case 'tasks': answer=await this.tasks(subject); break;
      case 'performance': answer=await this.performance(subject); break;
      case 'points': answer=await this.points(subject); break;
      case 'rank': answer=await this.rank(subject); break;
      case 'membership': answer=await this.membership(subject,q); break;
      case 'reactivation': answer=await this.reactivation(subject); break;
      case 'team': answer=await this.team(subject); break;
      case 'permissions': answer=await this.permissions(subject); break;
      case 'summary': answer=await this.summary(subject); break;
      default: answer=this.help();
    }
    return clip(answer);
  }
}
JS

say "📚 تحديث بيانات التدريب المحلية..."
cat > "$ROOT/knowledge/ai/intents.json" <<'JSON'
[
  {"intent":"help","phrases":["مساعدة","كيف استخدم المساعد","وش يقدر يسوي المساعد","وش تعرف","ماذا يمكنك"]},
  {"intent":"next_meeting","phrases":["متى اجتماعي القادم","وش اجتماعي الجاي","متى الاجتماع حقي","عندي اجتماع قريب","ما هو اجتماعي القادم","وش أقرب اجتماع لي"]},
  {"intent":"today_meetings","phrases":["اجتماعاتي اليوم","عندي اجتماع اليوم","وش عندي اليوم","اجتماع اليوم","اجتماعات اليوم"]},
  {"intent":"meeting_details","phrases":["تفاصيل الاجتماع","معلومات الاجتماع","تفاصيل اجتماعي","بيانات الاجتماع"]},
  {"intent":"attendance","phrases":["كم اجتماع حضرت","كم حضرت","نسبة حضوري","سجل حضوري","حضوري","غيابي","كم غبت"]},
  {"intent":"excuses","phrases":["اعتذاراتي","كم اعتذار عندي","حالة اعتذاري","الاعتذارات","كيف اقدم اعتذار","كيف أقدم اعتذار"]},
  {"intent":"tasks","phrases":["وش علي من مهام","مهامي","تكليفاتي","المهام الموكلة لي","عندي مهام متأخرة","هل عندي مهام متأخرة"]},
  {"intent":"performance","phrases":["تقييمي","كم تقييمي","تقرير أدائي","أدائي","نتيجتي","نتيجة التقييم"]},
  {"intent":"points","phrases":["كم نقطة عندي","نقاطي","كم نقاطي","رصيدي من النقاط","كم جمعت نقاط"]},
  {"intent":"rank","phrases":["وش رتبتي","رتبتي","ما هي رتبتي","الرتبة الشهرية","آخر رتبة"]},
  {"intent":"membership","phrases":["حالة عضويتي","وضعي في العضوية","عضويتي","أنا مجمد","أنا منسحب","هل عضويتي مجمدة","حالة العضوية"]},
  {"intent":"reactivation","phrases":["متى اقدر ارجع","متى أقدر أرجع","إعادة التفعيل","اعادة التفعيل","طلب التفعيل","هل اقدر ارجع للعضوية"]},
  {"intent":"team","phrases":["وش فريقي","فريقي","أي فريق أنا","الفريق اللي انا فيه","فرقي"]},
  {"intent":"permissions","phrases":["وش صلاحياتي","صلاحياتي","ماذا أستطيع","ايش اقدر اسوي","وش اقدر اسوي","صلاحية"]},
  {"intent":"summary","phrases":["ملخص وضعي","اعطني ملخص","وش وضعي","ملخص حسابي","ابغى اعرف وضعي"]}
]
JSON

cat > "$ROOT/knowledge/ai/README.md" <<'MD'
# مدرب 967 المحلي

هذا المساعد لا يستخدم OpenAI ولا أي API خارجي.

الذكاء هنا داخل البوت نفسه:
1. يفهم صياغات عربية متعددة للسؤال.
2. يحدد نوع الطلب محليًا.
3. يستدعي الاستعلام أو الخدمة المناسبة من نظام 967.
4. يعيد النتيجة للمستخدم.

لتدريب صياغات جديدة بدون تعديل الكود، أضف عبارات إلى:
`knowledge/ai/intents.json`

القيمة `intent` يجب أن تكون واحدة من النوايا المدعومة في `AIAssistantService.js`.

المساعد في هذه النسخة للقراءة والشرح فقط ولا ينفذ تغييرات على العضوية أو الاجتماعات أو المهام.
MD

say "🧪 إنشاء اختبار محلي سريع..."
cat > "$ROOT/tools/ai-coach-selftest.mjs" <<'JS'
import { AIAssistantService } from '../src/application/services/AIAssistantService.js';

const ai=new AIAssistantService({db:null,env:{},logger:null,permissionService:null});
ai.training=[
  {intent:'next_meeting',phrases:['متى اجتماعي القادم','وش اجتماعي الجاي']},
  {intent:'attendance',phrases:['كم اجتماع حضرت','نسبة حضوري']},
  {intent:'tasks',phrases:['وش علي من مهام','عندي مهام متأخرة']},
  {intent:'points',phrases:['كم نقطة عندي','نقاطي']},
  {intent:'membership',phrases:['حالة عضويتي','أنا مجمد']},
];
const cases=[
  ['متى اجتماعي القادم','next_meeting'],
  ['وش اجتماعي الجاي','next_meeting'],
  ['كم اجتماع حضرت','attendance'],
  ['وش علي من مهام','tasks'],
  ['كم نقطة عندي','points'],
  ['أنا مجمد','membership'],
];
let failed=0;
for(const [q,expected] of cases){
  const got=ai.classify(q).intent;
  const ok=got===expected;
  console.log(`${ok?'✅':'❌'} ${q} -> ${got}`);
  if(!ok)failed++;
}
if(failed)process.exit(1);
console.log('✅ Local AI Coach self-test passed');
JS

say "🧪 فحص JavaScript..."
node --check "$ROOT/src/application/services/AIAssistantService.js"
node --check "$ROOT/src/interfaces/discord/commands/ai.js"
node --check "$ROOT/tools/ai-coach-selftest.mjs"

say "🧪 اختبار فهم الأسئلة محليًا..."
(cd "$ROOT" && node tools/ai-coach-selftest.mjs)

say "📦 فحص استخدام OpenAI..."
OPENAI_IMPORTS=$(grep -RIlE "from ['\"]openai['\"]|require\(['\"]openai['\"]\)" "$ROOT/src" "$ROOT/scripts" "$ROOT/tools" 2>/dev/null | grep -v '/AIAssistantService.js$' || true)
if [ -z "$OPENAI_IMPORTS" ]; then
  if grep -qE '"openai"|\x27openai\x27' "$ROOT/package.json"; then
    say "🧹 لا توجد استيرادات OpenAI أخرى؛ إزالة الحزمة..."
    (cd "$ROOT" && npm uninstall openai) >/dev/null
  fi
else
  say "ℹ️ توجد ملفات أخرى تستخدم OpenAI؛ لن نحذف الحزمة."
fi

say "✅ التحديث اكتمل بدون إعادة تشغيل البوت."
say "📁 التدريب: $ROOT/knowledge/ai/intents.json"
say "🧠 الخدمة: $ROOT/src/application/services/AIAssistantService.js"
say "🛟 النسخة الاحتياطية: $BACKUP_DIR"
say ""
say "الخطوة التالية: أعد تشغيل البوت ثم اختبر /ai."
