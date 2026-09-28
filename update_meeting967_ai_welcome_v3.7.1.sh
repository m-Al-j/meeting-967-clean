#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.7.1"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-welcome-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

say "============================================================"
say " Meeting 967 — AI 967 Welcome v${VERSION}"
say " تحديث الرسالة الرسمية الترحيبية"
say "============================================================"

[ -f src/application/services/AIChatRoomService.js ] || die "AIChatRoomService.js غير موجود"
[ -f src/interfaces/discord/commands/ai.js ] || die "ai.js غير موجود"

mkdir -p "$BACKUP/src/application/services" \
         "$BACKUP/src/interfaces/discord/commands"

cp -a src/application/services/AIChatRoomService.js \
  "$BACKUP/src/application/services/AIChatRoomService.js"

cp -a src/interfaces/discord/commands/ai.js \
  "$BACKUP/src/interfaces/discord/commands/ai.js"

say "✏️ تحديث نص الترحيب..."

cat > /tmp/meeting967-ai-welcome.txt <<'WELCOME'
## 🤖 AI 967

مرحبًا بك في AI 967

مساعدك الذكي المخصص لكل ما يتعلق بـ Meeting 967.

يمكنك استخدام AI 967 للاستفسار عن البوت، وفهم طريقة استخدامه، ومعرفة مهامك وصلاحياتك، ومتابعة الاجتماعات والعضوية، والحصول على المساعدة عند مواجهة أي مشكلة.

💡 كيف تستخدمه؟

استخدم الأمر:

"/ai"

ثم اكتب سؤالك بشكل مباشر وواضح، وسيقوم AI 967 بتحليل سؤالك والإجابة بناءً على معلومات النظام والصلاحيات والبيانات المتاحة لك.

🔎 يمكنك السؤال عن أمور البوت مثل:

كيف أكلف شخصًا بمهمة؟

كيف أعدل موعد اجتماع؟

ما هي صلاحياتي؟

ما هي مهامي الحالية؟

كيف أستخدم إحدى ميزات البوت؟

واجهت مشكلة في البوت، كيف أحلها؟

ما هي تفاصيل مهمة معينة؟

وأي استفسار آخر يتعلق بـ Meeting 967.

🤖 AI 967

مساعد ذكي يساعدك على فهم النظام، والوصول إلى المعلومات، وإنجاز مهامك بسهولة أكبر.
WELCOME

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/application/services/AIChatRoomService.js';
let s=fs.readFileSync(p,'utf8');

const start=s.indexOf("const PUBLIC_MARKER=");
const classStart=s.indexOf("export class AIChatRoomService");

if(start<0||classStart<0)throw new Error('تعذر تحديد مكان ثوابت AIChatRoomService.');

const welcome=`## 🤖 AI 967

مرحبًا بك في AI 967

مساعدك الذكي المخصص لكل ما يتعلق بـ Meeting 967.

يمكنك استخدام AI 967 للاستفسار عن البوت، وفهم طريقة استخدامه، ومعرفة مهامك وصلاحياتك، ومتابعة الاجتماعات والعضوية، والحصول على المساعدة عند مواجهة أي مشكلة.

💡 كيف تستخدمه؟

استخدم الأمر:

"/ai"

ثم اكتب سؤالك بشكل مباشر وواضح، وسيقوم AI 967 بتحليل سؤالك والإجابة بناءً على معلومات النظام والصلاحيات والبيانات المتاحة لك.

🔎 يمكنك السؤال عن أمور البوت مثل:

كيف أكلف شخصًا بمهمة؟

كيف أعدل موعد اجتماع؟

ما هي صلاحياتي؟

ما هي مهامي الحالية؟

كيف أستخدم إحدى ميزات البوت؟

واجهت مشكلة في البوت، كيف أحلها؟

ما هي تفاصيل مهمة معينة؟

وأي استفسار آخر يتعلق بـ Meeting 967.

🤖 AI 967

مساعد ذكي يساعدك على فهم النظام، والوصول إلى المعلومات، وإنجاز مهامك بسهولة أكبر.`;

const welcomeLiteral=`const WELCOME_MESSAGE=${JSON.stringify(welcome)};`;

if(!s.includes('const WELCOME_MESSAGE=')){
  const insertAt=start;
  s=s.slice(0,insertAt)+welcomeLiteral+"\n"+s.slice(insertAt);
}

// Replace the existing welcome message send block with a stable variable.
// We search structurally between "if(!welcomeExists)" and the following "return channel".
const ifPos=s.indexOf('if(!welcomeExists)');
const returnPos=ifPos>=0?s.indexOf('return channel;',ifPos):-1;

if(ifPos<0||returnPos<0)throw new Error('تعذر تحديد كتلة رسالة الترحيب الحالية.');

const block=[
  '    if(!welcomeExists){',
  '      await channel.send({',
  '        content:WELCOME_MESSAGE,',
  '      });',
  '    }',
  '',
].join('\n');

