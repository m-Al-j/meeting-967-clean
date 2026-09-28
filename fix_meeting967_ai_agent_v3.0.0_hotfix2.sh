#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-agent-v3.0.0-hotfix2-$STAMP"
mkdir -p "$BACKUP"
cp -a src/interfaces/discord/interactions/misc.js "$BACKUP/misc.js"

echo "============================================================"
echo " Meeting 967 — AI Agent v3.0.0 Hotfix 2"
echo " تنظيف كامل لبقايا AI Assistant القديمة"
echo "============================================================"

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/interfaces/discord/interactions/misc.js';
let lines=fs.readFileSync(p,'utf8').split('\n');

// Remove every old AI Assistant reference from misc.js.
// This is intentionally line-based because previous versions used
// slightly different whitespace/argument formatting.
lines=lines.filter(line=>{
  const t=line.trim();
  return !t.includes('openAIAskModal') && !t.includes('submitAIAsk');
});
let s=lines.join('\n');

const newImport="import {handleAIInteraction} from '../commands/ai.js';";
if(!s.includes(newImport)){
  const anchor="import {refreshPanel,personalGuide,panelHub,panelSection} from '../commands/panel.js';";
  if(!s.includes(anchor))throw new Error('لم أجد panel import في misc.js');
  s=s.replace(anchor,anchor+"\n"+newImport);
}

// Ensure exactly one AI router line inside handleMisc.
s=s.replace(/^\s*if\(id\.startsWith\(['"]ai:['"]\)\)return handleAIInteraction\(i,a,s,id\);\s*$/gm,'');

const start="export async function handleMisc(i,a){const id=i.customId??'';const s=await subjectFromInteraction(i,a.env);";
if(!s.includes(start))throw new Error('لم أجد بداية handleMisc بالشكل المتوقع');

s=s.replace(start,start+"\n  if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);");

fs.writeFileSync(p,s);
console.log('✅ old AI references removed and new route installed');
NODE

echo
echo "🧪 فحص JavaScript..."
node --check src/interfaces/discord/interactions/misc.js
node --check src/interfaces/discord/commands/ai.js
node --check src/application/services/AIAgentService.js
node --check src/app.js
node --check src/interfaces/discord/router.js
node --check src/interfaces/discord/interactionReliability.js

echo
echo "🔎 فحص التعارض..."
if grep -nE 'openAIAskModal|submitAIAsk' src/interfaces/discord/interactions/misc.js; then
  echo "❌ ما زالت بقايا قديمة موجودة."
  exit 1
fi

echo "🔎 فحص الربط الجديد..."
grep -nE "handleAIInteraction|id.startsWith\\('ai:'\\)" src/interfaces/discord/interactions/misc.js

echo
echo "✅ Hotfix 2 نجح."
echo "🛟 النسخة الاحتياطية: $BACKUP"
echo
echo "شغّل:"
echo "npm start"
