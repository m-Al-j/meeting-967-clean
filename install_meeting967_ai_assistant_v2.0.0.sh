#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
VERSION="2.0.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/.update-backups/ai-assistant-v${VERSION}-${STAMP}"
TMP="${PREFIX:-/data/data/com.termux/files/usr}/tmp/meeting967-ai-v${VERSION}-${STAMP}"

say(){ printf '%s\n' "$*"; }
cleanup(){ rm -rf "$TMP" 2>/dev/null || true; }
rollback(){
  local code=$?
  if [ "${APPLIED:-0}" = "1" ]; then
    say ""
    say "↩️ فشل بعد تطبيق التعديل — محاولة استرجاع النسخة السابقة..."
    if [ -f "$BACKUP_DIR/source.tgz" ]; then
      tar -xzf "$BACKUP_DIR/source.tgz" -C "$ROOT" || true
    fi
    if [ -f "$BACKUP_DIR/package.json" ]; then cp -f "$BACKUP_DIR/package.json" "$ROOT/package.json" || true; fi
    if [ -f "$BACKUP_DIR/package-lock.json" ]; then cp -f "$BACKUP_DIR/package-lock.json" "$ROOT/package-lock.json" || true; fi
    if [ -x "$ROOT/ops/botctl.sh" ]; then (cd "$ROOT" && ./ops/botctl.sh restart) >/dev/null 2>&1 || true; fi
  fi
  exit "$code"
}
trap cleanup EXIT
trap rollback ERR INT TERM

[ -d "$ROOT" ] || { say "❌ لم أجد المشروع: $ROOT"; exit 1; }
[ -f "$ROOT/package.json" ] || { say "❌ package.json غير موجود"; exit 1; }
[ -f "$ROOT/src/app.js" ] || { say "❌ src/app.js غير موجود"; exit 1; }
[ -f "$ROOT/src/index.js" ] || { say "❌ src/index.js غير موجود"; exit 1; }
[ -f "$ROOT/src/interfaces/discord/router.js" ] || { say "❌ router.js غير موجود"; exit 1; }
[ -f "$ROOT/src/interfaces/discord/commands/panel.js" ] || { say "❌ panel.js غير موجود"; exit 1; }
[ -f "$ROOT/src/interfaces/discord/interactions/misc.js" ] || { say "❌ misc.js غير موجود"; exit 1; }
[ -f "$ROOT/src/interfaces/discord/interactionReliability.js" ] || { say "❌ interactionReliability.js غير موجود"; exit 1; }
[ -f "$ROOT/src/infrastructure/discord/commandDefinitions.js" ] || { say "❌ commandDefinitions.js غير موجود"; exit 1; }

mkdir -p "$BACKUP_DIR" "$TMP/src/application/services" "$TMP/src/interfaces/discord/commands" "$TMP/src/interfaces/discord/interactions" "$TMP/src/ai/knowledge"

say "============================================================"
say " Meeting 967 — AI Knowledge Assistant v${VERSION}"
say " مساعد معرفة 967 + سياق العضو + حماية الصلاحيات"
say "============================================================"

say "🛟 أخذ نسخة رجوع كاملة للملفات التي سنعدلها..."
tar -czf "$BACKUP_DIR/source.tgz" -C "$ROOT" \
  package.json package-lock.json \
  src/app.js src/interfaces/discord/router.js \
  src/interfaces/discord/commands/panel.js \
  src/interfaces/discord/interactions/misc.js \
  src/interfaces/discord/interactionReliability.js \
  src/infrastructure/discord/commandDefinitions.js \
  2>/dev/null || true
cp -f "$ROOT/package.json" "$BACKUP_DIR/package.json"
[ -f "$ROOT/package-lock.json" ] && cp -f "$ROOT/package-lock.json" "$BACKUP_DIR/package-lock.json" || true

say "📦 تثبيت OpenAI SDK..."
cd "$ROOT"
npm install openai

say "🧠 إنشاء خدمة مساعد 967..."
cat > "$ROOT/src/application/services/AIAssistantService.js" <<'JS'
import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

const MAX_KB_FILES = 40;
const MAX_CHUNK_CHARS = 4200;
const MAX_KNOWLEDGE_CHARS = 12000;
const MAX_ANSWER_CHARS = 3500;

const AR_STOP = new Set([
  'من','عن','في','على','الى','إلى','ما','ماذا','كيف','هل','انا','أنا','انت','أنت',
  'هذا','هذه','ذلك','تلك','هو','هي','هم','ثم','او','أو','و','يا','مع','لي','لك','عندي',
  'عليه','علي','فيه','فيها','منه','لدي','عشان','بس','طيب','وش','ايش','كيف','وين','متى'
]);

