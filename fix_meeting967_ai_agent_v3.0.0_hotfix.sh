#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

BACKUP="$ROOT/.update-backups/ai-agent-v3.0.0-hotfix-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"

cp -a src/interfaces/discord/interactions/misc.js "$BACKUP/misc.js"
cp -a src/interfaces/discord/commands/ai.js "$BACKUP/ai.js"

echo "=============================================="
echo " Meeting 967 — AI Agent v3.0.0 Hotfix"
echo " إزالة بقايا AI القديمة من misc.js"
echo "=============================================="

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/interfaces/discord/interactions/misc.js';
let s=fs.readFileSync(p,'utf8');

const oldImport=/^import \{openAIAskModal,submitAIAsk\} from '\.\.\/commands\/ai\.js';\s*$/m;
s=s.replace(oldImport,'');

s=s.replace(
  /^\s*if\(id==='ai:open'\)return openAIAskModal\(i\);\s*\r?\n\s*if\(id==='ai:ask'\)return submitAIAsk\(i,a\);\s*/m,
  ''
);

if(!s.includes("import {handleAIInteraction} from '../commands/ai.js';")){
  const anchor="import {refreshPanel,personalGuide,panelHub,panelSection} from '../commands/panel.js';";
  if(!s.includes(anchor))throw new Error('لم أجد import الخاص بـ panel.js في misc.js');
  s=s.replace(anchor,anchor+"\nimport {handleAIInteraction} from '../commands/ai.js';");
}

if(!s.includes("if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);")){
  const start="export async function handleMisc(i,a){const id=i.customId??'';const s=await subjectFromInteraction(i,a.env);";
  if(!s.includes(start))throw new Error('لم أجد بداية handleMisc المتوقعة');
  s=s.replace(start,start+"\n  if(id.startsWith('ai:'))return handleAIInteraction(i,a,s,id);");
}

fs.writeFileSync(p,s);
console.log('✅ misc.js cleaned and routed to new AI handler');
NODE

echo "🧪 فحص الملفات..."
node --check src/interfaces/discord/commands/ai.js
node --check src/interfaces/discord/interactions/misc.js
node --check src/interfaces/discord/router.js
node --check src/interfaces/discord/interactionReliability.js
node --check src/application/services/AIAgentService.js
node --check src/app.js

echo "🔎 تحقق من عدم بقاء import القديم..."
if grep -nE 'openAIAskModal|submitAIAsk|ai:ask' src/interfaces/discord/interactions/misc.js; then
  echo "❌ ما زالت هناك بقايا من النسخة القديمة"
  exit 1
fi

echo "🔎 تحقق من الربط الجديد..."
grep -nE 'handleAIInteraction|startsWith\(.*ai:' src/interfaces/discord/interactions/misc.js

echo "✅ تم إصلاح التعارض."
echo "🛟 النسخة الاحتياطية: $BACKUP"
echo
echo "شغّل الآن:"
echo "  npm start"
