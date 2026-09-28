#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
VERSION="2.0.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/.update-backups/gemini-ai-v${VERSION}-$STAMP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

[ -d "$ROOT" ] || die "لم أجد المشروع: $ROOT"
[ -f "$ROOT/package.json" ] || die "package.json غير موجود"
[ -f "$ROOT/src/application/services/AIAssistantService.js" ] || die "AIAssistantService.js غير موجود"
[ -f "$ROOT/src/interfaces/discord/commands/ai.js" ] || die "commands/ai.js غير موجود"
[ -f "$ROOT/src/app.js" ] || die "app.js غير موجود"

mkdir -p "$BACKUP_DIR/src/application/services" "$BACKUP_DIR/knowledge/ai" "$BACKUP_DIR/tools"
cd "$ROOT"

say "============================================================"
say " Meeting 967 — Gemini AI Assistant v2.0.0"
say " مساعد 967 الحقيقي — Gemini + معرفة البوت + بيانات PostgreSQL + DM"
say "============================================================"

say "🛟 إنشاء نسخة رجوع..."
for f in \
  src/application/services/AIAssistantService.js \
  src/interfaces/discord/commands/ai.js \
  knowledge/ai/modules.md \
  tools/ai-coach-selftest.mjs \
  package.json \
  package-lock.json
 do
  [ -f "$ROOT/$f" ] && cp -f "$ROOT/$f" "$BACKUP_DIR/$f" || true
done

say "📦 تثبيت SDK الرسمي لـ Gemini..."
npm install @google/genai

say "🧠 تركيب محرك Gemini مع RAG محلي وبيانات PostgreSQL..."
cat > "$ROOT/src/application/services/AIAssistantService.js" <<'JS'
import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const MAX_Q = 4000;
const MAX_ANSWER = 1800;
const KB_TTL = 120_000;
const KB_MAX_FILES = 220;
const KB_MAX_CHARS = 900_000;
const SOURCE_SNIPPET = 1800;
const SESSION_TURNS = 10;

const SYSTEM_INSTRUCTION = `
أنت مساعد Meeting 967 الرسمي داخل البوت وتتكلم العربية بطلاقة وتفهم الفصحى والعامية واللهجات الخليجية واليمنية واختلافات الكتابة البسيطة.

مهمتك الأساسية: الإجابة عن أسئلة المستخدم حول نظام 967 اعتمادًا على الأدلة المرفقة في الطلب وعلى بيانات PostgreSQL الشخصية الحالية.

قواعد مهمة:
1) ابدأ بالإجابة مباشرة ولا تقل إنك نموذج ذكاء اصطناعي.
2) عند سؤال "كيف" اشرح طريقة الاستخدام الفعلية الموجودة في النظام بخطوات قصيرة وواضحة.
3) عند السؤال عن بيانات العضو استخدم البيانات الحالية المرفقة فقط ولا تخمن.
4) لا تنفذ أي تغيير في النظام ولا تنشئ أو تعدل أو تحذف بيانات. أنت مساعد قراءة وشرح فقط.
5) لا تكشف مفاتيح API أو التوكنات أو كلمات المرور أو محتوى .env أو الأسرار أو بيانات اعتماد قاعدة البيانات.
6) لا تخترع زرًا أو مسارًا غير موجود في الأدلة. إن لم تجد المسار الدقيق قل بوضوح إن التفاصيل غير مؤكدة ثم استخدم أقرب معلومة موثقة.
7) افصل بين "ما هو موجود في النظام" و"اقتراح تطوير". لا تعرض الاقتراح كأنه ميزة حالية.
8) عند وجود تعارض بين نص تدريبي قديم ومصدر الكود الحالي أو البيانات الحالية، اعتبر الكود الحالي والبيانات الحالية مصدر الحقيقة.
9) لا تذكر معرفات Discord أو أسماء الجداول أو SQL للمستخدم إلا عند الحاجة التقنية المباشرة.
10) أسلوبك ودود ومختصر ومباشر، ويمكن استخدام تنسيق Discord مثل **العناوين** والقوائم.
11) إذا كان السؤال غامضًا لكن يمكن استنتاج المقصود من السياق فاستنتج من السياق ولا تعيد السؤال بلا حاجة.
`;

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
    .replace(/ـ/g,'')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function words(value){
  const stop=new Set(['من','في','على','عن','الى','إلى','ما','ماذا','كيف','هل','انا','أنا','انت','أنت','هذا','هذه','ذلك','تلك','هو','هي','هم','هن','و','او','أو','لي','لك','عندي','لدي','وش','ايش','إيش','ويش','اش','ابي','أبي','ابغى','أبغى','اريد','أريد','بس','طيب','متى','وين','فين','قد','قديش','كم']);
  return norm(value).split(/\s+/).filter(x=>x.length>1&&!stop.has(x));
}
function clip(value,max=MAX_ANSWER){
  const s=String(value??'').trim();
  return s.length>max ? s.slice(0,max-1)+'…' : s;
}
function fmtDate(value){
  if(!value)return 'غير محدد';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return 'غير محدد';
  return d.toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'});
}
function safeJson(value,max=12000){
  try{return JSON.stringify(value,null,2).slice(0,max);}catch{return String(value).slice(0,max);}
}