function clean(value, max=1000){
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,' ').trim().slice(0,max);
}
function tokens(text){
  return clean(text, 6000)
    .toLocaleLowerCase('ar')
    .replace(/[^\p{L}\p{N}_]+/gu,' ')
    .split(/\s+/)
    .filter(x=>x.length>1 && !AR_STOP.has(x));
}
function clip(text,max){return clean(text,max);}
function fmtDate(value){
  if(!value)return 'غير محدد';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return 'غير محدد';
  return d.toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'});
}
function unique(values){return [...new Set((values??[]).map(x=>String(x)).filter(Boolean))];}

export class AIAssistantService {
  constructor({db,env,logger,permissionService}){
    Object.assign(this,{db,env,logger,permissionService});
    this.client=null;
    this.kbCache=null;
    this.kbLoadedAt=0;
    this.kbTtlMs=5*60*1000;
  }

  enabled(){return Boolean(String(this.env?.OPENAI_API_KEY??process.env.OPENAI_API_KEY??'').trim());}

  _client(){
    if(!this.enabled())return null;
    if(!this.client){
      this.client=new OpenAI({apiKey:String(this.env?.OPENAI_API_KEY??process.env.OPENAI_API_KEY).trim()});
    }
    return this.client;
  }

  knowledgeDir(){
    return path.resolve(
      this.env?.AI_KNOWLEDGE_DIR ||
      path.join(process.cwd(),'knowledge','ai')
    );
  }

