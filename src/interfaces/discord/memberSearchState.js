function normalize(value=''){
  return String(value??'')
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u064B-\u065F\u0670]/g,'')
    .replace(/[أإآٱ]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/ؤ/g,'و')
    .replace(/ئ/g,'ي')
    .replace(/^@+/,'')
    .replace(/[._\-\s]+/g,' ')
    .trim();
}

export function filterMemberOptions(options,query=''){
  const q=normalize(query);
  if(!q)return options;
  const compact=q.replace(/\s+/g,'');
  return options.filter(option=>{
    const hay=normalize(`${option.label??''} ${option.description??''} ${option.value??''}`);
    return hay.includes(q)||hay.replace(/\s+/g,'').includes(compact);
  });
}

export function memberSearchKey(userId,context){return `member-search:${userId}:${context}`;}
export function getMemberSearch(a,userId,context){return String(a.drafts.get(memberSearchKey(userId,context))?.query??'');}
export function setMemberSearch(a,userId,context,query){a.drafts.set(memberSearchKey(userId,context),{query:String(query??'').trim()});return getMemberSearch(a,userId,context);}
export function clearMemberSearch(a,userId,context){a.drafts.delete(memberSearchKey(userId,context));}
export function searchSummary(query,filteredTotal,allTotal){return query?`\n🔎 البحث: **${String(query).slice(0,80)}** — النتائج **${filteredTotal}** من **${allTotal}**.`:'';}
