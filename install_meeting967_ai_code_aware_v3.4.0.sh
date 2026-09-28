#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.4.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-code-aware-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

say "============================================================"
say " Meeting 967 — AI Code-Aware v${VERSION}"
say " AI يقرأ الكود الحالي قبل الإجابة عن طريقة عمل البوت"
say "============================================================"

for f in \
  src/application/services/AIAgentService.js \
  src/application/services/AIAssistantService.js \
  src/application/services/AIChatRoomService.js
do
  if [ -f "$f" ]; then
    mkdir -p "$BACKUP/$(dirname "$f")"
    cp -a "$f" "$BACKUP/$f"
  fi
done

say "🧠 إنشاء محرك فحص الكود..."

cat > src/application/services/AICodebaseService.js <<'JS'
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR=path.resolve(process.cwd());
const ALLOWED_DIRS=[
  'src',
  'knowledge/ai',
  'migrations',
  'tests',
  'ops',
];
const ALLOWED_FILES=new Set(['package.json']);
const DENY_DIRS=new Set([
  'node_modules',
  '.git',
  'storage',
  'recordings',
  'backups',
  '.update-backups',
  '.runtime',
]);
const DENY_NAMES=new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'credentials.json',
  'token.json',
]);
const ALLOWED_EXT=new Set([
  '.js','.mjs','.cjs','.json','.sql','.md','.sh','.txt','.ts','.tsx','.jsx',
]);

function normalize(value){
  return String(value??'')
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[ًٌٍَُِّْـ]/g,'')
    .replace(/[أإآٱ]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/ة/g,'ه')
    .replace(/\s+/g,' ')
    .trim();
}

const SYNONYMS=[
  [['كلف','تكليف','مهمه','مهمة','تكليفات'],['task','tasks','task:','meeting_tasks','TaskService']],
  [['المكلف','مكلف','شخص','عضو','اعضاء','أعضاء'],['assignee','member','member-search','assigneeUserId','user']],
  [['انشاء','إنشاء','اضافه','إضافة'],['create','submit','save']],
  [['لوحه','لوحة','بانل','panel'],['panel','member:tasks','admin:tasks']],
  [['اجتماع','اجتماعات','موعد'],['meeting','meetings','scheduled_at']],
  [['صلاحية','صلاحيات','اذن','إذن'],['permission','permissions','permissionService','tasks.manage']],
  [['بوت','البوت','نظام','النظام'],['router','componentDispatcher','interaction','index.js','app.js']],
  [['انسحاب','تجميد','استمرار','عضويه','عضوية'],['membership','withdraw','freeze','reactivation','membership_personal_states']],
  [['تسجيل','التسجيل','صوت','تسجيل صوت'],['recording','RecordingService','voiceState']],
  [['تقرير','تقارير'],['report','ReportService','reports']],
  [['ذكاء','ذكاء اصطناعي','ai','gemini'],['AIAgentService','AIAssistantService','Gemini','AI']],
];

function expandedTerms(query){
  const q=normalize(query);
  const terms=new Set(
    q.split(/[^\\p{L}\\p{N}_:$.-]+/u).filter(x=>x.length>1)
  );

  for(const [ar,en] of SYNONYMS){
    if(ar.some(x=>q.includes(normalize(x)))){
      for(const t of en)terms.add(normalize(t));
    }
  }
  return [...terms].slice(0,40);
}

async function existsFile(file){
  try{
    const st=await fs.stat(file);
    return st.isFile();
  }catch{return false;}
}

function safeRelative(file){
  const rel=path.relative(ROOT_DIR,file).replaceAll(path.sep,'/');
  if(!rel||rel.startsWith('../')||path.isAbsolute(rel))return false;

  if(DENY_NAMES.has(path.basename(rel)))return false;

  const parts=rel.split('/');
  if(parts.some(x=>DENY_DIRS.has(x)))return false;

  if(ALLOWED_FILES.has(rel))return true;

  const allowed=ALLOWED_DIRS.some(dir=>rel===dir||rel.startsWith(dir+'/'));
  if(!allowed)return false;

  const ext=path.extname(rel).toLowerCase();
  return ALLOWED_EXT.has(ext);
}

async function walk(dir,out=[]){
  let entries=[];
  try{entries=await fs.readdir(dir,{withFileTypes:true});}
  catch{return out;}

  for(const entry of entries){
    if(DENY_DIRS.has(entry.name)||DENY_NAMES.has(entry.name))continue;

    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){
      await walk(full,out);
    }else if(entry.isFile()&&safeRelative(full)){
      out.push(full);
      if(out.length>=1200)return out;
    }
  }
  return out;
}

