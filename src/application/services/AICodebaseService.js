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
