#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.2.1"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-chat-room-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

say "============================================================"
say " Meeting 967 — AI Chat Room v${VERSION}"
say " Hotfix: ربط غرفة AI ببنية app.js الحالية"
say "============================================================"

for f in \
  src/app.js \
  src/index.js \
  src/interfaces/discord/interactions/misc.js \
  src/interfaces/discord/componentDispatcher.js \
  src/interfaces/discord/commands/ai.js \
  src/application/services/AIChatRoomService.js
do
  [ -f "$f" ] && cp -a "$f" "$BACKUP/$(basename "$f")"
done

node --input-type=module <<'NODE'
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>fs.writeFileSync(p,s);

// ------------------------------------------------------------
// app.js
// ------------------------------------------------------------
{
  const p='src/app.js';
  let s=read(p);

  if(!s.includes("AIChatRoomService")){
    const anchors=[
      "import { AIAgentService } from './application/services/AIAgentService.js';",
      "import { AIAssistantService } from './application/services/AIAssistantService.js';",
    ];
    const anchor=anchors.find(x=>s.includes(x));
    if(!anchor)throw new Error('app.js: لم أجد خدمة AI الموجودة لربط Chat Room بها.');
    s=s.replace(anchor,anchor+"\nimport { AIChatRoomService } from './application/services/AIChatRoomService.js';");
  }

  if(!s.includes('const aiChatRoomService=')){
    let aiVar=null;

    if(s.includes('const aiAgentService=new AIAgentService')){
      aiVar='aiAgentService';
    }else if(s.includes('const aiAssistantService=new AIAssistantService')){
      aiVar='aiAssistantService';
    }

    if(aiVar){
      const re=new RegExp(`(const ${aiVar}=new [^;]+;)`);
      const m=s.match(re);
      if(!m)throw new Error('app.js: تعذر إيجاد سطر إنشاء خدمة AI.');

      s=s.replace(
        m[1],
        m[1]+"\n  const aiChatRoomService=new AIChatRoomService({env,logger,aiAgentService:"+aiVar+"});"
      );
    }else{
      // Extremely defensive fallback for a future naming variation:
      // build the AIAgentService from the services already present in app.js.
      const importAnchor="import { SupportService } from './application/services/SupportService.js';";
      if(!s.includes(importAnchor))throw new Error('app.js: لا توجد نقطة آمنة لإضافة AIAgentService.');

      if(!s.includes("AIAgentService")){
        s=s.replace(
          importAnchor,
          importAnchor+"\nimport { AIAgentService } from './application/services/AIAgentService.js';"
        );
      }

      const supportLineMatch=s.match(/  const supportService=new SupportService\([^\n]+;\n/);
      if(!supportLineMatch)throw new Error('app.js: لم أجد supportService.');

      const creation="  const aiAgentService=new AIAgentService({db:pool,env,logger,permissionService,taskService,meetingService,teams,meetings,guilds});";
      s=s.replace(supportLineMatch[0],supportLineMatch[0]+creation+"\n");
      s=s.replace(
        creation,
        creation+"\n  const aiChatRoomService=new AIChatRoomService({env,logger,aiAgentService});"
      );
    }
  }

  if(!s.includes('aiChatRoomService,')){
    // Put it in the return object next to the other application services.
    const returnStart=s.indexOf('  return {');
    if(returnStart<0)throw new Error('app.js: return object غير موجود.');

    const aiTokens=['aiAgentService,','aiAssistantService,','supportService,'];
    let inserted=false;
    for(const token of aiTokens){
      const at=s.indexOf(token,returnStart);
      if(at>=0){
        const end=at+token.length;
        s=s.slice(0,end)+"\n    aiChatRoomService,"+s.slice(end);
        inserted=true;
        break;
      }
    }
    if(!inserted)throw new Error('app.js: لم أجد مكانًا لإضافة aiChatRoomService إلى return.');
  }

  write(p,s);
}

// ------------------------------------------------------------
// index.js — normal Discord chat messages
// ------------------------------------------------------------
{
  const p='src/index.js';
  let s=read(p);

  if(!s.includes('aiChatRoomService?.handleMessage')){
    const anchor="client.on('interactionCreate',i=>routeInteraction(i,app));";
    if(!s.includes(anchor))throw new Error('index.js: interactionCreate غير موجود.');

    const block=`client.on('messageCreate',message=>{\\n  app.aiChatRoomService?.handleMessage(message).catch(error=>app.logger.error('ai-chat-message-event-failed',{error:error?.stack??String(error),channelId:message?.channelId,userId:message?.author?.id}));\\n});\\n`;

    s=s.replace(anchor,block+anchor);
  }

  write(p,s);
}

// ------------------------------------------------------------
// misc.js — AI interaction fallback
// ------------------------------------------------------------
{
  const p='src/interfaces/discord/interactions/misc.js';
  let s=read(p);

  if(!s.includes("import {handleAIInteraction} from '../commands/ai.js';")){
    const anchor="import {refreshPanel,personalGuide,panelHub,panelSection} from '../commands/panel.js';";
    if(!s.includes(anchor))throw new Error('misc.js: panel import غير موجود.');
    s=s.replace(anchor,anchor+"\nimport {handleAIInteraction} from '../commands/ai.js';");
  }

  s=s.replace(/^\s*if\(id\.startsWith\(['"]ai:['"]\)\)return handleAIInteraction\(i,a,s,id\);\s*$/gm,'');

  const start="export async function handleMisc(i,a){const id=i.customId??'';const s=await subjectFromInteraction(i,a.env);";
  if(!s.includes(start))throw new Error('misc.js: handleMisc غير موجود.');

  s=s.replace(start,start+"\n  if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);");

  write(p,s);
}

// ------------------------------------------------------------
// componentDispatcher.js — direct AI path
// ------------------------------------------------------------
{
  const p='src/interfaces/discord/componentDispatcher.js';
  let s=read(p);

  if(!s.includes("import {handleAIInteraction} from './commands/ai.js';")){
    const anchor="import {handlerForCustomId} from './interactionReliability.js';";
    if(!s.includes(anchor))throw new Error('componentDispatcher.js: handlerForCustomId import غير موجود.');
    s=s.replace(anchor,anchor+"\nimport {handleAIInteraction} from './commands/ai.js';");
  }

  if(!s.includes("handleAIInteraction(interaction,app,subject")){
    const start="export async function dispatchComponentInteraction(interaction,app){\n";
    if(!s.includes(start))throw new Error('componentDispatcher.js: dispatch غير موجود.');

    const block=`  if(String(interaction.customId??'').startsWith('ai:')){\\n    const subject=await import('./context.js').then(m=>m.subjectFromInteraction(interaction,app.env));\\n    return handleAIInteraction(interaction,app,subject,String(interaction.customId??''));\\n  }\\n`;

    s=s.replace(start,start+block);
  }

  write(p,s);
}

// ------------------------------------------------------------
// interactionReliability.js — guarantee old/new AI opener buttons
// are never auto-deferred before a modal. The real chat room
// no longer uses a modal, but keep compatibility with old buttons.
// ------------------------------------------------
{
  const p='src/interfaces/discord/interactionReliability.js';
  let s=read(p);

  const anchor='const MODAL_OPENERS = [';
  if(s.includes(anchor)){
    for(const line of [
      "  id => id === 'ai:message',",
      "  id => id === 'ai:ask',",
    ]){
      if(!s.includes(line))s=s.replace(anchor,anchor+"\n"+line);
    }
  }

  write(p,s);
}
NODE

say "🧪 فحص JavaScript..."
node --check src/app.js
node --check src/index.js
node --check src/application/services/AIChatRoomService.js
node --check src/interfaces/discord/commands/ai.js
node --check src/interfaces/discord/interactions/misc.js
node --check src/interfaces/discord/componentDispatcher.js
node --check src/interfaces/discord/interactionReliability.js

say "🧪 اختبار الربط..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';

const app=fs.readFileSync('src/app.js','utf8');
const index=fs.readFileSync('src/index.js','utf8');
const misc=fs.readFileSync('src/interfaces/discord/interactions/misc.js','utf8');
const dispatcher=fs.readFileSync('src/interfaces/discord/componentDispatcher.js','utf8');
const room=fs.readFileSync('src/application/services/AIChatRoomService.js','utf8');
const ai=fs.readFileSync('src/interfaces/discord/commands/ai.js','utf8');

assert.ok(app.includes('AIChatRoomService'));
assert.ok(app.includes('aiChatRoomService='));
assert.ok(app.includes('aiChatRoomService,'));
assert.ok(index.includes('messageCreate'));
assert.ok(index.includes('aiChatRoomService?.handleMessage'));
assert.ok(misc.includes('handleAIInteraction'));
assert.ok(dispatcher.includes("startsWith('ai:')"));
assert.ok(dispatcher.includes('handleAIInteraction'));
assert.ok(room.includes('ChannelType.GuildText'));
assert.ok(room.includes('permissionOverwrites'));
assert.ok(room.includes('message.content'));
assert.ok(ai.includes('openRoom'));
assert.doesNotMatch(ai,/new ModalBuilder/);

console.log('✅ AI Chat Room wiring verified');
NODE

say ""
say "✅ AI Chat Room v${VERSION} تم إصلاح ربطه بنجاح."
say "🛟 Backup: $BACKUP"
say ""
say "أعد تشغيل البوت:"
say "npm start"
say ""
say "ثم:"
say "/panel → AI 967"
say "واضغط AI 967 — المفترض الآن ينشئ/يفتح رومًا نصيًا خاصًا بك."