export class AIAssistantService {
  constructor({db,env,logger,permissionService}){
    Object.assign(this,{db,env,logger,permissionService});
    this.client=null;
    this.kbCache=null;
    this.kbLoadedAt=0;
    this.sessions=new Map();
  }

  apiKey(){
    return String(this.env?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '').trim();
  }
  model(){
    return String(this.env?.GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-3.5-flash').trim();
  }
  enabled(){return Boolean(this.apiKey());}

  _client(){
    if(!this.enabled())return null;
    if(!this.client)this.client=new GoogleGenAI({apiKey:this.apiKey()});
    return this.client;
  }

  async query(sql,args=[]){
    try{return (await this.db.query(sql,args)).rows??[];}
    catch(error){
      this.logger?.debug?.('gemini-ai-query-failed',{error:error?.message??String(error)});
      return [];
    }
  }

  knowledgeDir(){
    return path.resolve(this.env?.AI_KNOWLEDGE_DIR || path.join(process.cwd(),'knowledge','ai'));
  }

  async walk(dir,out=[],depth=0){
    if(depth>5 || out.length>=KB_MAX_FILES)return out;
    let entries=[];
    try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return out;}
    for(const entry of entries){
      if(out.length>=KB_MAX_FILES)break;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){
        await this.walk(full,out,depth+1);
      }else if(entry.isFile() && /\.(md|txt|json|js|mjs)$/i.test(entry.name)){
        if(/\.env|package-lock|log|recording|storage/i.test(full))continue;
        out.push(full);
      }
    }
    return out;
  }

  async loadKnowledge(){
    const now=Date.now();
    if(this.kbCache && now-this.kbLoadedAt<KB_TTL)return this.kbCache;
    const roots=[this.knowledgeDir(),path.resolve(process.cwd(),'src')];
    const files=[];
    for(const root of roots)await this.walk(root,files,0);
    const docs=[];
    let total=0;
    for(const file of files){
      if(total>=KB_MAX_CHARS)break;
      try{
        const raw=await fs.readFile(file,'utf8');
        const text=raw.slice(0,Math.min(raw.length,50_000));
        const rel=path.relative(process.cwd(),file);
        docs.push({file:rel,text});
        total+=text.length;
      }catch(error){
        this.logger?.debug?.('gemini-ai-kb-read-failed',{file,error:error?.message??String(error)});
      }
    }
    this.kbCache=docs;
    this.kbLoadedAt=now;
    return docs;
  }

  retrieveKnowledge(question,docs){
    const q=words(question);
    const qSet=new Set(q);
    const nq=norm(question);
    return docs.map(doc=>{
      const dn=norm(doc.text);
      let score=0;
      for(const token of q){
        if(dn.includes(token))score+=1;
      }
      const lower=doc.file.toLowerCase();
      if(/task|meeting|membership|permission|record|report|panel|team|attendance|excuse|autopilot|archive|backup/.test(lower))score+=1;
      for(const key of ['تكليف','مهمة','اجتماع','عضوية','صلاح','تسجيل','تقرير','حضور','اعتذار','فريق','نسخ احتياط']){
        if(nq.includes(key)&&dn.includes(norm(key)))score+=3;
      }
      return {file:doc.file,text:doc.text,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,10).map(x=>({file:x.file,text:x.text.slice(0,SOURCE_SNIPPET),score:x.score}));
  }

  async personalContext(subject){
    const [meetings,tasks,membership,points,rank,team]=await Promise.all([
      this.query(`SELECT m.name,m.scheduled_at,m.status,t.name AS team_name
        FROM meetings m JOIN teams t ON t.id=m.team_id
        JOIN team_members tm ON tm.team_id=t.id AND tm.guild_id=m.guild_id AND tm.user_id=$2 AND tm.active=true
        WHERE m.guild_id=$1 AND m.status IN ('upcoming','ongoing') AND COALESCE(m.is_test,false)=false
          AND m.scheduled_at>=now() ORDER BY m.scheduled_at ASC LIMIT 8`,[subject.guildId,subject.userId]),
      this.query(`SELECT title,status,review_status,due_at
        FROM meeting_tasks WHERE guild_id=$1 AND assignee_user_id=$2 AND status<>'cancelled'
        ORDER BY COALESCE(due_at,created_at) ASC LIMIT 12`,[subject.guildId,subject.userId]),
      this.query(`SELECT status,return_at,withdrawn_at,reactivation_requested_at,reactivation_status,freeze_reason,withdraw_reason
        FROM membership_personal_states WHERE guild_id=$1 AND user_id=$2 LIMIT 1`,[subject.guildId,subject.userId]),
      this.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE amount>0 AND point_type<>'admin_adjustment'),0)::bigint AS points
        FROM membership_points_ledger WHERE guild_id=$1 AND user_id=$2`,[subject.guildId,subject.userId]),
      this.query(`SELECT month_start,role_key,points FROM membership_monthly_rank_awards
        WHERE guild_id=$1 AND user_id=$2 ORDER BY month_start DESC LIMIT 1`,[subject.guildId,subject.userId]),
      this.query(`SELECT t.name FROM teams t JOIN team_members tm ON tm.team_id=t.id
        WHERE tm.guild_id=$1 AND tm.user_id=$2 AND tm.active=true AND t.deleted_at IS NULL ORDER BY t.name`,[subject.guildId,subject.userId]),
    ]);

    let grants=[];
    try{grants=await this.permissionService?.grants?.(subject)??[];}catch{}
    const permissions=[...new Set(grants.filter(g=>String(g.effect)==='allow').map(g=>String(g.permission_key??g.permission??'')).filter(Boolean))].slice(0,40);

    return {
      meetings:meetings.map(x=>({name:x.name,when:fmtDate(x.scheduled_at),status:x.status,team:x.team_name})),
      tasks:tasks.map(x=>({title:x.title,status:x.status,review:x.review_status??null,due:x.due_at?fmtDate(x.due_at):null})),
      membership:membership[0]??null,
      points:points[0]?.points??0,
      rank:rank[0]??null,
      teams:team.map(x=>x.name),
      permissions,
    };
  }

  sessionKey(subject){return `${subject.guildId}:${subject.userId}`;}
  history(subject){return this.sessions.get(this.sessionKey(subject))??[];}
  pushHistory(subject,user,assistant){
    const key=this.sessionKey(subject);
    const arr=[...this.history(subject),{role:'user',text:user},{role:'assistant',text:assistant}];
    this.sessions.set(key,arr.slice(-(SESSION_TURNS*2)));
  }

  async askModel(question,subject){
    const client=this._client();
    if(!client)throw new Error('GEMINI_NOT_CONFIGURED');

    const docs=await this.loadKnowledge();
    const evidence=this.retrieveKnowledge(question,docs);
    const personal=await this.personalContext(subject);
    const history=this.history(subject);

    const evidenceText=evidence.map((x,i)=>`[${i+1}] ${x.file}\n${x.text}`).join('\n\n').slice(0,28_000);
    const context=`
=== بيانات العضو الحالية ===
${safeJson(personal,16_000)}

=== أدلة من معرفة/كود Meeting 967 ===
${evidenceText||'لا توجد مطابقة مباشرة؛ اعتمد فقط على السياق العام المرفق.'}

=== المحادثة الأخيرة ===
${history.map(x=>`${x.role}: ${x.text}`).join('\n').slice(-8_000)}
`;

    const prompt=`${context}\n\nسؤال العضو الحالي:\n${question}`;
    try{
      const response=await client.models.generateContent({
        model:this.model(),
        contents:prompt,
        config:{
          systemInstruction:SYSTEM_INSTRUCTION,
          temperature:0.25,
          maxOutputTokens:700,
        },
      });
      const text=String(response?.text??'').trim();
      if(!text)throw new Error('GEMINI_EMPTY');
      this.pushHistory(subject,question,text);
      return clip(text);
    }catch(error){
      const status=Number(error?.status??error?.code??0);
      const msg=String(error?.message??error);
      this.logger?.warn?.('gemini-ai-request-failed',{status,message:msg.slice(0,500),model:this.model()});
      if(status===401||/api key|api_key|invalid.*key|unauthenticated/i.test(msg)){
        throw new Error('GEMINI_INVALID_KEY');
      }
      if(status===429||/quota|rate.?limit|resource exhausted|too many requests/i.test(msg)){
        throw new Error('GEMINI_RATE_LIMIT');
      }
      if(/fetch|network|socket|dns|connect/i.test(msg))throw new Error('GEMINI_NETWORK');
      throw new Error('GEMINI_FAILED');
    }
  }

  async answer({subject,question}){
    const q=clean(question);
    if(!q)throw new Error('اكتب سؤالك أولًا.');
    if(!subject?.guildId||!subject?.userId)throw new Error('تعذر تحديد سياق العضو.');
    if(!this.enabled()){
      return '⚠️ مساعد Gemini غير مفعّل حاليًا. أضف GEMINI_API_KEY إلى ملف .env ثم أعد تشغيل البوت.';
    }
    try{return await this.askModel(q,subject);}
    catch(error){
      switch(error?.message){
        case 'GEMINI_INVALID_KEY': return '⚠️ مفتاح Gemini غير صالح. تأكد من GEMINI_API_KEY ثم أعد تشغيل البوت.';
        case 'GEMINI_RATE_LIMIT': return '⏳ وصلت إلى حد الاستخدام المجاني مؤقتًا. جرّب بعد قليل أو استخدم النموذج الأخف في GEMINI_MODEL.';
        case 'GEMINI_NETWORK': return '🌐 تعذر الاتصال بـ Gemini حاليًا. تحقق من اتصال Termux بالإنترنت ثم جرّب مرة أخرى.';
        default: return '⚠️ حصل خطأ أثناء تشغيل مساعد Gemini. راجع سجل البوت لمزيد من التفاصيل.';
      }
    }
  }
}
JS

say "📚 تحديث خريطة المعرفة لتستند إلى الكود الحالي أيضًا..."
cat > "$ROOT/knowledge/ai/modules.md" <<'MD'
# Meeting 967 AI Knowledge Map v2

هذا الملف يشرح نطاق النظام، لكن المصدر الأدق للتفاصيل التشغيلية هو الكود الحالي داخل `src/` وبيانات PostgreSQL الحالية.

## نطاق النظام
- اللوحة /panel وواجهات العضو والإدارة.
- الاجتماعات: إنشاء، تعديل، جدولة، إعادة جدولة، تأجيل، إلغاء، تشغيل، إنهاء، الحضور والاعتذارات.
- التسجيلات: التسجيل، التوطين/التسليم، المخرجات، الأرشفة، سلامة التسجيل، والعمال/الفايل أوفر.
- التكليفات: إنشاء التكليف من الاجتماع، عنوان التكليف، الموعد النهائي، التفاصيل، اختيار العضو، التسليم للمراجعة، المراجعة والتقييم.
- الأداء: التقييم الأسبوعي/الشهري وتقارير الأداء.
- العضوية: مراجعة العضويات، الاستمرار، التجميد، الانسحاب، طلب إعادة التفعيل.
- النقاط والرتب والمكافآت وسجل النقاط.
- الفرق والأعضاء والصلاحيات والوصول الخاص ومركز الصلاحيات.
- التقارير والمخرجات والأرشيف والنسخ الاحتياطي ومركز البيانات والتدقيق.
- الطيار الآلي والتذكيرات وتحكم الإرسال وTest Lab والدعم وفحص الصحة.

## قاعدة مهمة
المساعد في هذه النسخة للشرح والقراءة فقط ولا ينفذ عمليات تغيّر البيانات.
عند سؤال "كيف" يجب البحث في الأدلة والكود الحالي لإعطاء المسار الفعلي الموجود في البوت.
MD

say "🧪 فحص JavaScript..."
node --check "$ROOT/src/application/services/AIAssistantService.js"
node --check "$ROOT/src/interfaces/discord/commands/ai.js"
node --check "$ROOT/src/interfaces/discord/router.js"
node --check "$ROOT/src/app.js"

say "🔐 تجهيز متغيرات Gemini بدون لمس مفتاح موجود..."
ENV_FILE="$ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  if ! grep -q '^GEMINI_MODEL=' "$ENV_FILE"; then
    printf '\nGEMINI_MODEL=gemini-3.5-flash\n' >> "$ENV_FILE"
  fi
  if grep -q '^GEMINI_API_KEY=' "$ENV_FILE"; then
    say "✅ GEMINI_API_KEY موجود مسبقًا ولم يتم تغييره."
  else
    printf 'GEMINI_API_KEY=PUT_YOUR_GEMINI_API_KEY_HERE\n' >> "$ENV_FILE"
    say "⚠️ أضفت مكانًا للمفتاح فقط. لم أضع أي مفتاح حقيقي."
  fi
else
  cat > "$ENV_FILE" <<'ENV'
GEMINI_MODEL=gemini-3.5-flash
GEMINI_API_KEY=PUT_YOUR_GEMINI_API_KEY_HERE
ENV
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  say "⚠️ أنشأت .env بقالب Gemini فقط."
fi

say "🧹 تنظيف اعتماد OpenAI من الحزمة إن لم يعد مستخدمًا..."
OPENAI_IMPORTS=$(grep -RIlE "from ['\"]openai['\"]|require\(['\"]openai['\"]\)" "$ROOT/src" "$ROOT/scripts" "$ROOT/tools" 2>/dev/null | grep -v '/AIAssistantService.js$' || true)
if [ -z "$OPENAI_IMPORTS" ]; then
  if node -e "const p=require('./package.json');process.exit(p.dependencies?.openai||p.devDependencies?.openai?0:1)" 2>/dev/null; then
    npm uninstall openai >/dev/null 2>&1 || true
    say "✅ تمت إزالة حزمة OpenAI لأنها لم تعد مستخدمة في الكود."
  fi
else
  say "ℹ️ توجد ملفات أخرى تستورد OpenAI؛ لم أحذف الحزمة لحماية بقية النظام."
fi

say "🧪 اختبار إعداد Gemini المحلي..."
cat > "$ROOT/tools/gemini-ai-test.mjs" <<'JS'
import fs from 'node:fs/promises';
const env=await fs.readFile('.env','utf8').catch(()=> '');
const key=(env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]??'').trim();
const model=(env.match(/^GEMINI_MODEL=(.*)$/m)?.[1]??'gemini-3.5-flash').trim();
console.log(`🔎 Gemini model: ${model}`);
if(!key || key==='PUT_YOUR_GEMINI_API_KEY_HERE'){
  console.log('⚠️ لم يتم وضع مفتاح Gemini بعد. ثبّت المفتاح في .env ثم شغّل هذا الاختبار مرة أخرى.');
  process.exit(0);
}
const {GoogleGenAI}=await import('@google/genai');
const ai=new GoogleGenAI({apiKey:key});
const response=await ai.models.generateContent({
  model,
  contents:'رد بكلمة واحدة فقط: جاهز',
  config:{temperature:0,maxOutputTokens:16},
});
console.log(`✅ Gemini API responded: ${String(response.text??'').trim()}`);
JS
node "$ROOT/tools/gemini-ai-test.mjs"

say "✅ Gemini AI v2.0.0 installed."
say "📁 النسخة الاحتياطية: $BACKUP_DIR"
say "🔑 بعد إضافة GEMINI_API_KEY: أعد تشغيل البوت ثم نفذ node scripts/deploy.js"