  async _walk(dir,depth=0){
    if(depth>4)return [];
    const out=[];
    let entries=[];
    try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return out;}
    for(const entry of entries.slice(0,MAX_KB_FILES)){
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())out.push(...await this._walk(full,depth+1));
      else if(entry.isFile() && entry.name.toLowerCase().endsWith('.md'))out.push(full);
      if(out.length>=MAX_KB_FILES)break;
    }
    return out.slice(0,MAX_KB_FILES);
  }

  async _knowledge(){
    const now=Date.now();
    if(this.kbCache && now-this.kbLoadedAt<this.kbTtlMs)return this.kbCache;
    const files=await this._walk(this.knowledgeDir());
    const docs=[];
    for(const file of files){
      try{
        const raw=await fs.readFile(file,'utf8');
        const parts=raw.split(/\n(?=#+\s)/g);
        for(const part of parts){
          const text=part.trim();
          if(!text)continue;
          docs.push({file:path.relative(process.cwd(),file),text:clip(text,MAX_CHUNK_CHARS),tokens:new Set(tokens(text))});
        }
      }catch(error){this.logger?.warn?.('ai-kb-read-failed',{file,error:error?.message??String(error)});}
    }
    this.kbCache=docs;
    this.kbLoadedAt=now;
    return docs;
  }

  async _retrieveKnowledge(question){
    const docs=await this._knowledge();
    if(!docs.length)return '';
    const q=new Set(tokens(question));
    const ranked=docs.map(doc=>{
      let score=0;
      for(const t of q)if(doc.tokens.has(t))score+=1;
      const raw=doc.text.toLocaleLowerCase('ar');
      if(raw.includes('المكاف'))score += /مكاف|نقاط|رتب/.test(question)?3:0;
      if(raw.includes('الاعتذار'))score += /اعتذار|اعتذ/.test(question)?3:0;
      if(raw.includes('الاجتماع'))score += /اجتماع|اجتماعات/.test(question)?3:0;
      if(raw.includes('العضوي'))score += /عضوية|تجميد|انسحاب|إعادة/.test(question)?3:0;
      if(raw.includes('الصلاح'))score += /صلاح/.test(question)?3:0;
      return {...doc,score};
    }).sort((a,b)=>b.score-a.score);
    const selected=ranked.filter(x=>x.score>0).slice(0,6);
    const fallback=selected.length?selected:ranked.slice(0,3);
    return clip(fallback.map(x=>`[${x.file}]\n${x.text}`).join('\n\n---\n\n'),MAX_KNOWLEDGE_CHARS);
  }

  async _query(sql,args=[]){
    try{return (await this.db.query(sql,args)).rows??[];}catch(error){
      this.logger?.debug?.('ai-data-query-skipped',{error:error?.message??String(error)});
      return [];
    }
  }

  async _subjectPermissions(subject){
    const grants=await this.permissionService?.grants?.(subject).catch?.(()=>[]) ?? [];
    return grants.map(g=>({
      permission:String(g.permission_key??''),
      effect:String(g.effect??''),
      scope:String(g.scope_type??'global'),
      scopeId:g.scope_id?String(g.scope_id):null,
      source:String(g.source??'')
    }));
  }

  async _personalContext(subject){
    const guildId=String(subject.guildId);
    const userId=String(subject.userId);

    const [userRows,teamRows,upcomingRows,attendanceRows,excuseRows,taskRows,perfRows,pointsRows,awardRows,membershipRows]=await Promise.all([
      this._query(`SELECT id,COALESCE(display_name,username,id::text) AS display_name,username FROM users WHERE id=$1`,[userId]),
      this._query(`SELECT t.id,t.name FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.guild_id=$1 AND tm.user_id=$2 AND tm.active=true AND t.deleted_at IS NULL ORDER BY t.name`,[guildId,userId]),
      this._query(`SELECT m.id,m.name,m.scheduled_at,m.status,t.name AS team_name FROM meetings m JOIN teams t ON t.id=m.team_id JOIN team_members tm ON tm.team_id=t.id AND tm.guild_id=m.guild_id AND tm.user_id=$2 AND tm.active=true WHERE m.guild_id=$1 AND m.status IN ('upcoming','ongoing') AND m.scheduled_at>=now() ORDER BY m.scheduled_at ASC LIMIT 8`,[guildId,userId]),
      this._query(`SELECT COUNT(*)::int AS meetings,COUNT(*) FILTER(WHERE a.status IN ('present','late'))::int AS attended,COUNT(*) FILTER(WHERE a.status='late')::int AS late,COUNT(*) FILTER(WHERE a.status='absent')::int AS absent,COUNT(*) FILTER(WHERE a.status='excused')::int AS excused,COALESCE(AVG(a.presence_ratio)*100,0)::numeric AS avg_presence FROM meeting_member_snapshots s JOIN meetings m ON m.id=s.meeting_id LEFT JOIN attendance a ON a.meeting_id=s.meeting_id AND a.user_id=s.user_id WHERE m.guild_id=$1 AND s.user_id=$2 AND m.status='ended'`,[guildId,userId]),
      this._query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='approved')::int AS approved,COUNT(*) FILTER(WHERE status='pending')::int AS pending,COUNT(*) FILTER(WHERE status='rejected')::int AS rejected FROM excuses WHERE user_id=$2 AND meeting_id IN (SELECT id FROM meetings WHERE guild_id=$1)`,[guildId,userId]),
      this._query(`SELECT COUNT(*) FILTER(WHERE status<>'cancelled')::int AS assigned,COUNT(*) FILTER(WHERE status='done' AND review_status='approved')::int AS approved,COUNT(*) FILTER(WHERE review_status='submitted')::int AS submitted,COUNT(*) FILTER(WHERE review_status='rejected')::int AS rejected,COUNT(*) FILTER(WHERE status IN ('pending','in_progress') AND due_at IS NOT NULL AND due_at<now())::int AS overdue FROM meeting_tasks WHERE guild_id=$1 AND assignee_user_id=$2`,[guildId,userId]),
      this._query(`SELECT period_type,range_start,range_end,generated_at,score,metrics FROM member_performance_reports WHERE guild_id=$1 AND user_id=$2 ORDER BY generated_at DESC LIMIT 4`,[guildId,userId]),
      this._query(`SELECT COALESCE(SUM(amount) FILTER(WHERE amount>0 AND point_type<>'admin_adjustment'),0)::bigint AS points FROM membership_points_ledger WHERE guild_id=$1 AND user_id=$2`,[guildId,userId]),
      this._query(`SELECT month_start,role_key,points FROM membership_monthly_rank_awards WHERE guild_id=$1 AND user_id=$2 ORDER BY month_start DESC LIMIT 3`,[guildId,userId]),
      this._query(`SELECT status,freeze_start_at,return_at,freeze_reason,withdrawn_at,withdraw_reason,reactivation_requested_at,reactivation_status FROM membership_personal_states WHERE guild_id=$1 AND user_id=$2`,[guildId,userId])
    ]);

    const permissions=await this._subjectPermissions(subject);
    const allowed=unique(permissions.filter(x=>x.effect==='allow').map(x=>x.permission));
    const user=userRows[0]??{id:userId,display_name:userId};
    const att=attendanceRows[0]??{meetings:0,attended:0,late:0,absent:0,excused:0,avg_presence:0};
    const exc=excuseRows[0]??{total:0,approved:0,pending:0,rejected:0};
    const task=taskRows[0]??{assigned:0,approved:0,submitted:0,rejected:0,overdue:0};
    const mem=membershipRows[0]??null;
    const points=pointsRows[0]?.points??0;

    return {
      identity:{id:userId,displayName:String(user.display_name??user.username??userId),username:user.username?String(user.username):null},
      teams:teamRows.map(x=>({id:String(x.id),name:String(x.name)})),
      membership:mem?{
        status:String(mem.status??'active'),
        returnAt:mem.return_at?fmtDate(mem.return_at):null,
        reactivationStatus:mem.reactivation_status?String(mem.reactivation_status):null
      }:{status:'active'},
      meetings:{
        upcoming:upcomingRows.map(x=>({id:String(x.id),name:String(x.name),team:String(x.team_name),scheduledAt:fmtDate(x.scheduled_at),status:String(x.status)}))
      },
      attendance:{
        totalEnded:Number(att.meetings||0),attended:Number(att.attended||0),late:Number(att.late||0),absent:Number(att.absent||0),excused:Number(att.excused||0),averagePresence:Number(att.avg_presence||0)
      },
      excuses:{total:Number(exc.total||0),approved:Number(exc.approved||0),pending:Number(exc.pending||0),rejected:Number(exc.rejected||0)},
      tasks:{assigned:Number(task.assigned||0),approved:Number(task.approved||0),submitted:Number(task.submitted||0),rejected:Number(task.rejected||0),overdue:Number(task.overdue||0)},
      performance:{latest:perfRows.length?{
        period:String(perfRows[0].period_type??''),score:perfRows[0].score===null?null:Number(perfRows[0].score),generatedAt:fmtDate(perfRows[0].generated_at)
      }:null},
      rewards:{lifetimePositivePoints:Number(points),latestMonthlyAwards:awardRows.map(x=>({monthStart:fmtDate(x.month_start),roleKey:String(x.role_key),points:Number(x.points||0)}))},
      access:{isOwner:this.permissionService?.isOwner?.(userId)??false,isSuperAdmin:await this.permissionService?.isSuperAdmin?.(subject)??false,allowedPermissions:allowed.slice(0,60),grantScopes:permissions.slice(0,80)}
    };
  }

  _instructions(){
    return `أنت مساعد المعرفة الرسمي لحركة 967 وعمليات 967.
أجب بالعربية وبأسلوب واضح وقريب من المستخدم، ويمكن استخدام لهجة سعودية/يمنية خفيفة دون مبالغة.
أنت مساعد معرفة ولست وكيلاً مستقلًا: لا تنفذ إجراءات، ولا تخترع بيانات، ولا تغيّر حالة العضو.
اعتمد على المعرفة المرفقة وبيانات العضو الحية فقط.
قواعد مهمة:
1) عندما يسأل المستخدم عن نفسه استخدم السياق الشخصي المعطى لك.
2) لا تكشف بيانات شخص آخر أو تقييمه أو حضوره أو صلاحياته أو معلوماته الخاصة.
3) لا تستنتج صلاحية غير موجودة في access.allowedPermissions أو access.isOwner/isSuperAdmin.
4) إذا لم تجد معلومة في المعرفة أو السياق، قل بوضوح إن المعلومة غير متوفرة لديك ولا تهبد.
5) لا تعرض أسرارًا تقنية أو مفاتيح API أو SQL أو أسماء جداول داخلية إلا عند الحاجة لإجابة تقنية للإدارة.
6) عند شرح إجراء، اشرح خطوات استخدام الواجهة الحالية كما هي في المعرفة. لا تقل إنك نفذت شيئًا.
7) عند ذكر أرقام العضو، قدّمها كبيانات نظام حالية وليست حكمًا شخصيًا.
8) إذا كان السؤال غامضًا، اطلب تحديد المقصود بجملة واحدة فقط.`;
  }

  async answer({subject,question}){
    const q=clean(question,1200);
    if(!q)throw new Error('اكتب سؤالك أولًا.');
    const client=this._client();
    if(!client)throw new Error('مساعد الذكاء الاصطناعي غير مفعّل بعد. أضف OPENAI_API_KEY في .env ثم أعد تشغيل البوت.');

    const [knowledge,context]=await Promise.all([
      this._retrieveKnowledge(q),
      this._personalContext(subject)
    ]);

    const payload={
      question:q,
      personalContext:context,
      knowledge:knowledge||'لا توجد مقاطع معرفة مطابقة.'
    };

    const response=await client.responses.create({
      model:String(this.env?.OPENAI_MODEL??process.env.OPENAI_MODEL??'gpt-5.6-luna'),
      instructions:this._instructions(),
      input:JSON.stringify(payload),
      max_output_tokens:1000
    });

    const text=String(response.output_text??'').trim();
    if(!text)throw new Error('تعذر توليد إجابة من المساعد.');
    return clip(text,MAX_ANSWER_CHARS);
  }
}
JS

say "🪄 إنشاء واجهة /ai والـModal..."
cat > "$ROOT/src/interfaces/discord/commands/ai.js" <<'JS'
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
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

export function openAIAskModal(i){
  const modal=new ModalBuilder().setCustomId('ai:ask').setTitle('مساعد 967');
  modal.addComponents(questionInput());
  return i.showModal(modal);
}

async function ask(i,a,question){
  const q=String(question??'').trim();
  if(!q)throw new AppError('AI_EMPTY','اكتب سؤالك أولًا.');
  const subject=await subjectFromInteraction(i,a.env);
  await a.syncMember(subject.guild,i.user);
  const answer=await a.aiAssistantService.answer({subject,question:q});
  return i.editReply({content:`🤖 **مساعد 967**\n\n${answer}`});
}

export async function aiCommand(i,a){
  return ask(i,a,i.options.getString('question'));
}

export async function submitAIAsk(i,a){
  return ask(i,a,i.fields.getTextInputValue('ai_question'));
}
JS

say "📚 إنشاء قاعدة المعرفة العربية الأولى..."
cat > "$ROOT/knowledge/ai/00-system.md" <<'MD'
# هوية مساعد 967

مساعد 967 هو مساعد معرفة رسمي مرتبط بنظام Operations 967.
وظيفته شرح الأنظمة، شرح استخدام اللوحة، والإجابة عن الأسئلة الشخصية التي يستطيع النظام عرضها للعضو نفسه.

لا ينفذ المساعد إجراءات نيابة عن العضو في الإصدار 2.0.0. إذا سأل العضو كيف ينفذ إجراءً، يشرح الخطوات فقط.
MD

cat > "$ROOT/knowledge/ai/10-personal-panel.md" <<'MD'
# لوحة العضو الشخصية

من /panel توجد مساحة شخصية للعضو تشمل أدوات مثل:
- تكليفاتي
- اجتماعاتي
- اعتذاراتي
- فريقي
- سجل حضوري
- دليل الاستخدام

المبدأ: الأدوات الشخصية تبقى متاحة للعضو حتى لو كان لديه صلاحيات إدارية، بينما أدوات الإدارة تظهر حسب الصلاحية.

داخل النظام توجد أيضًا شاشة لإدارة العضوية الشخصية، وتظهر الأزرار بحسب حالة العضوية. من الوظائف المدعومة حاليًا التجميد، الانسحاب، تفاصيل التجميد، طلب إعادة التفعيل بعد الأهلية، وإدارة الفريق المساند عند السماح بذلك.
MD

cat > "$ROOT/knowledge/ai/20-meetings-attendance-excuses.md" <<'MD'
# الاجتماعات والحضور والاعتذارات

حالات الاجتماع الأساسية:
- upcoming = قادم
- ongoing = جاري
- ended = منتهي
- canceled = ملغي
- postponed = مؤجل

العضو يستطيع من مساحته الشخصية رؤية اجتماعاته، ويمكنه استخدام مسار الاعتذارات لتقديم اعتذار للاجتماعات المرتبطة بفرقه التي يحق له الاعتذار عنها.

الحضور يعتمد على سجلات الاجتماع الفعلية، ويمكن أن تكون الحالة حاضر أو متأخر أو غائب أو معتذر. يحسب النظام كذلك مدة الجلسات ونسبة الحضور، وتوجد حدود وتعريفات واضحة داخل نظام التقارير.

إذا سأل العضو: متى اجتماعي القادم؟ استخدم بيانات الاجتماعات الحية المرفقة بالسياق الشخصي.
إذا سأل: كم اجتماع حضرت؟ استخدم رقم attended في السياق الشخصي.
MD

cat > "$ROOT/knowledge/ai/30-membership.md" <<'MD'
# العضوية والتجميد والانسحاب

الحالات الشخصية التي قد تظهر للعضو:
- نشطة
- مجمدة
- منسحب

التجميد إجراء مؤقت ويعرض النظام تاريخ العودة وسبب التجميد عند توفرهما.

الانسحاب يسجل حالة العضوية ولا يعني حذف السجل التاريخي. بعد انتهاء مدة الأهلية يمكن للعضو طلب إعادة التفعيل، والطلب يمر بالمراجعة ولا يعني موافقة تلقائية.

من الأفضل استخدام عبارة "طلب إعادة التفعيل" بدل "إعادة التفعيل تلقائيًا" لأن النظام يسجل الطلب للمراجعة.
MD

cat > "$ROOT/knowledge/ai/40-tasks-performance.md" <<'MD'
# التكليفات والتقييم

في المساحة الشخصية يوجد قسم "تكليفاتي وتقييمي".

المهام لها حالات مثل لم يبدأ، قيد التنفيذ، مكتملة، ومراجعة التسليم. اكتمال المهمة في التقارير لا يعني اعتمادها تلقائيًا؛ اعتماد المراجع جزء من دورة التقييم.

تقارير الأداء تستخدم سجلات فعلية للاجتماعات والحضور والمهام. قد يعرض النظام تقييمًا رقميًا أو حالة تفيد بعدم توفر بيانات كافية للفترة.

عندما يسأل العضو عن تقييمه، استخدم أحدث score متاح في السياق الشخصي ولا تخترع نتيجة إذا لم توجد.
MD

cat > "$ROOT/knowledge/ai/50-rewards.md" <<'MD'
# نظام المكافآت والنقاط

يعتمد نظام العضوية بالمكافآت على سجل نقاط داخل النظام، ويستخدم التقييم الشهري للنقاط الإيجابية المكتسبة خلال الشهر المغلق.

الأدوار الأساسية:
- عضو عادي
- عضو جديد

وتوجد رتب شهرية مكتسبة أعلى من الدور الأساسي. في التصميم الحالي المعتمد عند إعداد هذه المعرفة تكون حدود الرتب الشهرية:
- مشارك: 100 نقطة
- متفاعل: 250 نقطة
- نشط: 500 نقطة
- متميز: 1000 نقطة

التقييم الشهري يعتمد على نقاط الفترة الشهرية وليس على جمع تاريخي قديم لغرض منح الرتبة الشهرية.

عند سؤال عضو عن نقاطه أو آخر رتبة شهرية، استخدم بيانات rewards المرفقة له بدل تخمينها.
عند سؤال العضو عن "كيف أحصل على نقاط؟" اشرح مصادر النقاط المعتمدة في النظام إذا كانت موجودة في الوثائق الحالية، ولا تخترع مصدرًا غير موثق.
MD

cat > "$ROOT/knowledge/ai/60-permissions.md" <<'MD'
# الصلاحيات والنطاق

نظام الصلاحيات في Operations 967 متعدد المصادر: مالك النظام، صلاحيات مستخدم مباشرة، صلاحيات رتب Discord، وصلاحيات مرتبطة بالفريق.

النطاقات الأساسية:
- global = على مستوى النظام
- team = ضمن فريق محدد
- meeting = ضمن اجتماع محدد

المبدأ الأمني: إخفاء الزر في الواجهة ليس هو الحماية الوحيدة. يجب أن يعاد فحص الصلاحية في الخادم قبل قراءة أو كتابة البيانات الحساسة.

عند السؤال "وش صلاحياتي؟" يمكن للمساعد تلخيص الصلاحيات المسموح بها في السياق المرفق للعضو.
عند السؤال عن صلاحية لا تظهر في سياقه، يجب ألا يدعي امتلاكها.
MD

cat > "$ROOT/knowledge/ai/70-style.md" <<'MD'
# أسلوب الرد

- ابدأ بالإجابة مباشرة.
- استخدم العربية الواضحة.
- إذا كان السؤال "كيف" قدم خطوات قصيرة ومرتبة.
- إذا كان السؤال عن رقم شخصي، اعرض الرقم والحالة المرتبطة به فقط.
- لا تكرر كل بيانات العضو في كل إجابة.
- لا تعرض معرفات Discord أو تفاصيل قاعدة البيانات إلا إذا كانت مطلوبة ومسموحًا بها.
- إذا كانت المعلومة غير موجودة قل: "ما عندي هذه المعلومة حاليًا" بدل التخمين.
MD

say "🔧 تعديل app.js وربط الخدمة..."
cat > "$TMP/patch.py" <<'PY'
from pathlib import Path
import re

root=Path(__file__).resolve().parents[3]  # /tmp/.../meeting... maybe not usable
PY

# Generate a second patcher directly in the project so path logic is deterministic.
cat > "$TMP/patch-project.mjs" <<'JS'
import fs from 'node:fs';
import path from 'node:path';

const root=process.argv[2];
function read(rel){return fs.readFileSync(path.join(root,rel),'utf8');}
function write(rel,text){fs.writeFileSync(path.join(root,rel),text);}
function once(text,pattern,replacement,label){
  if(text.includes(label)) return text;
  const out=text.replace(pattern,replacement);
  if(out===text) throw new Error(`لم أجد نقطة الربط: ${label}`);
  return out;
}

// app.js
{
  let s=read('src/app.js');
  s=once(
    s,
    "import { MemberPerformanceService } from './application/services/MemberPerformanceService.js';",
    "import { MemberPerformanceService } from './application/services/MemberPerformanceService.js';\nimport { AIAssistantService } from './application/services/AIAssistantService.js';",
    "import { AIAssistantService"
  );
  s=once(
    s,
    "    const memberPerformanceService=new MemberPerformanceService({db:pool,audit,env});",
    "    const memberPerformanceService=new MemberPerformanceService({db:pool,audit,env});\n    const aiAssistantService=new AIAssistantService({db:pool,env,logger,permissionService});",
    "const aiAssistantService=new AIAssistantService"
  );
  s=once(

    s,

    "  return {\n    membershipReviewService,memberPerformanceService,pointsService,",

    "  return {\n    aiAssistantService,\n    membershipReviewService,memberPerformanceService,pointsService,",

    "aiAssistantService,\n    membershipReviewService"

  );
  write('src/app.js',s);
}

// commandDefinitions.js
{
  let s=read('src/infrastructure/discord/commandDefinitions.js');
  const insert=`\nconst ai = new SlashCommandBuilder()\n  .setName('ai')\n  .setDescription('اسأل مساعد 967 عن المبادرة أو لوحتك الشخصية')\n  .addStringOption(option => option\n    .setName('question')\n    .setDescription('اكتب سؤالك')\n    .setRequired(true)\n    .setMaxLength(1200))\n  .setContexts(\n    InteractionContextType.Guild\n  );\n`;
  if(!s.includes("setName('ai')")){
    const marker=/export const commandBuilders = \[([^\]]+)\];/;
    const m=s.match(marker);
    if(!m)throw new Error('لم أجد commandBuilders');
    s=s.replace(marker,insert+"\nexport const commandBuilders = ["+m[1].replace(/\s*$/,'')+(m[1].trim().endsWith(',')?'':' ,')+' ai];');
  }
  write('src/infrastructure/discord/commandDefinitions.js',s);
}

// router.js
{
  let s=read('src/interfaces/discord/router.js');
  if(!s.includes("import { aiCommand } from './commands/ai.js';")){
    const anchor="import { healthCommand } from './commands/health.js';";
    s=s.replace(anchor,anchor+"\nimport { aiCommand } from './commands/ai.js';");
  }
  if(!s.includes('const commands={setup:setupCommand,panel:panelCommand,health:healthCommand,ai:aiCommand};')){
    s=s.replace('const commands={setup:setupCommand,panel:panelCommand,health:healthCommand};','const commands={setup:setupCommand,panel:panelCommand,health:healthCommand,ai:aiCommand};');
  }
  write('src/interfaces/discord/router.js',s);
}

// panel.js — add assistant to personal hub and quick actions.
{
  let s=read('src/interfaces/discord/commands/panel.js');
  if(!s.includes("['ai:open','مساعد 967','🤖']")){
    s=s.replace("  ['member:attendance','حضوري','✅']\n];","  ['member:attendance','حضوري','✅'],\n  ['ai:open','مساعد 967','🤖']\n];");
  }
  if(!s.includes("v2Button('ai:open','مساعد 967','🤖')")){
    s=s.replace("  actions.push(v2Button('panel:guide','دليل الاستخدام','📖'));","  actions.push(v2Button('ai:open','مساعد 967','🤖'));\n  actions.push(v2Button('panel:guide','دليل الاستخدام','📖'));");
    s=s.replace("  return actions.slice(0,5);","  return actions.slice(0,6);");
  }
  write('src/interfaces/discord/commands/panel.js',s);
}

// interactionReliability.js — ai button opens a modal before defer.
{
  let s=read('src/interfaces/discord/interactionReliability.js');
  if(!s.includes("id => id === 'ai:open'")){
    const anchor="  id => id === 'support:help',";
    s=s.replace(anchor,anchor+"\n  id => id === 'ai:open',");
  }
  write('src/interfaces/discord/interactionReliability.js',s);
}

// misc.js — AI button + modal submit live here to avoid creating another dispatcher category.
{
  let s=read('src/interfaces/discord/interactions/misc.js');
  if(!s.includes("from '../commands/ai.js'")){
    const anchor="import {refreshPanel,personalGuide,panelHub,panelSection} from '../commands/panel.js';";
    s=s.replace(anchor,anchor+"\nimport {openAIAskModal,submitAIAsk} from '../commands/ai.js';");
  }
  if(!s.includes("if(id==='ai:open')return openAIAskModal(i);")){
    const anchor="  if(id==='owner:messages'||id.startsWith('owner:messages:'))return ownerMessages(i,a,s,id);";
    if(!s.includes(anchor))throw new Error('لم أجد بداية handleMisc');
    s=s.replace(anchor,"  if(id==='ai:open')return openAIAskModal(i);\n  if(id==='ai:ask')return submitAIAsk(i,a);\n"+anchor);
  }
  write('src/interfaces/discord/interactions/misc.js',s);
}

console.log('✅ source patches applied');
JS
node "$TMP/patch-project.mjs" "$ROOT"

say "🧪 فحص JavaScript..."
node --check "$ROOT/src/application/services/AIAssistantService.js"
node --check "$ROOT/src/interfaces/discord/commands/ai.js"
node --check "$ROOT/src/app.js"
node --check "$ROOT/src/infrastructure/discord/commandDefinitions.js"
node --check "$ROOT/src/interfaces/discord/router.js"
node --check "$ROOT/src/interfaces/discord/commands/panel.js"
node --check "$ROOT/src/interfaces/discord/interactions/misc.js"
node --check "$ROOT/src/interfaces/discord/interactionReliability.js"

say "🔐 تجهيز متغيرات البيئة بدون لمس أي مفتاح موجود..."
ENV_FILE="$ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  if grep -q '^OPENAI_MODEL=' "$ENV_FILE"; then
    sed -i 's/^OPENAI_MODEL=.*/OPENAI_MODEL=gpt-5.6-luna/' "$ENV_FILE"
  else
    printf '\nOPENAI_MODEL=gpt-5.6-luna\n' >> "$ENV_FILE"
  fi
  if ! grep -q '^OPENAI_API_KEY=' "$ENV_FILE"; then
    printf 'OPENAI_API_KEY=PUT_YOUR_OPENAI_API_KEY_HERE\n' >> "$ENV_FILE"
    say "⚠️ أضفت مكانًا فارغًا لـ OPENAI_API_KEY فقط؛ لا يوجد مفتاح داخل الملف."
  fi
else
  cat > "$ENV_FILE" <<'ENV'
OPENAI_MODEL=gpt-5.6-luna
OPENAI_API_KEY=PUT_YOUR_OPENAI_API_KEY_HERE
ENV
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  say "⚠️ .env لم يكن موجودًا؛ أنشأت قالبًا فقط بدون سر حقيقي."
fi

say "🧪 فحص وجود الملفات..."
for f in \
  src/application/services/AIAssistantService.js \
  src/interfaces/discord/commands/ai.js \
  knowledge/ai/00-system.md \
  knowledge/ai/50-rewards.md
 do
  [ -f "$ROOT/$f" ] || { say "❌ ملف ناقص: $f"; exit 1; }
 done

grep -q "setName('ai')" "$ROOT/src/infrastructure/discord/commandDefinitions.js"
grep -q "aiAssistantService" "$ROOT/src/app.js"
grep -q "id === 'ai:open'" "$ROOT/src/interfaces/discord/interactionReliability.js"
grep -q "if(id==='ai:ask')" "$ROOT/src/interfaces/discord/interactions/misc.js"
grep -q "ai:open" "$ROOT/src/interfaces/discord/commands/panel.js"

APPLIED=1
say "🟢 التحديث الكتابي اكتمل."

say "🛑 إعادة تشغيل البوت..."
if [ -x "$ROOT/ops/botctl.sh" ]; then
  (cd "$ROOT" && ./ops/botctl.sh restart)
else
  say "⚠️ لا يوجد botctl.sh — أعد تشغيل البوت بالطريقة المعتادة."
fi

say ""
say "============================================================"
say " ✅ AI Assistant v${VERSION} جاهز"
say "============================================================"
say "1) ضع مفتاحك في: $ENV_FILE"
say "2) الأمر المباشر: /ai"
say "3) لوحة /panel > مساحتي > مساعد 967"
say "4) المعرفة قابلة للتعديل هنا: $ROOT/knowledge/ai/"
say "5) النسخة الاحتياطية: $BACKUP_DIR/source.tgz"
say ""
say "المساعد لا ينفذ إجراءات؛ يشرح ويعرض بيانات العضو المسموح بها فقط."