function lineNumbered(text,startLine=1,endLine=1){
  const lines=text.split('\n');
  return lines
    .slice(Math.max(0,startLine-1),Math.min(lines.length,endLine))
    .map((x,i)=>`${startLine+i}| ${x}`)
    .join('\n');
}

function scoreFile(text,rel,terms){
  const low=normalize(text);
  const pathLow=normalize(rel);
  let score=0;
  for(const term of terms){
    if(!term)continue;
    if(pathLow.includes(term))score+=18;
    let at=0,count=0;
    while((at=low.indexOf(term,at))>=0&&count<8){
      score+=2;
      at+=term.length;
      count++;
    }
  }
  if(/tasks?\\.js|TaskService|meetings?\\.js|MeetingService|panel\\.js|permission/i.test(rel))score+=4;
  return score;
}

export class AICodebaseService{
  constructor({logger}={}){this.logger=logger;this.cache=new Map();}

  async files(){
    const key='all';
    const cached=this.cache.get(key);
    if(cached&&cached.expires>Date.now())return cached.files;

    const files=[];
    for(const dir of ALLOWED_DIRS){
      const abs=path.join(ROOT_DIR,dir);
      if(await existsFile(abs))continue;
      await walk(abs,files);
    }
    const packagePath=path.join(ROOT_DIR,'package.json');
    if(await existsFile(packagePath))files.push(packagePath);

    const unique=[...new Set(files)];
    this.cache.set(key,{files:unique,expires:Date.now()+60_000});
    return unique;
  }

  async search(query,{limit=7,maxSnippet=4200}={}){
    const terms=expandedTerms(query);
    const files=await this.files();
    const hits=[];

    for(const file of files){
      let text;
      try{
        const stat=await fs.stat(file);
        if(stat.size>600_000)continue;
        text=await fs.readFile(file,'utf8');
      }catch{continue;}

      const rel=path.relative(ROOT_DIR,file).replaceAll(path.sep,'/');
      const score=scoreFile(text,rel,terms);
      if(score<=0)continue;

      const lines=text.split('\n');
      const matching=[];
      for(let i=0;i<lines.length;i++){
        const lineLow=normalize(lines[i]);
        if(terms.some(t=>t&&lineLow.includes(t))){
          matching.push(i);
          if(matching.length>=14)break;
        }
      }

      if(!matching.length)continue;

      const spans=[];
      for(const lineIndex of matching.slice(0,6)){
        const start=Math.max(0,lineIndex-3);
        const end=Math.min(lines.length,lineIndex+6);
        spans.push({
          startLine:start+1,
          endLine:end,
          text:lineNumbered(text,start+1,end),
        });
      }

      hits.push({
        path:rel,
        score,
        spans,
      });
    }

    hits.sort((a,b)=>b.score-a.score);

    return {
      query,
      terms,
      results:hits.slice(0,Math.min(Number(limit)||7,12)).map(x=>({
        path:x.path,
        score:x.score,
        spans:x.spans.slice(0,4),
      })),
    };
  }

  async read(file,{startLine=1,endLine=120}={}){
    const abs=path.resolve(ROOT_DIR,String(file));
    const rel=path.relative(ROOT_DIR,abs).replaceAll(path.sep,'/');
    if(!safeRelative(abs))throw new Error('قراءة هذا الملف غير مسموحة.');

    const text=await fs.readFile(abs,'utf8');
    const lines=text.split('\n');
    const start=Math.max(1,Number(startLine)||1);
    const end=Math.min(lines.length,Number(endLine)||120);

    return {
      path:rel,
      startLine:start,
      endLine:end,
      totalLines:lines.length,
      text:lineNumbered(text,start,end),
    };
  }

  shouldInspect(query){
    const q=normalize(query);
    const hints=[
      'كيف','ليش','لماذا','وين','اين','فين','طريقة','طريقه','خطوات',
      'البوت','النظام','كود','برمج','لوحة','مهمة','مهمه','تكليف',
      'اجتماع','صلاحية','عضوية','انسحاب','تجميد','تسجيل','تقرير',
      'امر','أمر','زر','زرار','سيرفر','بوت'
    ];
    return hints.some(x=>q.includes(normalize(x)));
  }

