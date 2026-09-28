#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.2.3"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-chat-room-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

say "============================================================"
say " Meeting 967 — AI Chat Room v${VERSION}"
say " إصلاح نهائي لـ index.js + app.js"
say "============================================================"

for f in \
  src/index.js \
  src/app.js \
  src/interfaces/discord/commands/ai.js \
  src/interfaces/discord/interactions/misc.js \
  src/interfaces/discord/componentDispatcher.js \
  src/application/services/AIChatRoomService.js
do
  [ -f "$f" ] && {
    mkdir -p "$BACKUP/$(dirname "$f")"
    cp -a "$f" "$BACKUP/$f"
  }
done

say "🔧 إصلاح index.js..."

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/index.js';
let s=fs.readFileSync(p,'utf8');

// Previous patch inserted literal two-character "\\n" sequences into the
// messageCreate listener. Restrict normalization to that listener block only.
const start=s.indexOf("client.on('messageCreate'");
if(start>=0){
  const nextCandidates=[
    s.indexOf("client.on('interactionCreate'",start),
    s.indexOf("client.on('voiceStateUpdate'",start),
    s.indexOf("client.on('error'",start),
  ].filter(x=>x>=0);
  const end=nextCandidates.length?Math.min(...nextCandidates):Math.min(s.length,start+6000);

  let block=s.slice(start,end);
  block=block.replaceAll('\\n','\n');
  s=s.slice(0,start)+block+s.slice(end);
}

// Remove duplicate messageCreate listeners while keeping the first.
const marker="client.on('messageCreate'";
let pos=s.indexOf(marker);
if(pos>=0){
  const firstEnd=s.indexOf("});",pos);
  if(firstEnd>=0){
    const second=s.indexOf(marker,firstEnd+3);
    if(second>=0){
      const secondEnd=s.indexOf("});",second);
      if(secondEnd>=0){
        s=s.slice(0,second)+s.slice(secondEnd+3);
      }
    }
  }
}

// If the listener was absent, install it immediately before interactionCreate.
if(!s.includes("client.on('messageCreate'")){
  const interaction=s.indexOf("client.on('interactionCreate'");
  if(interaction<0)throw new Error('index.js: لا يوجد interactionCreate لإضافة messageCreate قبله.');
  const block=[
    "client.on('messageCreate',message=>{",
    "  app.aiChatRoomService?.handleMessage(message).catch(error=>app.logger.error('ai-chat-message-event-failed',{error:error?.stack??String(error),channelId:message?.channelId,userId:message?.author?.id}));",
    "});",
    ""
  ].join('\n');
  s=s.slice(0,interaction)+block+s.slice(interaction);
}

// Normalize the exact listener if it somehow still contains literal "\\n".
const ls=s.indexOf("client.on('messageCreate'");
if(ls>=0){
  const le=s.indexOf("});",ls);
  if(le>=0){
    const raw=s.slice(ls,le+3);
    const clean=raw.replaceAll('\\n','\n');
    s=s.slice(0,ls)+clean+s.slice(le+3);
  }
}

fs.writeFileSync(p,s);
console.log('✅ index.js normalized');
NODE

say "🔧 ربط AI Chat Room داخل app.js..."

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/app.js';
let s=fs.readFileSync(p,'utf8');

// Import service.
if(!s.includes("AIChatRoomService")){
  const anchors=[
    "import { AIAgentService } from './application/services/AIAgentService.js';",
    "import { AIAssistantService } from './application/services/AIAssistantService.js';",
  ];
  const anchor=anchors.find(x=>s.includes(x));
  if(!anchor)throw new Error('app.js: لم أجد خدمة AI الأساسية.');
  s=s.replace(anchor,anchor+"\nimport { AIChatRoomService } from './application/services/AIChatRoomService.js';");
}

