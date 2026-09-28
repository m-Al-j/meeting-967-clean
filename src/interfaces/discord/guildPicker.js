const DEFAULT_PAGE_SIZE=25;
const OPTION_TTL_MS=120_000;
const optionCache=new Map();
const inflight=new Map();

const text=(value,fallback='—')=>String(value??fallback).trim()||fallback;
const cacheKey=(kind,guildId,flag)=>`${kind}:${guildId}:${flag?1:0}`;
const getCached=(key)=>{const hit=optionCache.get(key);if(!hit)return null;if(hit.expiresAt<=Date.now()){optionCache.delete(key);return null;}return hit.value;};
const setCached=(key,value)=>{optionCache.set(key,{value,expiresAt:Date.now()+OPTION_TTL_MS});return value;};

export function invalidateGuildPickerCache(guildId){const prefixA=`members:${guildId}:`,prefixB=`roles:${guildId}:`;for(const key of optionCache.keys())if(key.startsWith(prefixA)||key.startsWith(prefixB))optionCache.delete(key);}

function memberOption(m){return {label:text(m.displayName,m.user?.globalName??m.user?.username).slice(0,100),description:`@${text(m.user?.username)}`.slice(0,100),value:String(m.id)};}
function buildMemberOptions(members,includeBots){return members.filter(m=>includeBots||!m.user?.bot).sort((a,b)=>text(a.displayName).localeCompare(text(b.displayName),'ar')).map(memberOption);}

export async function guildMemberOptions(guild,{includeBots=false}={}){
  const key=cacheKey('members',guild.id,includeBots);const cached=getCached(key);if(cached)return cached;
  let members=[...guild.members.cache.values()];let usable=members.filter(m=>includeBots||!m.user?.bot);
  if(usable.length>1)return setCached(key,buildMemberOptions(members,includeBots));
  let promise=inflight.get(key);
  if(!promise){
    promise=(async()=>{try{const fetched=await guild.members.fetch({withPresences:false});return [...fetched.values()];}catch(error){if(usable.length)return members;const e=new Error('تعذر جلب أعضاء السيرفر من Discord. تأكد من تفعيل Server Members Intent وأن البوت متصل بالسيرفر.');e.code='GUILD_MEMBER_FETCH_FAILED';e.cause=error;throw e;}})();
    inflight.set(key,promise);promise.finally(()=>inflight.delete(key)).catch(()=>{});
  }
  members=await promise;return setCached(key,buildMemberOptions(members,includeBots));
}

export async function guildRoleOptions(guild,{includeManaged=false}={}){
  const key=cacheKey('roles',guild.id,includeManaged);const cached=getCached(key);if(cached)return cached;
  let roles=[...guild.roles.cache.values()];
  if(roles.length<=1){let promise=inflight.get(key);if(!promise){promise=(async()=>{try{const fetched=await guild.roles.fetch();return [...fetched.values()];}catch(error){if(roles.length>1)return roles;const e=new Error('تعذر جلب رتب السيرفر من Discord.');e.code='GUILD_ROLE_FETCH_FAILED';e.cause=error;throw e;}})();inflight.set(key,promise);promise.finally(()=>inflight.delete(key)).catch(()=>{});}roles=await promise;}
  const options=roles.filter(r=>String(r.id)!==String(guild.id)).filter(r=>includeManaged||!r.managed).sort((a,b)=>(b.position-a.position)||text(a.name).localeCompare(text(b.name),'ar')).map(r=>({label:text(r.name).slice(0,100),description:`${r.members?.size??0} عضو`.slice(0,100),value:String(r.id)}));
  return setCached(key,options);
}

export function pickerPage(options,page=0,pageSize=DEFAULT_PAGE_SIZE){const size=Math.max(1,Math.min(25,Number(pageSize)||DEFAULT_PAGE_SIZE));const total=options.length;const pages=Math.max(1,Math.ceil(total/size));const current=Math.max(0,Math.min(pages-1,Number(page)||0));const start=current*size;return {items:options.slice(start,start+size),page:current,pages,total,start,end:Math.min(total,start+size)};}
export const PICKER_PAGE_PREFIX='__meeting967_page__:';
export const PICKER_SEARCH_VALUE='__meeting967_member_search__';
export const pickerSearchValue=(value)=>String(value??'')===PICKER_SEARCH_VALUE;

// Member menus reserve one visible option for search and up to two for pagination.
// This makes search discoverable *inside the opened Discord list*, including on mobile.
export function pickerMenuPage(options,page=0,pageSize=22){
  const p=pickerPage(options,page,pageSize);
  const search=[{label:'🔎 بحث بالاسم أو اليوزر',description:'اكتب الاسم الظاهر أو @username للعثور على العضو',value:PICKER_SEARCH_VALUE}];
  const navigation=[];
  if(p.page>0)navigation.push({label:'⬅️ الصفحة السابقة',description:`انتقل إلى الصفحة ${p.page} من ${p.pages}`.slice(0,100),value:`${PICKER_PAGE_PREFIX}${p.page-1}`});
  if(p.page+1<p.pages)navigation.push({label:'➡️ الصفحة التالية',description:`انتقل إلى الصفحة ${p.page+2} من ${p.pages}`.slice(0,100),value:`${PICKER_PAGE_PREFIX}${p.page+1}`});
  const dataItems=[...p.items];
  const menuItems=[...search,...navigation,...dataItems].slice(0,25);
  return {...p,dataItems,menuItems};
}
export function navigablePickerPage(options,page=0,pageSize=22){const p=pickerMenuPage(options,page,pageSize);return {...p,items:p.menuItems};}
export function pickerNavigationPage(value){return pickerPageValue(value);}
export function pickerPageValue(value){const raw=String(value??'');if(!raw.startsWith(PICKER_PAGE_PREFIX))return null;const page=Number(raw.slice(PICKER_PAGE_PREFIX.length));return Number.isInteger(page)&&page>=0?page:null;}
