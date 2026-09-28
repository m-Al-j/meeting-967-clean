#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.4.1"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-code-aware-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

say "============================================================"
say " Meeting 967 — AI Code-Aware v${VERSION}"
say " Hotfix: ربط قراءة الكود بطريقة مقاومة لتغيّر الصياغة"
say "============================================================"

[ -f src/application/services/AIAgentService.js ] || die "AIAgentService.js غير موجود"
[ -f src/application/services/AIChatRoomService.js ] || say "⚠️ AIChatRoomService غير موجود — سيتم تجاهل ربط الغرف"

mkdir -p "$BACKUP/src/application/services"
cp -a src/application/services/AIAgentService.js "$BACKUP/src/application/services/AIAgentService.js"

if [ -f src/application/services/AICodebaseService.js ]; then
  cp -a src/application/services/AICodebaseService.js "$BACKUP/src/application/services/AICodebaseService.js"
fi

say "🧠 تجهيز محرك قراءة الكود..."

cat > src/application/services/AICodebaseService.js <<'JS'
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(process.cwd());

const ALLOWED_ROOTS=['src','knowledge/ai','migrations','tests','ops'];
const ALLOWED_EXT=new Set([
  '.js','.mjs','.cjs','.json','.sql','.md','.sh','.txt','.ts','.tsx','.jsx'
]);

const BLOCKED_DIRS=new Set([
  'node_modules','.git','storage','recordings','backups',
  '.update-backups','.runtime','.cache','.npm'
]);

const BLOCKED_FILES=new Set([
  '.env','.env.local','.env.production','.env.development',
  'credentials.json','token.json'
]);

const synonyms=[
  [['كلف','تكليف','مهمه','مهمة','تكليفات'],['task','tasks','taskservice','meeting_tasks','assignee']],
  [['المكلف','مكلف','عضو','شخص'],['assignee','member','member-search','assigneeuser']],
  [['اجتماع','اجتماعات','موعد'],['meeting','meetings','meetingservice','scheduled_at']],
  [['لوحه','لوحة','بانل'],['panel','panel.js','admin:tasks','member:tasks']],
  [['صلاحية','صلاحيات','اذن','إذن'],['permission','permissions','permissionservice','tasks.manage']],
  [['عضوية','عضويه','انسحاب','تجميد','استمرار'],['membership','withdraw','freeze','reactivation']],
  [['تسجيل','التسجيل','صوت'],['recording','recordingservice','voice']],
  [['تقرير','تقارير'],['report','reportservice','reports']],
  [['بوت','البوت','زر','تفاعل','امر','أمر'],['router','interaction','componentdispatcher','index.js','command']],
];

function norm(v){
  return String(v??'')
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[ًٌٍَُِّْـ]/g,'')
    .replace(/[أإآٱ]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/ة/g,'ه')
    .replace(/ؤ/g,'و')
    .replace(/ئ/g,'ي')
    .replace(/\s+/g,' ')
    .trim();
}

function termsFor(query){
  const q=norm(query);
  const terms=new Set(q.split(/[^\p{L}\p{N}_:$.-]+/u).filter(x=>x.length>1));

  for(const [a,b] of synonyms){
    if(a.some(x=>q.includes(norm(x)))){
      for(const t of b)terms.add(norm(t));
    }
  }

  return [...terms].slice(0,50);
}

function safe(file){
  const rel=path.relative(ROOT,file).replaceAll(path.sep,'/');
  if(!rel||rel.startsWith('../')||path.isAbsolute(rel))return false;
  if(BLOCKED_FILES.has(path.basename(rel)))return false;

  const parts=rel.split('/');
  if(parts.some(x=>BLOCKED_DIRS.has(x)))return false;

  if(rel==='package.json')return true;

  const allowed=ALLOWED_ROOTS.some(root=>rel===root||rel.startsWith(root+'/'));
  if(!allowed)return false;

  return ALLOWED_EXT.has(path.extname(rel).toLowerCase());
}

async function walk(dir,out,limit=1400){
  let entries=[];
  try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}

  for(const entry of entries){
    if(out.length>=limit)return;
    if(BLOCKED_DIRS.has(entry.name)||BLOCKED_FILES.has(entry.name))continue;

    const full=path.join(dir,entry.name);
    if(entry.isDirectory())await walk(full,out,limit);
    else if(entry.isFile()&&safe(full))out.push(full);
  }
}

async function allFiles(){
  const result=[];
  for(const root of ALLOWED_ROOTS){
    const dir=path.join(ROOT,root);
    await walk(dir,result);
    if(result.length>=1400)break;
  }

  const pkg=path.join(ROOT,'package.json');
  if(!result.includes(pkg)){
    try{
      const st=await fs.stat(pkg);
      if(st.isFile())result.push(pkg);
    }catch{}
  }

  return [...new Set(result)];
}

