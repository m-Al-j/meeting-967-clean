#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.2.2"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-chat-room-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

echo "============================================================"
echo " Meeting 967 — AI Chat Room v${VERSION}"
echo " إصلاح index.js بعد إدخال \
n كنص بدل سطر جديد"
echo "============================================================"

cp -a src/index.js "$BACKUP/index.js"

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/index.js';
let s=fs.readFileSync(p,'utf8');

// Normalize the AI messageCreate listener.
// Previous hotfix accidentally wrote the characters "\n"
// into the JavaScript source instead of actual line breaks.
const lines=s.split('\n').filter(line=>{
  const t=line.trim();
  return !t.startsWith("client.on('messageCreate',message=>");
});
s=lines.join('\n');

const anchor="client.on('interactionCreate',i=>routeInteraction(i,app));";
if(!s.includes(anchor))throw new Error('index.js: interactionCreate غير موجود.');

const block=[
  "client.on('messageCreate',message=>{",
  "  app.aiChatRoomService?.handleMessage(message).catch(error=>app.logger.error('ai-chat-message-event-failed',{error:error?.stack??String(error),channelId:message?.channelId,userId:message?.author?.id}));",
  "});"
].join('\n');

if(!s.includes(block)){
  s=s.replace(anchor,block+"\n"+anchor);
}

fs.writeFileSync(p,s);
console.log('✅ index.js messageCreate listener normalized');
NODE

echo "🧪 فحص JavaScript..."
node --check src/index.js
node --check src/app.js
node --check src/application/services/AIChatRoomService.js
node --check src/interfaces/discord/commands/ai.js
node --check src/interfaces/discord/interactions/misc.js
node --check src/interfaces/discord/componentDispatcher.js
node --check src/interfaces/discord/interactionReliability.js

echo "🧪 تحقق من listener..."
grep -n -A2 -B1 "client.on('messageCreate'" src/index.js

echo "🧪 تحقق من عدم وجود \\n كنص داخل listener..."
if grep -nF "client.on('messageCreate',message=>{\\n" src/index.js; then
  echo "❌ ما زال هناك listener مكتوب بصيغة خاطئة."
  exit 1
fi

echo
echo "✅ Hotfix v${VERSION} نجح."
echo "🛟 Backup: $BACKUP"
echo
echo "شغّل الآن:"
echo "npm start"
