#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-agent-v3.0.1-hotfix-$STAMP"
mkdir -p "$BACKUP"

cp -a src/interfaces/discord/componentDispatcher.js "$BACKUP/componentDispatcher.js"
cp -a src/interfaces/discord/interactions/misc.js "$BACKUP/misc.js"
cp -a src/interfaces/discord/interactionReliability.js "$BACKUP/interactionReliability.js"
cp -a src/interfaces/discord/commands/ai.js "$BACKUP/ai.js"

echo "============================================================"
echo " Meeting 967 — AI Agent v3.0.1 Hotfix"
echo " إصلاح مسار أزرار AI + توافق النسخة القديمة"
echo "============================================================"

node --input-type=module <<'NODE'
import fs from 'node:fs';

function write(p,s){fs.writeFileSync(p,s);}

// 1) Direct AI routing in dispatcher. This guarantees every ai:* component
// reaches the AI handler instead of relying on generic classification.
{
  const p='src/interfaces/discord/componentDispatcher.js';
  let s=fs.readFileSync(p,'utf8');

  if(!s.includes("import {handleAIInteraction} from './commands/ai.js';")){
    const anchor="import {handleOperations} from './interactions/operations.js';";
    if(s.includes(anchor)){
      s=s.replace(anchor,anchor+"\nimport {handleAIInteraction} from './commands/ai.js';");
    }else{
      const fallback="import {handlerForCustomId} from './interactionReliability.js';";
      if(!s.includes(fallback))throw new Error('componentDispatcher.js: import anchor غير موجود');
      s=s.replace(fallback,fallback+"\nimport {handleAIInteraction} from './commands/ai.js';");
    }
  }

  const anchor="export async function dispatchComponentInteraction(interaction,app){\n";
  if(!s.includes(anchor))throw new Error('componentDispatcher.js: dispatch غير موجود');

  if(!s.includes("String(interaction.customId??'').startsWith('ai:')")){
    s=s.replace(anchor,anchor+"  if(String(interaction.customId??'').startsWith('ai:')){\n    const subject=await import('./context.js').then(m=>m.subjectFromInteraction(interaction,app.env));\n    return handleAIInteraction(interaction,app,subject,String(interaction.customId??''));\n  }\n");
  }

  write(p,s);
}

// 2) Make misc routing support both new AI handler and old AI Assistant IDs.
{
  const p='src/interfaces/discord/interactions/misc.js';
  let s=fs.readFileSync(p,'utf8');

  if(!s.includes("import {handleAIInteraction} from '../commands/ai.js';")){
    const anchor="import {refreshPanel,personalGuide,panelHub,panelSection} from '../commands/panel.js';";
    if(!s.includes(anchor))throw new Error('misc.js: panel import غير موجود');
    s=s.replace(anchor,anchor+"\nimport {handleAIInteraction} from '../commands/ai.js';");
  }

  // Remove duplicate AI routing lines and rebuild one canonical route.
  s=s.replace(/^\s*if\(id\.startsWith\(['"]ai:['"]\)\)return handleAIInteraction\(i,a,s,id\);\s*$/gm,'');

  const start="export async function handleMisc(i,a){const id=i.customId??'';const s=await subjectFromInteraction(i,a.env);";
  if(!s.includes(start))throw new Error('misc.js: handleMisc غير موجود');

  s=s.replace(start,start+"\n  if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);");

  write(p,s);
}

// 3) Ensure modal opener covers both current and old AI buttons.
{
  const p='src/interfaces/discord/interactionReliability.js';
  let s=fs.readFileSync(p,'utf8');
  const anchor='const MODAL_OPENERS = [';
  if(!s.includes(anchor))throw new Error('interactionReliability.js: MODAL_OPENERS غير موجود');

  const lines=[
    "  id => id === 'ai:message',",
    "  id => id === 'ai:ask',",
  ];
  for(const line of lines){
    if(!s.includes(line))s=s.replace(anchor,anchor+"\n"+line);
  }
  write(p,s);
}

// 4) Backward compatibility: old button IDs are translated to the new UI.
{
  const p='src/interfaces/discord/commands/ai.js';
  let s=fs.readFileSync(p,'utf8');

  // Old ai:open should still open the new chat.
  // Old ai:ask may be a modal submit from the previous version.
  if(!s.includes("if(id==='ai:ask'")){
    const anchor="export async function handleAIInteraction(i,a,s,id){";
    if(!s.includes(anchor))throw new Error('ai.js: handleAIInteraction غير موجود');
    s=s.replace(anchor,anchor+"\n  if(id==='ai:ask'){ return i.isButton?.() ? i.showModal(modal()) : submitAIMessage(i,a); }");
  }

  write(p,s);
}
NODE

echo "🧪 فحص JavaScript..."
node --check src/interfaces/discord/componentDispatcher.js
node --check src/interfaces/discord/interactions/misc.js
node --check src/interfaces/discord/interactionReliability.js
node --check src/interfaces/discord/commands/ai.js
node --check src/application/services/AIAgentService.js
node --check src/app.js
node --check src/interfaces/discord/router.js

echo "🔎 تحقق من المسار المباشر..."
grep -n "startsWith('ai:')" src/interfaces/discord/componentDispatcher.js
grep -n "handleAIInteraction" src/interfaces/discord/componentDispatcher.js
grep -nE "ai:message|ai:ask" src/interfaces/discord/interactionReliability.js
grep -nE "ai:ask|handleAIInteraction" src/interfaces/discord/commands/ai.js

echo
echo "✅ Hotfix 3.0.1 تم تثبيته."
echo "🛟 Backup: $BACKUP"
echo
echo "أعد تشغيل البوت:"
echo "npm start"
