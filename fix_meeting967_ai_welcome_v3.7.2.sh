#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.7.2"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-welcome-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

[ -f src/application/services/AIChatRoomService.js ] || die "AIChatRoomService.js غير موجود"

cp -a src/application/services/AIChatRoomService.js "$BACKUP/AIChatRoomService.js"

say "============================================================"
say " Meeting 967 — AI 967 Welcome v${VERSION}"
say " استبدال رسائل الترحيب القديمة برسالة واحدة جديدة"
say "============================================================"

node --input-type=module <<'NODE'
import fs from 'node:fs';

const p='src/application/services/AIChatRoomService.js';
let s=fs.readFileSync(p,'utf8');

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

const welcomeConst=`const WELCOME_MESSAGE=${JSON.stringify(welcome)};`;

if(!s.includes('const WELCOME_MESSAGE=')){
  const classPos=s.indexOf('export class AIChatRoomService');
  if(classPos<0)throw new Error('لم أجد AIChatRoomService class');
  s=s.slice(0,classPos)+welcomeConst+"\n\n"+s.slice(classPos);
}

function replaceWelcomeBlock(source){
  const commentPos=source.indexOf('// Welcome message only once.');
  if(commentPos>=0){
    const returnPos=source.indexOf('    return channel;',commentPos);
    if(returnPos<0)throw new Error('لم أجد return channel بعد كتلة الترحيب.');
    const replacement=`    // Replace old AI welcome messages deterministically.
    const botId=this.botId(guild);
    const messages=await channel.messages.fetch({limit:50}).catch(()=>null);

    const legacyMarkers=[
      'هذه هي المساحة العامة الموحدة للمساعد الذكي داخل Meeting 967',
      'هذه المساحة مخصصة لمساعدتك في كل ما يتعلق بـ Meeting 967',
      'هذه القناة هي مساحة AI 967 العامة',
      'هذه القناة هي بوابة AI 967',
      '🔎 عند السؤال عن كيفية عمل ميزة في البوت يمكن لـAI الرجوع إلى الكود الحالي',
      'مساعدك الذكي المخصص لكل ما يتعلق بـ Meeting 967.'
    ];

    const oldMessages=[...(messages?.values?.()??[])].filter(message=>{
      if(String(message.author?.id)!==String(botId))return false;
      const content=String(message.content??'');
      return legacyMarkers.some(marker=>content.includes(marker));
    });

    for(const message of oldMessages){
      await message.delete('Meeting 967 — استبدال رسالة ترحيب AI 967').catch(error=>{
        this.logger?.warn?.('ai-welcome-delete-failed',{
          channelId:channel.id,
          messageId:message.id,
          error:error?.message??String(error),
        });
      });
    }

    await channel.send({
      content:WELCOME_MESSAGE,
    });

`;
    return source.slice(0,commentPos)+replacement+source.slice(returnPos);
  }

  const recentMarker=source.indexOf('    const recent=await channel.messages.fetch({limit:20})');
  if(recentMarker>=0){
    const returnPos=source.indexOf('    return channel;',recentMarker);
    if(returnPos<0)throw new Error('لم أجد return channel بعد كتلة الترحيب.');
    const replacement=`    // Replace old AI welcome messages deterministically.
    const botId=this.botId(guild);
    const messages=await channel.messages.fetch({limit:50}).catch(()=>null);

    const legacyMarkers=[
      'هذه هي المساحة العامة الموحدة للمساعد الذكي داخل Meeting 967',
      'هذه المساحة مخصصة لمساعدتك في كل ما يتعلق بـ Meeting 967',
      'هذه القناة هي مساحة AI 967 العامة',
      'هذه القناة هي بوابة AI 967',
      '🔎 عند السؤال عن كيفية عمل ميزة في البوت يمكن لـAI الرجوع إلى الكود الحالي',
      'مساعدك الذكي المخصص لكل ما يتعلق بـ Meeting 967.'
    ];

    const oldMessages=[...(messages?.values?.()??[])].filter(message=>{
      if(String(message.author?.id)!==String(botId))return false;
      const content=String(message.content??'');
      return legacyMarkers.some(marker=>content.includes(marker));
    });

    for(const message of oldMessages){
      await message.delete('Meeting 967 — استبدال رسالة ترحيب AI 967').catch(error=>{
        this.logger?.warn?.('ai-welcome-delete-failed',{
          channelId:channel.id,
          messageId:message.id,
          error:error?.message??String(error),
        });
      });
    }

    await channel.send({
      content:WELCOME_MESSAGE,
    });

`;
    return source.slice(0,recentMarker)+replacement+source.slice(returnPos);
  }

  throw new Error('لم أجد كتلة رسالة الترحيب داخل AIChatRoomService.js');
}

s=replaceWelcomeBlock(s);
fs.writeFileSync(p,s);

console.log('✅ welcome replacement installed');
NODE

say "🧪 فحص JavaScript..."
node --check src/application/services/AIChatRoomService.js

say "🧪 تحقق من النص..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
const s=fs.readFileSync('src/application/services/AIChatRoomService.js','utf8');

for(const x of [
  'const WELCOME_MESSAGE=',
  'مساعدك الذكي المخصص لكل ما يتعلق بـ Meeting 967.',
  '💡 كيف تستخدمه؟',
  'كيف أكلف شخصًا بمهمة؟',
  'ما هي صلاحياتي؟',
  'مساعد ذكي يساعدك على فهم النظام، والوصول إلى المعلومات، وإنجاز مهامك بسهولة أكبر.',
  'legacyMarkers',
  "message.delete('Meeting 967 — استبدال رسالة ترحيب AI 967')",
  'content:WELCOME_MESSAGE'
]){
  if(!s.includes(x))throw new Error(`النص/المنطق غير موجود: ${x}`);
}

console.log('✅ welcome replacement verified');
NODE

say ""
say "✅ AI Welcome v${VERSION} تم تثبيته."
say "🛟 Backup: $BACKUP"
say ""
say "المرة القادمة التي تفتح فيها AI 967 سيتم:"
say "  1) حذف رسائل الترحيب القديمة الخاصة بالبوت"
say "  2) إرسال الرسالة الجديدة مرة واحدة"
say ""
say "أعد التشغيل:"
say "npm start"
