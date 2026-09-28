export function normalizeMemberText(value=''){
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

function matchScore(option,q){
  if(!q)return 0;
  const label=normalizeMemberText(option.label??'');
  const username=normalizeMemberText(String(option.description??'').replace(/^@/,''));
  const combined=normalizeMemberText(`${label} ${username}`);
  const compact=q.replace(/\s+/g,'');
  const labelCompact=label.replace(/\s+/g,'');
  const userCompact=username.replace(/\s+/g,'');
  const tokens=combined.split(/\s+/).filter(Boolean);

  // Ranking is based ONLY on the typed name/username. No previous selections,
  // messaging history, recency, frequency, presence, or other personal signals.
  if(username===q||label===q)return 10000;
  if(label.startsWith(q))return 9400;
  if(username.startsWith(q))return 9200;
  if(tokens.some(t=>t.startsWith(q)))return 8200;
  if(labelCompact.startsWith(compact))return 7800;
  if(userCompact.startsWith(compact))return 7600;
  if(label.includes(q))return 6800;
  if(username.includes(q))return 6600;
  if(labelCompact.includes(compact)||userCompact.includes(compact))return 6000;
  return -Infinity;
}

function alphabetic(option){
  const label=normalizeMemberText(option.label??'');
  const username=normalizeMemberText(String(option.description??'').replace(/^@/,''));
  return `${label}\u0000${username}`;
}

export function rankSmartMemberOptions(options,query='',_ignoredUsageRows=[],{limit=25}={}){
  const q=normalizeMemberText(query);
  return (options??[])
    .map(option=>{
      const score=matchScore(option,q);
      if(score===-Infinity)return null;
      return {option,score,alphabetic:alphabetic(option)};
    })
    .filter(Boolean)
    .sort((a,b)=>b.score-a.score||a.alphabetic.localeCompare(b.alphabetic,'ar'))
    .slice(0,Math.max(1,Math.min(25,Number(limit)||25)))
    .map(x=>x.option);
}