  async evidence(query){
    if(!this.shouldInspect(query))return null;

    const result=await this.search(query,{limit:8});
    if(!result.results.length)return null;

    const compact=result.results.map(hit=>{
      const spans=hit.spans.slice(0,3).map(span=>
        `[${hit.path}:${span.startLine}-${span.endLine}]\\n${span.text}`
      ).join('\n\n');
      return `### ${hit.path} (relevance ${hit.score})\\n${spans}`;
    }).join('\n\n');

    return compact.slice(0,26000);
  }
}
JS

say "🔧 ربط محرك الكود مع AI Agent..."

node --input-type=module <<'NODE'
import fs from 'node:fs';

function patchAgent(){
  const p='src/application/services/AIAgentService.js';
  if(!fs.existsSync(p))return false;

  let s=fs.readFileSync(p,'utf8');

  if(!s.includes("AICodebaseService")){
    const marker="import {AppError} from '../../core/errors/AppError.js';";
    if(!s.includes(marker))throw new Error('AIAgentService: AppError import غير موجود.');
    s=s.replace(marker,marker+"\nimport {AICodebaseService} from './AICodebaseService.js';");
  }

  if(!s.includes('this.codebase=')){
    const marker='    this.pending=new Map();';
    if(!s.includes(marker))throw new Error('AIAgentService: pending map غير موجود.');
    s=s.replace(marker,marker+"\n    this.codebase=new AICodebaseService({logger});");
  }

  if(!s.includes("name:'search_codebase'")){
    const marker="const WRITE_TOOLS=new Set([";
    const decl=`const CODE_TOOLS=[
  {
    name:'search_codebase',
    description:'ابحث داخل كود Meeting 967 الحالي عن كيفية عمل ميزة أو أمر. استخدم هذه الأداة أولًا عند أسئلة طريقة استخدام البوت أو آلية تنفيذ ميزة.',
    parameters:{
      type:'OBJECT',
      properties:{
        query:{type:'STRING',description:'وصف الشيء المطلوب البحث عنه'},
        limit:{type:'INTEGER',description:'عدد الملفات، بحد أقصى 10'},
      },
      required:['query'],
    },
  },
  {
    name:'read_code_file',
    description:'اقرأ جزءًا محددًا من ملف كود آمن بعد العثور عليه من search_codebase للحصول على تفاصيل أكثر.',
    parameters:{
      type:'OBJECT',
      properties:{
        file:{type:'STRING',description:'مسار الملف من search_codebase'},
        startLine:{type:'INTEGER',description:'بداية الأسطر'},
        endLine:{type:'INTEGER',description:'نهاية الأسطر، بحد أقصى 220'},
      },
      required:['file'],
    },
  },
];

`;
    const idx=s.indexOf(marker);
    if(idx<0)throw new Error('AIAgentService: WRITE_TOOLS غير موجود.');
    s=s.slice(0,idx)+decl+s.slice(idx);
    s=s.replace(
      "tools:[{functionDeclarations:TOOL_DECLARATIONS}],",
      "tools:[{functionDeclarations:[...TOOL_DECLARATIONS,...CODE_TOOLS]}],"
    );
  }

  if(!s.includes("case 'search_codebase':")){
    const marker="      case 'get_personal_context':";
    const codeCases=`      case 'search_codebase':
        return await this.codebase.search(args.query,{limit:Math.min(Number(args.limit)||8,10)});

      case 'read_code_file':
        return await this.codebase.read(args.file,{
          startLine:Math.max(1,Number(args.startLine)||1),
          endLine:Math.min(220,Number(args.endLine)||120),
        });

`;
    const idx=s.indexOf(marker);
    if(idx<0)throw new Error('AIAgentService: get_personal_context لم أجدها.');
    s=s.slice(0,idx)+codeCases+s.slice(idx);
  }

  // Add code evidence before Gemini receives the question.
  if(!s.includes('const codeEvidence=await this.codebase.evidence(q);')){
    const marker='    const history=this.history(subject);';
    if(!s.includes(marker))throw new Error('AIAgentService: history marker غير موجود.');
    s=s.replace(marker,marker+"\n    const codeEvidence=await this.codebase.evidence(q);");
  }

  if(!s.includes('الكود الفعلي الحالي')){
    const old="رسالة المستخدم:\\n${q}`}]},";
    const replacement="رسالة المستخدم:\\n${q}\\n\\nالكود الفعلي الحالي المرتبط بالسؤال:\\n${codeEvidence??'لا يوجد دليل كودي مرتبط؛ استخدم search_codebase إذا كان السؤال عن سلوك البوت.'}`}]},";
    if(!s.includes(old))throw new Error('AIAgentService: لم أجد صيغة محتوى السؤال.');
    s=s.replace(old,replacement);
  }

  const systemMarker="أنت AI 967 الرسمي داخل Meeting 967.";
  const systemPos=s.indexOf(systemMarker);
  if(systemPos>=0&&!s.includes('عند السؤال عن طريقة استخدام البوت')){
    s=s.replace(
      "أنت AI 967 الرسمي داخل Meeting 967.",
      "أنت AI 967 الرسمي داخل Meeting 967.\\nإذا كان السؤال عن كيفية استخدام البوت أو سبب سلوك ميزة، ابحث في الكود الحالي أولًا واعتمد عليه بدل التخمين. اذكر للمستخدم أسماء الملفات ذات الصلة وما الذي يحدث فيها باختصار."
    );
  }

  fs.writeFileSync(p,s);
  return true;
}