s=s.slice(0,ifPos)+block+s.slice(returnPos);

fs.writeFileSync(p,s);
console.log('✅ welcome code updated');
NODE

say "🧪 فحص JavaScript..."
node --check src/application/services/AIChatRoomService.js
node --check src/interfaces/discord/commands/ai.js

say "🔎 إضافة تحديث تلقائي للرسالة القديمة..."

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/application/services/AIChatRoomService.js';
let s=fs.readFileSync(p,'utf8');

if(!s.includes('findWelcomeMessage')){
  const anchor='  async ensurePublicRoom(guild){';
  if(!s.includes(anchor))throw new Error('ensurePublicRoom غير موجود.');

  const methods=`  async findWelcomeMessage(channel){
    const recent=await channel.messages.fetch({limit:30}).catch(()=>null);
    if(!recent)return null;

    const botId=this.botId(channel.guild);

    return [...recent.values()].find(message=>
      String(message.author?.id)===String(botId) &&
      (
        String(message.content??'').includes('مرحبًا بك في AI 967') ||
        String(message.content??'').includes('هذه القناة هي مساحة AI 967 العامة') ||
        String(message.content??'').includes('هذه المساحة هي بوابة AI 967')
      )
    )??null;
  }

`;
  s=s.replace(anchor,methods+anchor);
}

// Ensure the existing welcome is edited to the new text instead of
// leaving the previous version untouched.
const oldSnippet=`    const recent=await channel.messages.fetch({limit:20}).catch(()=>null);
    const welcomeExists=[...(recent?.values?.()??[])].some(
      m=>String(m.author?.id)===this.botUserId &&
        String(m.content??'').includes('مرحبًا بك في AI 967')
    );

    if(!welcomeExists){
      await channel.send({
        content:WELCOME_MESSAGE,
      });
    }
`;

if(s.includes(oldSnippet)){
  const replacement=`    const welcomeMessage=await this.findWelcomeMessage(channel);

    if(welcomeMessage){
      if(String(welcomeMessage.content??'')!==WELCOME_MESSAGE){
        await welcomeMessage.edit({content:WELCOME_MESSAGE}).catch(error=>
          this.logger?.warn?.('ai-welcome-message-update-failed',{
            channelId:channel.id,
            error:error?.message??String(error),
          })
        );
      }
    }else{
      await channel.send({
        content:WELCOME_MESSAGE,
      });
    }
`;
  s=s.replace(oldSnippet,replacement);
}else{
  // More defensive replacement: remove the old detection/send section
  // if the previous installer slightly formatted it differently.
  const marker=s.indexOf('    const recent=await channel.messages.fetch({limit:20})');
  const end=marker>=0?s.indexOf('    return channel;',marker):-1;
  if(marker>=0&&end>marker){
    const replacement=`    const welcomeMessage=await this.findWelcomeMessage(channel);

    if(welcomeMessage){
      if(String(welcomeMessage.content??'')!==WELCOME_MESSAGE){
        await welcomeMessage.edit({content:WELCOME_MESSAGE}).catch(error=>
          this.logger?.warn?.('ai-welcome-message-update-failed',{
            channelId:channel.id,
            error:error?.message??String(error),
          })
        );
      }
    }else{
      await channel.send({
        content:WELCOME_MESSAGE,
      });
    }

`;
    s=s.slice(0,marker)+replacement+s.slice(end);
  }else{
    throw new Error('تعذر تحديد كتلة welcome الحالية للتحديث.');
  }
}

fs.writeFileSync(p,s);
console.log('✅ existing welcome update logic installed');
NODE

say "🧪 فحص نهائي..."
node --check src/application/services/AIChatRoomService.js

say "🧪 تحقق من النص..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
const s=fs.readFileSync('src/application/services/AIChatRoomService.js','utf8');

for(const x of [
  'مرحبًا بك في AI 967',
  'مساعدك الذكي المخصص لكل ما يتعلق بـ Meeting 967.',
  '💡 كيف تستخدمه؟',
  '"/ai"',
  'كيف أكلف شخصًا بمهمة؟',
  'ما هي صلاحياتي؟',
  'وأي استفسار آخر يتعلق بـ Meeting 967.',
  'مساعد ذكي يساعدك على فهم النظام'
]){
  if(!s.includes(x))throw new Error(`النص غير موجود: ${x}`);
}

if(s.includes('عند السؤال عن كيفية عمل ميزة في البوت يمكن لـAI الرجوع إلى الكود الحالي')){
  throw new Error('ما زال نص الرجوع إلى الكود موجودًا في الرسالة.');
}

console.log('✅ welcome text verified');
NODE

say ""
say "✅ AI 967 Welcome v${VERSION} تم."
say "🛟 Backup: $BACKUP"
say ""
say "عند فتح AI 967 سيقوم البوت بتحديث الرسالة القديمة تلقائيًا إلى النص الجديد."
say ""
say "أعد التشغيل:"
say "npm start"
