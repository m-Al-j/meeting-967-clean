#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.7.4"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-command-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP/src/interfaces/discord/commands"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

FILE="src/interfaces/discord/commands/ai.js"
[ -f "$FILE" ] || die "الملف غير موجود: $FILE"
cp -a "$FILE" "$BACKUP/ai.js"

say "============================================================"
say " Meeting 967 — AI 967 Command Fix v${VERSION}"
say " إصلاح رسالة تم استلام سؤالك داخل /ai"
say "============================================================"

node --input-type=module <<'NODE'
import fs from 'node:fs';
const p='src/interfaces/discord/commands/ai.js';
let s=fs.readFileSync(p,'utf8');

const start=s.indexOf('export async function aiCommand(i,a){');
if(start<0)throw new Error('aiCommand غير موجود');
const end=s.indexOf('\n}\n\nexport async function handleAIInteraction',start);
if(end<0)throw new Error('نهاية aiCommand غير موجودة');

const replacement=`export async function aiCommand(i,a){
  const s=await getSubject(i,a);

  if(!i.guildId){
    throw new AppError(
      'AI_GUILD_ONLY',
      'افتح AI 967 من داخل السيرفر.'
    );
  }

  const question=i.options?.getString?.('question')?.trim()||null;

  // /ai بدون سؤال = فتح قناة AI 967 العامة فقط.
  if(!question){
    return a.aiChatRoomService.openFromCommand(i,s,null);
  }

  // /ai مع سؤال = معالجة السؤال فورًا بدل إظهار رسالة مضللة تطلب من العضو
  // كتابة السؤال مرة ثانية داخل القناة.
  const result=await a.aiAgentService.respond(s,question);

  if(result?.kind==='confirmation'){
    const row=a.aiChatRoomService._confirmButtons?.(result.token);
    const payload={
      content:[
        '🤖 **AI 967**',
        result.text,
        '',
        '**هل تريد تنفيذ العملية؟**',
      ].join('\\n'),
      components:row??[],
      embeds:[],
    };
    if(i.deferred||i.replied)return i.editReply(payload);
    return i.reply({...payload,ephemeral:Boolean(i.guildId)});
  }

  const payload={
    content:[
      '🤖 **AI 967**',
      String(result?.text??'لم أحصل على إجابة واضحة.'),
    ].join('\\n'),
    embeds:[],
  };

  if(i.deferred||i.replied)return i.editReply(payload);
  return i.reply({...payload,ephemeral:Boolean(i.guildId)});
}`;

s=s.slice(0,start)+replacement+s.slice(end+2);
fs.writeFileSync(p,s);
console.log('✅ aiCommand fixed');
NODE

node --check src/interfaces/discord/commands/ai.js

node --input-type=module <<'NODE'
import fs from 'node:fs';
const s=fs.readFileSync('src/interfaces/discord/commands/ai.js','utf8');
if(!s.includes("if(!question){"))throw new Error('فرع /ai بدون سؤال مفقود');
if(!s.includes('const result=await a.aiAgentService.respond(s,question);'))throw new Error('معالجة السؤال مفقودة');
if(s.includes('تم استلام سؤالك. ادخل القناة واكتبه هناك'))throw new Error('الرسالة القديمة ما زالت موجودة');
console.log('✅ AI command checks passed');
NODE

say ""
say "✅ v${VERSION} تم التثبيت"
say "🛟 Backup: $BACKUP"
say ""
say "النتيجة:"
say "  • /ai بدون سؤال يفتح قناة AI 967"
say "  • /ai مع سؤال يجاوب مباشرة ولا يطلب إعادة كتابة السؤال"
say "  • الكتابة العادية داخل ai-967🤖 تستمر عبر messageCreate"
say ""
say "أعد التشغيل:"
say "npm start"