function score(rel,text,terms){
  const p=norm(rel);
  const body=norm(text);
  let total=0;

  for(const term of terms){
    if(p.includes(term))total+=15;
    let from=0,count=0;
    while((from=body.indexOf(term,from))>=0&&count<10){
      total+=2;
      from+=term.length;
      count++;
    }
  }

  if(/task|meeting|panel|permission|membership|recording|report/i.test(rel))total+=4;
  return total;
}

function snippets(text,terms){
  const lines=text.split('\n');
  const indexes=[];

  for(let i=0;i<lines.length;i++){
    const n=norm(lines[i]);
    if(terms.some(t=>t&&n.includes(t))){
      indexes.push(i);
      if(indexes.length>=10)break;
    }
  }

  return indexes.slice(0,6).map(i=>{
    const start=Math.max(0,i-3);
    const end=Math.min(lines.length,i+7);
    const chunk=lines.slice(start,end)
      .map((line,j)=>`${start+j+1}| ${line}`)
      .join('\n');
    return {startLine:start+1,endLine:end,text:chunk};
  });
}

export class AICodebaseService{
  constructor({logger}={}){
    this.logger=logger;
    this.cache=null;
    this.cacheAt=0;
  }

  async files(){
    if(this.cache&&Date.now()-this.cacheAt<60_000)return this.cache;
    this.cache=await allFiles();
    this.cacheAt=Date.now();
    return this.cache;
  }

  shouldInspect(query){
    const q=norm(query);
    const hints=[
      'كيف','كيفيه','كيفية','ليش','لماذا','وين','اين','فين',
      'طريقة','طريقه','خطوات','البوت','النظام','كود','كود',
      'برمج','زر','امر','أمر','مهمه','مهمة','تكليف','اجتماع',
      'صلاحية','صلاحيات','عضوية','انسحاب','تجميد','تقرير','تسجيل'
    ];
    return hints.some(x=>q.includes(norm(x)));
  }

  async search(query,{limit=8}={}){
    const terms=termsFor(query);
    const files=await this.files();
    const hits=[];

    for(const file of files){
      let stat;
      try{stat=await fs.stat(file);}catch{continue;}
      if(!stat.isFile()||stat.size>700_000)continue;

      let text;
      try{text=await fs.readFile(file,'utf8');}catch{continue;}

      const rel=path.relative(ROOT,file).replaceAll(path.sep,'/');
      const sc=score(rel,text,terms);
      if(sc<=0)continue;

      const spans=snippets(text,terms);
      if(!spans.length)continue;

      hits.push({path:rel,score:sc,spans});
    }

    hits.sort((a,b)=>b.score-a.score);

    return {
      query,
      terms,
      results:hits.slice(0,Math.min(12,Number(limit)||8))
    };
  }

  async evidence(query){
    if(!this.shouldInspect(query))return null;

    const result=await this.search(query,{limit:8});
    if(!result.results.length)return null;

    const blocks=result.results.map(hit=>{
      const spans=hit.spans.slice(0,3).map(x=>
        `[${hit.path}:${x.startLine}-${x.endLine}]\n${x.text}`
      ).join('\n\n');

      return `### ${hit.path}\n${spans}`;
    });

    return [
      'هذه أدلة مقروءة من ملفات Meeting 967 الحالية:',
      '',
      blocks.join('\n\n')
    ].join('\n').slice(0,28000);
  }
}
JS

say "🔧 ربط Codebase مع AIAgentService..."

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/application/services/AIAgentService.js';
let s=fs.readFileSync(p,'utf8');

if(!s.includes("import {AICodebaseService} from './AICodebaseService.js';")){
  const marker="import {AppError} from '../../core/errors/AppError.js';";
  if(!s.includes(marker))throw new Error('AIAgentService: AppError import غير موجود.');
  s=s.replace(marker,marker+"\nimport {AICodebaseService} from './AICodebaseService.js';");
}

if(!s.includes('this.codebase=new AICodebaseService')){
  const marker='    this.pending=new Map();';
  if(s.includes(marker)){
    s=s.replace(marker,marker+"\n    this.codebase=new AICodebaseService({logger});");
  }else{
    const marker2='    this.pending = new Map();';
    if(s.includes(marker2)){
      s=s.replace(marker2,marker2+"\n    this.codebase=new AICodebaseService({logger});");
    }else{
      throw new Error('AIAgentService: لم أجد pending Map داخل constructor.');
    }
  }
}

