const DIACRITICS=/[\u064B-\u065F\u0670]/g;
const STOP_WORDS=new Set([
  'فريق','فرق','team','teams','قسم','لجنة',
  'اجتماع','اجتماعات','meeting','meetings','voice','صوت','صوتي','صوتية',
  'تنبيه','تنبيهات','اعلان','اعلانات','إعلان','إعلانات','announcement','announcements',
  'قناة','channel','chat','عام','general'
]);
const SYSTEM_NAMES=new Set(['admin','administrator','mod','moderator','owner','bot','bots','member','members','verified','everyone','everyonee','مشرف','مشرفين','ادمن','إدارة السيرفر','عضو','اعضاء','أعضاء','موثق']);

export function normalizeStructureName(value=''){
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(DIACRITICS,'')
    .replace(/ـ/g,'')
    .replace(/[إأآ]/g,'ا')
    .replace(/ة/g,'ه')
    .replace(/ى/g,'ي')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g,' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(x=>!STOP_WORDS.has(x))
    .join(' ');
}

export function hasTeamMarker(name=''){
  return /(^|[\s_\-—|])(فريق|team|قسم|لجنه|لجنة)([\s_\-—|]|$)/iu.test(String(name));
}

export function isLikelySystemRole(name=''){
  const n=normalizeStructureName(name);
  return !n || SYSTEM_NAMES.has(n);
}

export function structureScore(a,b){
  const x=normalizeStructureName(a),y=normalizeStructureName(b);
  if(!x||!y)return 0;
  if(x===y)return 100;
  if(x.includes(y)||y.includes(x))return Math.min(x.length,y.length)>=4?86:65;
  const A=new Set(x.split(' ')),B=new Set(y.split(' '));
  let inter=0;for(const t of A)if(B.has(t))inter++;
  const union=new Set([...A,...B]).size;
  return union?Math.round((inter/union)*100):0;
}

export function bestNamed(items,roleName,{minScore=65,preferKeywords=[]}={}){
  let best=null,bestScore=-1;
  for(const item of items){
    const base=structureScore(roleName,item.name);
    const raw=String(item.name??'').toLowerCase();
    const bonus=preferKeywords.some(k=>raw.includes(k))?7:0;
    const score=base+bonus;
    if(score>bestScore){best=item;bestScore=score;}
  }
  return bestScore>=minScore?{item:best,score:bestScore}:null;
}

export function findSpecialTextChannel(channels,kind){
  const patterns=kind==='report'
    ?[/تقارير/u,/تقرير/u,/reports?/i]
    :[/audit/i,/سجل[\s_-]*(العمليات|التدقيق)/u,/لوق/u,/logs?/i];
  return channels.find(c=>patterns.some(p=>p.test(String(c.name??''))))??null;
}

export function sameLogicalTeamName(a,b){
  const x=normalizeStructureName(a),y=normalizeStructureName(b);
  return Boolean(x)&&x===y;
}

export function membersWithRole(members,roleId){
  return [...members.values()].filter(m=>!m.user?.bot&&m.roles?.cache?.has(String(roleId)));
}