// Instantiate using the already-installed AI Agent.
if(!s.includes('const aiChatRoomService=')){
  const agentMatch=s.match(/const aiAgentService\s*=\s*new\s+AIAgentService\([^\n]+;\s*/);
  if(agentMatch){
    s=s.replace(
      agentMatch[0],
      agentMatch[0]+"  const aiChatRoomService=new AIChatRoomService({env,logger,aiAgentService});\n"
    );
  }else{
    const assistantMatch=s.match(/const aiAssistantService\s*=\s*new\s+AIAssistantService\([^\n]+;\s*/);
    if(assistantMatch){
      s=s.replace(
        assistantMatch[0],
        assistantMatch[0]+"  const aiChatRoomService=new AIChatRoomService({env,logger,aiAgentService:aiAssistantService});\n"
      );
    }else{
      throw new Error('app.js: لم أجد aiAgentService أو aiAssistantService.');
    }
  }
}

// Return service.
if(!s.includes('aiChatRoomService,')){
  const returnAt=s.indexOf('  return {');
  if(returnAt<0)throw new Error('app.js: return object غير موجود.');

  const serviceTokens=[
    'aiAgentService,',
    'aiAssistantService,',
    'supportService,',
  ];

  let inserted=false;
  for(const token of serviceTokens){
    const at=s.indexOf(token,returnAt);
    if(at>=0){
      const end=at+token.length;
      s=s.slice(0,end)+"\n    aiChatRoomService,"+s.slice(end);
      inserted=true;
      break;
    }
  }

  if(!inserted)throw new Error('app.js: لم أجد مكان إضافة aiChatRoomService في return.');
}

fs.writeFileSync(p,s);
console.log('✅ app.js linked');
NODE

say "🔧 التأكد من توجيه AI..."

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/interfaces/discord/interactions/misc.js';
let s=fs.readFileSync(p,'utf8');

if(!s.includes("import {handleAIInteraction} from '../commands/ai.js';")){
  const anchor="import {refreshPanel,personalGuide,panelHub,panelSection} from '../commands/panel.js';";
  if(!s.includes(anchor))throw new Error('misc.js: panel import غير موجود.');
  s=s.replace(anchor,anchor+"\nimport {handleAIInteraction} from '../commands/ai.js';");
}

s=s.replace(/^\s*if\(id\.startsWith\(['"]ai:['"]\)\)return handleAIInteraction\(i,a,s,id\);\s*$/gm,'');

const start="export async function handleMisc(i,a){const id=i.customId??'';const s=await subjectFromInteraction(i,a.env);";
if(!s.includes(start))throw new Error('misc.js: handleMisc غير موجود.');

s=s.replace(start,start+"\n  if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);");

fs.writeFileSync(p,s);
console.log('✅ misc.js AI route linked');
NODE

say "🧪 فحص JavaScript..."
node --check src/index.js
node --check src/app.js
node --check src/application/services/AIChatRoomService.js
node --check src/interfaces/discord/commands/ai.js
node --check src/interfaces/discord/interactions/misc.js
node --check src/interfaces/discord/componentDispatcher.js
node --check src/interfaces/discord/interactionReliability.js

say "🔎 فحص listeners..."
COUNT="$(grep -c "client.on('messageCreate'" src/index.js || true)"
[ "$COUNT" = "1" ] || die "عدد messageCreate listeners غير صحيح: $COUNT"

grep -n -A3 "client.on('messageCreate'" src/index.js
grep -n "client.on('interactionCreate'" src/index.js

say "🔎 فحص عدم وجود literal \n في listener..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
const s=fs.readFileSync('src/index.js','utf8');
const a=s.indexOf("client.on('messageCreate'");
const b=s.indexOf("client.on('interactionCreate'",a);
if(a<0)throw new Error('messageCreate missing');
if(b<0)throw new Error('interactionCreate missing');
const block=s.slice(a,b);
if(block.includes('\\n'))throw new Error('وجدت literal \\\\n داخل messageCreate block');
if(!block.includes('aiChatRoomService?.handleMessage'))throw new Error('AI handler missing');
console.log('✅ listener block clean');
NODE

say "🔎 فحص app service..."
grep -nE "AIChatRoomService|aiChatRoomService" src/app.js

say ""
say "✅ AI Chat Room v${VERSION} تم إصلاحه بنجاح."
say "🛟 Backup: $BACKUP"
say ""
say "الخطوة التالية:"
say "npm start"
say ""
say "ثم /panel → AI 967"
