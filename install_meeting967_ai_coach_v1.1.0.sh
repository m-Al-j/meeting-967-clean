#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
VERSION="1.1.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/.update-backups/ai-coach-v${VERSION}-$STAMP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

[ -d "$ROOT" ] || die "لم أجد المشروع: $ROOT"
[ -f "$ROOT/package.json" ] || die "package.json غير موجود"
[ -f "$ROOT/src/application/services/AIAssistantService.js" ] || die "AIAssistantService.js غير موجود"
[ -f "$ROOT/src/interfaces/discord/commands/ai.js" ] || die "commands/ai.js غير موجود"
[ -f "$ROOT/src/interfaces/discord/router.js" ] || die "router.js غير موجود"
[ -f "$ROOT/src/infrastructure/discord/commandDefinitions.js" ] || die "commandDefinitions.js غير موجود"
[ -f "$ROOT/src/interfaces/discord/interactions/misc.js" ] || die "misc.js غير موجود"

mkdir -p "$BACKUP_DIR" "$ROOT/knowledge/ai" "$ROOT/tools"

cd "$ROOT"

say "============================================================"
say " Meeting 967 — Local AI Coach v1.1.0"
say " مدرب 967 المحلي — تدريب عربي موسع + محادثة خاصة"
say "============================================================"

say "🛟 إنشاء نسخة رجوع..."
for f in \
  src/application/services/AIAssistantService.js \
  src/interfaces/discord/commands/ai.js \
  src/interfaces/discord/router.js \
  src/infrastructure/discord/commandDefinitions.js \
  src/interfaces/discord/interactions/misc.js \
  src/interfaces/discord/commands/panel.js \
  knowledge/ai/intents.json
 do
  [ -f "$ROOT/$f" ] && mkdir -p "$BACKUP_DIR/$(dirname "$f")" && cp -f "$ROOT/$f" "$BACKUP_DIR/$f" || true
done

say "🧠 تركيب محرك التصنيف العربي المحسن..."
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