function patchAssistant(){
  const p='src/application/services/AIAssistantService.js';
  if(!fs.existsSync(p))return false;
  let s=fs.readFileSync(p,'utf8');

  // This older assistant is kept compatible: code-aware evidence is inserted
  // into prompts without replacing the existing knowledge architecture.
  if(!s.includes("AICodebaseService")){
    const marker="import OpenAI from 'openai';";
    if(!s.includes(marker))return false;
    s=s.replace(marker,marker+"\nimport {AICodebaseService} from './AICodebaseService.js';");
  }
  if(!s.includes('this.codebase=')){
    const marker=/constructor\\(([^)]*)\\)\\{([\\s\\S]*?)\\n\\s*\\}/;
    const m=s.match(marker);
    if(m)s=s.replace(m[0],m[0].replace(/\n\s*}/, "\n    this.codebase=new AICodebaseService({logger});\n  }"));
  }
  fs.writeFileSync(p,s);
  return true;
}

const patchedAgent=patchAgent();
if(!patchedAgent){
  const patchedAssistant=patchAssistant();
  if(!patchedAssistant)throw new Error('لم أجد AIAgentService أو AIAssistantService صالحًا للربط.');
}
console.log('✅ code-aware AI linked');
NODE

say "🧪 فحص syntax..."
node --check src/application/services/AICodebaseService.js
node --check src/application/services/AIAgentService.js
[ ! -f src/application/services/AIAssistantService.js ] || node --check src/application/services/AIAssistantService.js

say "🧪 اختبار البحث في الكود..."
node --input-type=module <<'NODE'
import {AICodebaseService} from './src/application/services/AICodebaseService.js';
const service=new AICodebaseService();
const result=await service.search('كيف اكلف شخص مهمة',{limit:5});
if(!result.results.length)throw new Error('لم يعثر محرك الكود على ملفات مرتبطة بتدفق التكليف.');
console.log('✅ code search found',result.results.map(x=>x.path).join(', '));
const evidence=await service.evidence('كيف اكلف شخص مهمة');
if(!evidence)throw new Error('لم يتم توليد code evidence.');
console.log('✅ code evidence generated');
NODE

say "🧪 اختبار الربط..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
const s=fs.readFileSync('src/application/services/AIAgentService.js','utf8');
if(!s.includes('AICodebaseService'))throw new Error('AIAgentService غير مربوط بمحرك الكود');
if(!s.includes('search_codebase'))throw new Error('search_codebase غير مضافة');
if(!s.includes('read_code_file'))throw new Error('read_code_file غير مضافة');
if(!s.includes('codeEvidence'))throw new Error('codeEvidence غير مضاف');
console.log('✅ AIAgent code-aware wiring verified');
NODE

say ""
say "✅ AI Code-Aware v${VERSION} تم تركيبه وفحصه."
say "🛟 Backup: $BACKUP"
say ""
say "النتيجة:"
say "  عند سؤال AI 967 عن طريقة عمل البوت → يفحص الكود الحالي أولًا."
say "  يحدد الملفات والدوال المرتبطة."
say "  يشرح الطريقة الفعلية الموجودة في نسختك."
say "  يمكنه قراءة مقاطع إضافية من الملف عند الحاجة."
say ""
say "أعد التشغيل:"
say "npm start"