function findMethod(text,name){
  const start=text.indexOf(`async ${name}(`);
  if(start<0)return null;

  const brace=text.indexOf('{',start);
  if(brace<0)return null;

  let depth=0;
  let quote=null;
  let esc=false;
  let template=false;
  let lineComment=false;
  let blockComment=false;

  for(let i=brace;i<text.length;i++){
    const ch=text[i], next=text[i+1];

    if(lineComment){
      if(ch==='\n')lineComment=false;
      continue;
    }
    if(blockComment){
      if(ch==='*'&&next==='/'){blockComment=false;i++;}
      continue;
    }

    if(quote){
      if(esc){esc=false;continue;}
      if(ch==='\\'){esc=true;continue;}
      if(ch===quote){quote=null;}
      continue;
    }

    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}

    if(ch==='`'){
      template=!template;
      continue;
    }

    if(template){
      if(ch==='{')depth++;
      else if(ch==='}')depth--;
      continue;
    }

    if(ch==='{')depth++;
    else if(ch==='}'){
      depth--;
      if(depth===0)return {start,end:i+1};
    }
  }

  return null;
}

const method=findMethod(s,'respond');
if(!method)throw new Error('AIAgentService: لم أجد async respond(...)');

let body=s.slice(method.start,method.end);

if(!body.includes('const codeEvidence=await this.codebase.evidence(q);')){
  const candidates=[
    'const history=this.history(subject);',
    'const history = this.history(subject);'
  ];
  const marker=candidates.find(x=>body.includes(x));
  if(!marker)throw new Error('AIAgentService.respond: لم أجد history داخل respond().');
  body=body.replace(marker,marker+"\n    const codeEvidence=await this.codebase.evidence(q);");
}

if(!body.includes('الكود الفعلي الحالي المرتبط بالسؤال')){
  const contentsStart=body.indexOf('const contents=');
  const responseStart=body.indexOf('const response=',contentsStart);

  if(contentsStart<0||responseStart<0)throw new Error('AIAgentService.respond: لم أجد contents/response.');
  let segment=body.slice(contentsStart,responseStart);

  const qPos=segment.indexOf('${q}');
  if(qPos<0)throw new Error('AIAgentService.respond: لم أجد ${q} داخل contents.');

  const injection="${q}\n\nدليل الكود الفعلي الحالي المرتبط بالسؤال:\n${codeEvidence??'لم يتم العثور على دليل كودي مباشر.'}";
  segment=segment.slice(0,qPos)+injection+segment.slice(qPos+'${q}'.length);

  body=body.slice(0,contentsStart)+segment+body.slice(responseStart);
}

if(!body.includes('ابحث في الكود الحالي أولًا')){
  const marker='أنت AI 967 الرسمي داخل Meeting 967.';
  if(body.includes(marker)){
    body=body.replace(
      marker,
      marker+"\nعند السؤال عن كيفية استخدام البوت أو سبب سلوك ميزة، اعتمد أولًا على دليل الكود الفعلي المرفق من AICodebaseService ولا تخمّن."
    );
  }else{
    // system may be defined outside respond; add a local rule before generateContent
    const marker2='const client=this._client();';
    if(body.includes(marker2)){
      body=body.replace(
        marker2,
        marker2+"\n    // Code-aware rule: use attached current-code evidence for bot how-to questions."
      );
    }
  }
}

s=s.slice(0,method.start)+body+s.slice(method.end);
fs.writeFileSync(p,s);
console.log('✅ AIAgentService.respond patched safely');
NODE

say "🧪 فحص Syntax..."
node --check src/application/services/AICodebaseService.js
node --check src/application/services/AIAgentService.js

say "🧪 اختبار قراءة الكود..."
node --input-type=module <<'NODE'
import {AICodebaseService} from './src/application/services/AICodebaseService.js';

const service=new AICodebaseService();
const result=await service.search('كيف اكلف شخص مهمة',{limit:8});

if(!result.results.length){
  throw new Error('محرك الكود لم يجد مسار المهمة داخل المشروع.');
}

console.log('✅ code search OK');
console.log('📁',result.results.map(x=>x.path).join(', '));

const evidence=await service.evidence('كيف اكلف شخص مهمة');
if(!evidence)throw new Error('لم يتم إنشاء code evidence.');

console.log('✅ code evidence OK');
console.log(evidence.slice(0,900));
NODE

say "🧪 التحقق النهائي..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
const s=fs.readFileSync('src/application/services/AIAgentService.js','utf8');

for(const token of [
  'AICodebaseService',
  'this.codebase=new AICodebaseService',
  'const codeEvidence=await this.codebase.evidence(q);',
  'دليل الكود الفعلي الحالي المرتبط بالسؤال'
]){
  if(!s.includes(token))throw new Error(`Missing: ${token}`);
}
console.log('✅ AIAgentService code-aware wiring verified');
NODE

say ""
say "✅ AI Code-Aware v${VERSION} تم تركيبه بنجاح."
say "🛟 Backup: $BACKUP"
say ""
say "مثال:"
say "  كيف اكلف شخص مهمة"
say "  لماذا زر معين ما يشتغل"
say "  كيف يتم الانسحاب"
say "  كيف يعمل التسجيل"
say ""
say "في هذه الأسئلة سيبحث AI داخل الكود الحالي قبل الإجابة."
say ""
say "أعد التشغيل:"
say "npm start"