const AR_STOP = new Set(['من','في','على','عن','الى','إلى','ما','ماذا','كيف','هل','انا','أنا','انت','أنت','هذا','هذه','ذلك','تلك','هو','هي','هم','هن','و','او','أو','لي','لك','عندي','لدي','وش','ايش','إيش','ويش','اش','ابي','أبي','ابغى','أبغى','اريد','أريد','بس','طيب','دحين','الحين','الحينه','متى','وين','فين','قد','قديش','كم','كمه']);

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
    .replace(/[ـ]/g,'')
    .replace(/[؟?!،؛,:.\-_/\\]+/g,' ')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function tokenBase(value){
  let t=String(value??'');
  if(t.length<2)return t;
  t=t.replace(/^ال(?=.{3,})/,'');
  for(const suffix of ['يات','ات','ون','ين','ان','ية','هم','هن','ها','نا','كم','كن','ني','تي','ك','ه','ي']){
    if(t.length>suffix.length+2 && t.endsWith(suffix)){ t=t.slice(0,-suffix.length); break; }
  }
  return t;
}
function words(value){
  return norm(value)
    .split(/\s+/)
    .filter(x=>x.length>1&&!AR_STOP.has(x))
    .map(tokenBase)
    .filter(x=>x.length>1);
}
function editDistance(a,b){
  if(a===b)return 0;
  if(!a)return b.length;
  if(!b)return a.length;
  if(Math.abs(a.length-b.length)>2)return 3;
  const dp=Array.from({length:a.length+1},(_,i)=>i);
  for(let j=1;j<=b.length;j++){
    let prev=dp[0]; dp[0]=j;
    for(let i=1;i<=a.length;i++){
      const cur=dp[i];
      const cost=a[i-1]===b[j-1]?0:1;
      dp[i]=Math.min(dp[i]+1,dp[i-1]+1,prev+cost);
      prev=cur;
    }
  }
  return dp[a.length];
}
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
    const qw=words(q);
    const qSet=new Set(qw);
    let best={intent:'help',score:0};
    for(const entry of (this.training??DEFAULT_TRAINING)){
      let score=0;
      for(const phrase of entry.phrases){
        const p=norm(phrase);
        if(!p)continue;
        if(q===p){score=Math.max(score,100);continue;}
        if(q.includes(p)||p.includes(q)){score=Math.max(score,32+Math.min(p.split(' ').length,8));continue;}
        const pw=words(p);
        if(!pw.length)continue;
        let hit=0;
        for(const token of pw){
          if(qSet.has(token)){hit+=3;continue;}
          if(token.length>=3 && qw.some(qt=>editDistance(token,qt)<=1)){hit+=1;}
        }
        const coverage=hit/Math.max(1,pw.length*3);
        if(hit)score=Math.max(score,hit+(coverage>=0.66?4:0));
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

  async upcomingMeetings(subject){
    const rows=await this.query(`SELECT m.name,m.scheduled_at,m.status,t.name AS team_name
      FROM meetings m JOIN teams t ON t.id=m.team_id
      JOIN team_members tm ON tm.team_id=t.id AND tm.guild_id=m.guild_id AND tm.user_id=$2 AND tm.active=true
      WHERE m.guild_id=$1 AND m.status IN ('upcoming','ongoing') AND COALESCE(m.is_test,false)=false
      AND m.scheduled_at>=now()
      ORDER BY m.scheduled_at ASC LIMIT 8`,[subject.guildId,subject.userId]);
    if(!rows.length)return 'ما عندك اجتماعات قادمة مسجلة لك حاليًا.';
    return `اجتماعاتك القادمة (${rows.length}):\n`+rows.map((r,i)=>`${i+1}) **${esc(r.name)}** — ${fmtDate(r.scheduled_at)} — ${esc(r.team_name)} — ${esc(r.status)}`).join('\n');
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
    return `أنا **مدرب 967 المحلي** وأشتغل من داخل البوت بدون API وبدون إرسال بياناتك إلى خدمة خارجية.\n\nأقدر أجاوبك عن:\n• الاجتماعات والمواعيد\n• الحضور والغياب\n• الاعتذارات\n• المهام والتكليفات\n• التقييم\n• النقاط والرتب\n• العضوية والتجميد والانسحاب وإعادة التفعيل\n• الفرق\n• الصلاحيات\n\nمثال: **متى اجتماعي القادم؟** أو **وش اجتماعاتي الجاية؟** أو **كم نقطة عندي؟** أو **وش علي من مهام؟**`;
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
      case 'upcoming_meetings': answer=await this.upcomingMeetings(subject); break;
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

say "📚 تحميل تدريب عربي موسع..."
cat > "$ROOT/knowledge/ai/intents.json" <<'JSON'
[
  {
    "intent": "help",
    "phrases": [
      "مساعدة",
      "ساعدني",
      "ابغى مساعدة",
      "أبغى مساعدة",
      "كيف استخدم المساعد",
      "وش يقدر يسوي المساعد",
      "وش تسوي يا مساعد",
      "ايش تعرف عن حسابي",
      "اش تقدر تسوي",
      "دحين ايش تقدر تسوي",
      "الحين ايش يقدر يسوي",
      "كيف اكلم المدرب",
      "كيف اسأل المدرب",
      "ما هي قدرات المساعد",
      "وش خدمات المدرب",
      "ايش خدماتك",
      "علمني كيف استخدمك"
    ]
  },
  {
    "intent": "next_meeting",
    "phrases": [
      "متى اجتماعي القادم",
      "متى الاجتماع الجاي حقّي",
      "متى الاجتماع الجاي حقي",
      "وش اجتماعي الجاي",
      "ايش اجتماعي الجاي",
      "اش اجتماعي الجاي",
      "دحين متى اجتماعي الجاي",
      "الحين متى اجتماعي الجاي",
      "متى أقرب اجتماع لي",
      "متى اقرب اجتماع لي",
      "ما موعد اجتماعي القادم",
      "ما هو الاجتماع القادم لي",
      "ايش أقرب اجتماع عندي",
      "وش اقرب اجتماع عندي",
      "معي اجتماع قريب؟",
      "عندي اجتماع قريب؟",
      "وين موعد اجتماعي الجاي",
      "متى الموعد الجاي لي",
      "متى جلسة الاجتماع الجاية",
      "قد ايش باقي على اجتماعي الجاي"
    ]
  },
  {
    "intent": "upcoming_meetings",
    "phrases": [
      "وش اجتماعاتي الجاية",
      "وش الاجتماعات الجاية لي",
      "ايش الاجتماعات القادمة لي",
      "اش الاجتماعات الجاية",
      "قائمة اجتماعاتي القادمة",
      "ابغى اجتماعاتي الجاية",
      "أبغى اجتماعاتي الجاية",
      "اعطني اجتماعاتي القادمة",
      "اعطني كل اجتماعاتي الجاية",
      "ما هي اجتماعاتي القادمة",
      "وش عندي من اجتماعات قدام",
      "وش عندي اجتماعات بعد",
      "معي كم اجتماع جاي",
      "كم اجتماع عندي جاي",
      "وين اجتماعاتي القادمة",
      "دحين وش اجتماعاتي الجاية",
      "الحين وش عندي اجتماعات",
      "اش معي اجتماعات قريب",
      "وش الاجتماعات اللي بعد",
      "الاجتماعات اللي جاية"
    ]
  },
  {
    "intent": "today_meetings",
    "phrases": [
      "اجتماعاتي اليوم",
      "عندي اجتماع اليوم",
      "وش عندي اليوم",
      "ايش عندي اليوم من اجتماعات",
      "اش عندي اليوم",
      "دحين عندي اجتماع؟",
      "الحين عندي اجتماع؟",
      "هل عندي اجتماع اليوم",
      "في اجتماع لي اليوم",
      "معي اجتماع اليوم",
      "وش اجتماعات اليوم حقي",
      "ايش اجتماعات اليوم",
      "هل عندي اجتماعات اليوم",
      "وش المواعيد حقي اليوم",
      "اش مواعيدي اليوم",
      "فيه اجتماع اليوم لي؟"
    ]
  },
  {
    "intent": "meeting_details",
    "phrases": [
      "تفاصيل الاجتماع",
      "تفاصيل اجتماعي",
      "معلومات الاجتماع",
      "معلومات اجتماعي",
      "بيانات الاجتماع",
      "بيانات اجتماعي",
      "تفاصيل اجتماع فريقنا",
      "تفاصيل الاجتماع اللي عندي",
      "ابغى تفاصيل الاجتماع",
      "أبغى تفاصيل الاجتماع",
      "اعطني تفاصيل الاجتماع",
      "ايش تفاصيل الاجتماع",
      "اش تفاصيل الاجتماع",
      "وش تفاصيل الاجتماع",
      "تفاصيل اجتماع الليلة",
      "تفاصيل اجتماع اليوم",
      "تفاصيل الموعد",
      "معلومات الموعد"
    ]
  },
  {
    "intent": "attendance",
    "phrases": [
      "كم اجتماع حضرت",
      "كم حضرت",
      "كم قد حضرت",
      "قد ايش حضرت",
      "كم نسبة حضوري",
      "نسبة حضوري",
      "كيف حضوري",
      "سجل حضوري",
      "سجل الغياب",
      "سجل حضوري في الاجتماعات",
      "كم مرة حضرت",
      "كم مرة غبت",
      "كم غبت",
      "ايش وضعي في الحضور",
      "اش وضعي في الحضور",
      "وش حضوري",
      "وش غيابي",
      "كم اجتماع غبت عنه",
      "هل حضوري كويس",
      "كم نسبة الحضور عندي",
      "قد ايش نسبة حضوري",
      "احسب لي حضوري"
    ]
  },
  {
    "intent": "excuses",
    "phrases": [
      "اعتذاراتي",
      "كم اعتذار عندي",
      "حالة اعتذاري",
      "حالات اعتذاري",
      "الاعتذارات حقي",
      "وش اعتذاراتي",
      "ايش اعتذاراتي",
      "اش اعتذاراتي",
      "كيف اقدم اعتذار",
      "كيف أقدم اعتذار",
      "كيف اسوي اعتذار",
      "كيف ارفع اعتذار",
      "كيف ارسل اعتذار",
      "ابغى اعتذر عن اجتماع",
      "أبغى اعتذر عن اجتماع",
      "هل اعتذاري مقبول",
      "هل اعتذاري انقبل",
      "كم اعتذار مقبول",
      "كم اعتذار مرفوض",
      "وش حالة الاعتذار حقي"
    ]
  },
  {
    "intent": "tasks",
    "phrases": [
      "وش علي من مهام",
      "وش علي مهام",
      "ايش علي من مهام",
      "اش علي من مهام",
      "مهامي",
      "تكليفاتي",
      "وش تكليفاتي",
      "ايش تكليفاتي",
      "المهام الموكلة لي",
      "المهام اللي علي",
      "وش عندي من تكليفات",
      "عندي مهام متأخرة",
      "هل عندي مهام متأخرة",
      "كم مهمة علي",
      "كم تكليف عندي",
      "وش باقي علي",
      "وش المهام حقي",
      "اعطني مهامي",
      "ابغى مهامي",
      "أبغى مهامي",
      "ايش المهام المطلوبة مني",
      "اش المطلوب مني من مهام"
    ]
  },
  {
    "intent": "performance",
    "phrases": [
      "تقييمي",
      "كم تقييمي",
      "كيف تقييمي",
      "ايش تقييمي",
      "اش تقييمي",
      "وش تقييمي",
      "تقرير أدائي",
      "تقرير ادائي",
      "أدائي",
      "ادائي",
      "نتيجتي",
      "نتيجة التقييم",
      "كم نتيجتي",
      "وش نتيجتي",
      "كيف تقييمي الشهري",
      "هل عندي تقييم",
      "اعطني آخر تقييم",
      "ابغى اعرف تقييمي",
      "أبغى اعرف تقييمي"
    ]
  },
  {
    "intent": "points",
    "phrases": [
      "كم نقطة عندي",
      "كم نقاطي",
      "نقاطي",
      "وش نقاطي",
      "ايش نقاطي",
      "اش نقاطي",
      "قد ايش نقاطي",
      "رصيدي من النقاط",
      "رصيد النقاط",
      "كم جمعت نقاط",
      "كم جبت نقاط",
      "كم كسبت نقاط",
      "وش رصيد النقاط حقي",
      "كم نقطة معي",
      "معي كم نقطة",
      "كيف اعرف نقاطي",
      "ابغى نقاطي",
      "أبغى اشوف نقاطي",
      "كم رصيدي",
      "وش عندي من نقاط"
    ]
  },
  {
    "intent": "rank",
    "phrases": [
      "وش رتبتي",
      "رتبتي",
      "ايش رتبتي",
      "اش رتبتي",
      "ما هي رتبتي",
      "الرتبة الشهرية",
      "رتبتي الشهرية",
      "آخر رتبة",
      "اخر رتبة",
      "وش آخر رتبة لي",
      "ايش الرتبة اللي حصلت عليها",
      "وش الرتبة اللي جبتها",
      "هل عندي رتبة شهرية",
      "اعطني آخر رتبة",
      "ابغى اعرف رتبتي",
      "أبغى أعرف رتبتي",
      "وش تصنيف رتبتي"
    ]
  },
  {
    "intent": "membership",
    "phrases": [
      "حالة عضويتي",
      "وضعي في العضوية",
      "عضويتي",
      "وش حالة عضويتي",
      "ايش حالة عضويتي",
      "اش حالة عضويتي",
      "هل عضويتي مجمدة",
      "انا مجمد",
      "أنا مجمد",
      "انا منسحب",
      "أنا منسحب",
      "هل انا مجمد",
      "هل أنا مجمد",
      "هل انا منسحب",
      "هل أنا منسحب",
      "وش وضعي كعضو",
      "ايش وضعي في العضوية",
      "كيف اسوي تجميد",
      "كيف أجمّد العضوية",
      "كيف انسحب",
      "كيف أنسحب",
      "وش طريقة الانسحاب",
      "وش طريقة التجميد"
    ]
  },
  {
    "intent": "reactivation",
    "phrases": [
      "متى اقدر ارجع",
      "متى أقدر أرجع",
      "متى اقدر ارجع للعضوية",
      "متى أقدر أرجع للعضوية",
      "متى ارجع",
      "متى أرجع",
      "إعادة التفعيل",
      "اعادة التفعيل",
      "طلب التفعيل",
      "طلب إعادة التفعيل",
      "طلب اعادة التفعيل",
      "هل اقدر ارجع للعضوية",
      "هل أقدر ارجع للعضوية",
      "قد ايش باقي على الرجوع",
      "كم باقي على التفعيل",
      "متى اقدم طلب التفعيل",
      "متى أقدم طلب إعادة التفعيل",
      "وش حالة طلب التفعيل",
      "ايش حالة إعادة التفعيل"
    ]
  },
  {
    "intent": "team",
    "phrases": [
      "وش فريقي",
      "فريقي",
      "اي فريقي",
      "أي فريق أنا",
      "اي فريق انا",
      "اش فريقي",
      "وش الفرق اللي انا فيها",
      "وش الفرق اللي أنا فيها",
      "في اي فريق انا",
      "في أي فريق أنا",
      "الفريق اللي انا فيه",
      "الفريق اللي أنا فيه",
      "فرقي",
      "وش فريقي الحالي",
      "ايش فريقي الحالي",
      "اش فريقي الحالي",
      "اعطني فريقي",
      "ابغى اعرف فريقي",
      "أبغى أعرف فريقي"
    ]
  },
  {
    "intent": "permissions",
    "phrases": [
      "وش صلاحياتي",
      "صلاحياتي",
      "ايش صلاحياتي",
      "اش صلاحياتي",
      "ماذا أستطيع",
      "ماذا استطيع",
      "وش اقدر اسوي",
      "وش أقدر أسوي",
      "ايش اقدر اسوي",
      "ايش أقدر أسوي",
      "اش اقدر اسوي",
      "وش مسموح لي",
      "ايش مسموح لي",
      "وش الصلاحيات حقي",
      "وش الصلاحية اللي عندي",
      "هل اقدر استخدم لوحة الادارة",
      "هل اقدر اعدل الحضور",
      "هل عندي صلاحية",
      "كيف اعرف صلاحياتي",
      "اعطني صلاحياتي",
      "ابغى اعرف صلاحياتي",
      "أبغى أعرف صلاحياتي"
    ]
  },
  {
    "intent": "summary",
    "phrases": [
      "ملخص وضعي",
      "اعطني ملخص",
      "أعطني ملخص",
      "وش وضعي",
      "ايش وضعي",
      "اش وضعي",
      "ملخص حسابي",
      "ابغى اعرف وضعي",
      "أبغى أعرف وضعي",
      "اعطني ملخصي",
      "ملخص عضويتي ونقاطي",
      "ملخص وضعي في 967",
      "كيف وضعي في 967",
      "وش اخباري في 967",
      "ابغى ملخص عن وضعي",
      "أبغى ملخص عن وضعي"
    ]
  }
]
JSON

cat > "$ROOT/knowledge/ai/README.md" <<'MD'
# مدرب 967 المحلي v1.1.0

مدرب داخلي لا يستخدم OpenAI ولا API خارجيًا.

تم توسيع التدريب ليغطي صيغًا عربية رسمية وعامية وخليجية ويمنية، مع تطبيع الاختلافات الإملائية، إزالة التشكيل، وتسامح محدود مع الأخطاء البسيطة في الكتابة.

النوايا الحالية:
- help
- next_meeting
- upcoming_meetings
- today_meetings
- meeting_details
- attendance
- excuses
- tasks
- performance
- points
- rank
- membership
- reactivation
- team
- permissions
- summary

من لوحة /panel زر **مساعد 967 الخاص** يفتح DM خاص مع المدرب. كما يمكن تنفيذ `/ai` داخل الخاص.

المساعد للقراءة والشرح فقط. لا يغيّر العضوية أو الاجتماعات أو المهام.
MD

say "💬 تفعيل وضع المحادثة الخاصة..."
cat > "$ROOT/src/interfaces/discord/commands/ai.js" <<'JS'
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { subjectFromInteraction } from '../context.js';
import { AppError } from '../../../core/errors/AppError.js';

function questionInput(){
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('ai_question')
      .setLabel('اكتب سؤالك عن 967 أو لوحتك')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(1200)
      .setPlaceholder('مثال: كم اجتماع حضرت؟ أو كيف أقدم اعتذار؟')
  );
}

function askButton(){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ai:open').setLabel('اسأل مدرب 967').setStyle(ButtonStyle.Primary).setEmoji('🤖')
  );
}

async function ensureMember(subject){
  if(!subject?.guildId||!subject?.userId||!subject?.member){
    throw new AppError('AI_MEMBER_ONLY','المساعد الخاص متاح لأعضاء سيرفر 967 فقط.');
  }
}

export async function openAIAskModal(i,a){
  if(i.guildId){
    const subject=await subjectFromInteraction(i,a.env);
    await ensureMember(subject);
    const dm=await i.user.createDM();
    await dm.send({
      content:'🤖 **مدرب 967 الخاص**\n\nهذه محادثتك الخاصة مع مدرب 967. اسأل عن اجتماعاتك وحضورك ومهامك ونقاطك وعضويتك وصلاحياتك.\n\nلن يتم إرسال ردود المدرب إلى قنوات السيرفر.',
      components:[askButton()]
    });
    return i.followUp({content:'✅ تم فتح محادثتك الخاصة مع مدرب 967. افتح الخاص مع البوت واضغط **اسأل مدرب 967** للبدء.',ephemeral:true});
  }

  const modal=new ModalBuilder().setCustomId('ai:ask').setTitle('مدرب 967 الخاص');
  modal.addComponents(questionInput());
  return i.showModal(modal);
}

async function ask(i,a,question){
  const q=String(question??'').trim();
  if(!q)throw new AppError('AI_EMPTY','اكتب سؤالك أولًا.');
  const subject=await subjectFromInteraction(i,a.env);
  await ensureMember(subject);
  await a.syncMember(subject.guild,i.user);
  const answer=await a.aiAssistantService.answer({subject,question:q});
  return i.editReply({content:`🤖 **مدرب 967 الخاص**\n\n${answer}`});
}

export async function aiCommand(i,a){
  return ask(i,a,i.options.getString('question'));
}

export async function submitAIAsk(i,a){
  return ask(i,a,i.fields.getTextInputValue('ai_question'));
}

JS

say "🔐 السماح لـ /ai داخل DM مع إبقاء بقية DM محمية..."
node --input-type=module <<'JS'
import fs from 'node:fs';
const p='src/interfaces/discord/router.js';
let s=fs.readFileSync(p,'utf8');

const old=/if\(!interaction\.guildId\)\s*\{\s*const allowed=await app\.permissionService\.canUseDm\(\{guildId:app\.env\.GUILD_ID,userId:interaction\.user\.id\}\);\s*if\(!allowed\)throw new AppError\('DM_PRIVATE',([^;]+);\s*\}/m;
if(old.test(s)){
  s=s.replace(old,(_m,msg)=>`if(!interaction.guildId){\n      const isPrivateAI=interaction.commandName==='ai'||String(interaction.customId??'').startsWith('ai:');\n      if(!isPrivateAI){\n        const allowed=await app.permissionService.canUseDm({guildId:app.env.GUILD_ID,userId:interaction.user.id});\n        if(!allowed)throw new AppError('DM_PRIVATE',${msg};\n      }\n    }`);
} else if(s.includes('permissionService.canUseDm') && !s.includes("String(interaction.customId??'').startsWith('ai:')")){
  throw new Error('router.js يحتوي بوابة DM لكن صيغتها مختلفة؛ توقفت آمنًا.');
}
fs.writeFileSync(p,s);
console.log('✅ router DM patch checked');
JS

say "🧩 تفعيل DM في تعريف /ai..."
node --input-type=module <<'JS'
import fs from 'node:fs';
const p='src/infrastructure/discord/commandDefinitions.js';
let s=fs.readFileSync(p,'utf8');
const start=s.indexOf("const ai = new SlashCommandBuilder()");
if(start<0)throw new Error('لم أجد تعريف /ai');
const ctx=s.indexOf('.setContexts(',start);
if(ctx<0)throw new Error('لم أجد setContexts لأمر /ai');
const end=s.indexOf(');',ctx);
if(end<0)throw new Error('لم أجد نهاية setContexts لأمر /ai');
const block=s.slice(ctx,end+2);
const newBlock=`.setContexts(\n    InteractionContextType.Guild,\n    InteractionContextType.BotDM\n  );`;
s=s.slice(0,ctx)+newBlock+s.slice(end+2);
fs.writeFileSync(p,s);
console.log('✅ /ai أصبح متاحًا في السيرفر والخاص');
JS

say "🔗 ربط زر مساعد 967 بالخاص..."
node --input-type=module <<'JS'
import fs from 'node:fs';
{
  const p='src/interfaces/discord/interactions/misc.js';
  let s=fs.readFileSync(p,'utf8');
  s=s.replaceAll('openAIAskModal(i);','openAIAskModal(i,a);');
  if(!s.includes('openAIAskModal(i,a)'))throw new Error('لم يتم ربط ai:open مع app.');
  fs.writeFileSync(p,s);
}
{
  const p='src/interfaces/discord/commands/panel.js';
  if(fs.existsSync(p)){
    let s=fs.readFileSync(p,'utf8');
    s=s.replaceAll("['ai:open','مساعد 967','🤖']","['ai:open','مساعد 967 الخاص','🤖']");
    s=s.replaceAll("v2Button('ai:open','مساعد 967','🤖')","v2Button('ai:open','مساعد 967 الخاص','🤖')");
    fs.writeFileSync(p,s);
  }
}
console.log('✅ AI private launcher wired');
JS

say "🧪 فحص JavaScript..."
node --check "$ROOT/src/application/services/AIAssistantService.js"
node --check "$ROOT/src/interfaces/discord/commands/ai.js"
node --check "$ROOT/src/interfaces/discord/router.js"
node --check "$ROOT/src/infrastructure/discord/commandDefinitions.js"
node --check "$ROOT/src/interfaces/discord/interactions/misc.js"

say "🧪 اختبار التدريب الموسع..."
cat > "$ROOT/tools/ai-coach-selftest.mjs" <<'JS'
import fs from 'node:fs/promises';
import { AIAssistantService } from '../src/application/services/AIAssistantService.js';

const data=JSON.parse(await fs.readFile('knowledge/ai/intents.json','utf8'));
const ai=new AIAssistantService({db:null,env:{},logger:null,permissionService:null});
ai.training=data;

const cases=[
  ['متى اجتماعي الجاي؟','next_meeting'],
  ['دحين متى أقرب اجتماع لي؟','next_meeting'],
  ['وش الاجتماعات اللي جاية؟','upcoming_meetings'],
  ['اش عندي اليوم من اجتماعات؟','today_meetings'],
  ['كم قد حضرت؟','attendance'],
  ['قد ايش نسبة حضوري؟','attendance'],
  ['كيف اسوي اعتذار؟','excuses'],
  ['وش علي من مهام؟','tasks'],
  ['ايش تقييمي؟','performance'],
  ['كم نقطة معي؟','points'],
  ['اش رتبتي؟','rank'],
  ['انا مجمد وش وضعي؟','membership'],
  ['متى اقدر ارجع للعضوية؟','reactivation'],
  ['في اي فريق انا؟','team'],
  ['وش مسموح لي؟','permissions'],
  ['ابغى اعرف وضعي في 967','summary'],
  ['What can you do','help']
];

let failed=0;
for(const [q,expected] of cases){
  const got=ai.classify(q).intent;
  const ok=got===expected;
  console.log(`${ok?'✅':'❌'} ${q} -> ${got}`);
  if(!ok)failed++;
}

for(const entry of data){
  for(const q of entry.phrases){
    const got=ai.classify(q).intent;
    if(got!==entry.intent){
      console.log(`❌ training collision: ${entry.intent} :: ${q} -> ${got}`);
      failed++;
      break;
    }
  }
}

if(failed)process.exit(1);
console.log('✅ Local AI Coach v1.1.0 self-test passed');
JS
node "$ROOT/tools/ai-coach-selftest.mjs"

say "🔎 فحص اعتماد OpenAI داخل المدرب..."
if grep -RniE "from ['\"]openai['\"]|require\(['\"]openai['\"]\)" "$ROOT/src/application/services/AIAssistantService.js" "$ROOT/src/interfaces/discord/commands/ai.js" >/dev/null 2>&1; then
  die "وجد اعتماد OpenAI في ملفات المدرب. توقفت."
fi

say "✅ التحديث اكتمل بدون إعادة تشغيل البوت."
say "📁 التدريب: $ROOT/knowledge/ai/intents.json"
say "🧠 المدرب: $ROOT/src/application/services/AIAssistantService.js"
say "💬 الخاص: /ai داخل DM أو زر مساعد 967 الخاص من /panel"
say "🛟 النسخة الاحتياطية: $BACKUP_DIR"
say "الخطوة التالية: أعد تشغيل البوت ثم نفذ node scripts/deploy.js."
