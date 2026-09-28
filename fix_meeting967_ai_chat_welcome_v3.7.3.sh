#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$ROOT"

VERSION="3.7.3"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/.update-backups/ai-public-welcome-v${VERSION}-${STAMP}"
mkdir -p "$BACKUP/src/application/services" "$BACKUP/src"

say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }

for f in src/application/services/AIChatRoomService.js src/index.js; do
  [ -f "$f" ] || die "الملف غير موجود: $f"
  cp -a "$f" "$BACKUP/$f"
done

say "============================================================"
say " Meeting 967 — AI 967 Public Chat v${VERSION}"
say " إصلاح تكرار/حذف رسالة الترحيب وعدم إفساد إجابة السؤال"
say "============================================================"

node --input-type=module <<'NODE'
import fs from 'node:fs';

const servicePath='src/application/services/AIChatRoomService.js';
let s=fs.readFileSync(servicePath,'utf8');

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
  s=s.slice(0,classPos)+welcomeConst+'\n\n'+s.slice(classPos);
}

// Locate ensurePublicRoom and replace only its welcome-maintenance section.
const ensurePos=s.indexOf('  async ensurePublicRoom(guild){');
if(ensurePos<0)throw new Error('ensurePublicRoom غير موجود');
const returnPos=s.indexOf('    return channel;',ensurePos);
if(returnPos<0)throw new Error('return channel غير موجود بعد ensurePublicRoom');

const blockStartCandidates=[
  s.indexOf('    // Replace old AI welcome messages deterministically.',ensurePos),
  s.indexOf('    // Welcome message only once.',ensurePos),
  s.indexOf('    const recent=await channel.messages.fetch({limit:20})',ensurePos),
  s.indexOf('    const recent=await channel.messages.fetch({limit:50})',ensurePos),
].filter(x=>x>=0 && x<returnPos);

if(!blockStartCandidates.length)throw new Error('لم أجد كتلة رسالة الترحيب داخل ensurePublicRoom');
const blockStart=Math.min(...blockStartCandidates);

const replacement=`    // AI 967 welcome is strictly idempotent:
    // clean known legacy messages once, then keep the current welcome untouched.
    const botId=this.botId(guild);
    const recent=await channel.messages.fetch({limit:50}).catch(()=>null);
    const botMessages=[...(recent?.values?.()??[])].filter(message=>
      String(message.author?.id)===String(botId)
    );

    const legacyMarkers=[
      'هذه هي المساحة العامة الموحدة للمساعد الذكي داخل Meeting 967',
      'هذه المساحة مخصصة لمساعدتك في كل ما يتعلق بـ Meeting 967',
      'هذه القناة هي مساحة AI 967 العامة',
      'هذه القناة هي بوابة AI 967',
      '🔎 عند السؤال عن كيفية عمل ميزة في البوت يمكن لـAI الرجوع إلى الكود الحالي'
    ];

    for(const message of botMessages){
      const content=String(message.content??'');
      if(legacyMarkers.some(marker=>content.includes(marker))){
        await message.delete('Meeting 967 — إزالة رسالة AI 967 القديمة').catch(error=>{
          this.logger?.warn?.('ai-welcome-delete-failed',{
            channelId:channel.id,
            messageId:message.id,
            error:error?.message??String(error),
          });
        });
      }
    }

    const currentWelcome=botMessages.find(message=>
      String(message.content??'')===WELCOME_MESSAGE
    );

    if(!currentWelcome){
      await channel.send({content:WELCOME_MESSAGE});
    }

`;

s=s.slice(0,blockStart)+replacement+s.slice(returnPos);

// Add a small safety flag so ensurePublicRoom cannot overlap its own welcome work.
if(!s.includes('this._welcomeLocks=new Set();')){
  const ctorAnchor='    this.active=new Set();';
  if(s.includes(ctorAnchor)){
    s=s.replace(ctorAnchor,ctorAnchor+'\n    this._welcomeLocks=new Set();');
  }
}

// Prevent accidental self-runs of welcome maintenance while a previous ensure is active.
// We do not wrap the whole method; instead handleMessage must never call ensurePublicRoom.

fs.writeFileSync(servicePath,s);
console.log('✅ AIChatRoomService welcome logic fixed');
NODE

node --check src/application/services/AIChatRoomService.js

node --input-type=module <<'NODE'
import fs from 'node:fs';
const s=fs.readFileSync('src/application/services/AIChatRoomService.js','utf8');
for(const x of [
  'const WELCOME_MESSAGE=',
  'const currentWelcome=botMessages.find',
  'if(!currentWelcome)',
  'هذه هي المساحة العامة الموحدة للمساعد الذكي داخل Meeting 967',
  'content:WELCOME_MESSAGE',
  'async handleMessage(message)'
]){
  if(!s.includes(x))throw new Error(`ناقص: ${x}`);
}
if(s.includes("'مساعدك الذكي المخصص لكل ما يتعلق بـ Meeting 967.'\n    ]")){
  throw new Error('تم ترك عبارة الرسالة الجديدة ضمن legacyMarkers بشكل خاطئ');
}

const h=s.indexOf('  async handleMessage(message){');
const next=s.indexOf('  _confirmButtons(',h);
const handle=h>=0&&next>h?s.slice(h,next):'';
if(handle.includes('ensurePublicRoom('))throw new Error('handleMessage ما زال يستدعي ensurePublicRoom');
console.log('✅ service checks passed');
NODE

say "🔧 تنظيف messageCreate في index.js..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
const p='src/index.js';
let s=fs.readFileSync(p,'utf8');
const markers=[];
let pos=0;
while(true){
  const i=s.indexOf("client.on('messageCreate'",pos);
  if(i<0)break;
  markers.push(i); pos=i+10;
}

if(markers.length>0){
  // Remove all messageCreate blocks conservatively by taking from the listener start
  // to the first matching `});` on the same top-level block. This listener is intentionally simple.
  for(let k=markers.length-1;k>=0;k--){
    const start=markers[k];
    const end=s.indexOf('});',start);
    if(end<0)throw new Error('تعذر تحديد نهاية messageCreate listener');
    s=s.slice(0,start)+s.slice(end+3);
  }
}

const anchor="client.on('interactionCreate',i=>routeInteraction(i,app));";
if(!s.includes(anchor))throw new Error('interactionCreate anchor غير موجود');
const listener=`client.on('messageCreate',message=>{
  app.aiChatRoomService?.handleMessage(message).catch(error=>
    app.logger.error('ai-chat-message-event-failed',{
      error:error?.stack??String(error),
      channelId:message?.channelId,
      userId:message?.author?.id,
    })
  );
});
`;
s=s.replace(anchor,listener+anchor);
fs.writeFileSync(p,s);
console.log(`✅ messageCreate normalized (old listeners: ${markers.length})`);
NODE

node --check src/index.js

node --input-type=module <<'NODE'
import fs from 'node:fs';
const s=fs.readFileSync('src/index.js','utf8');
const count=(s.match(/client\.on\('messageCreate'/g)||[]).length;
if(count!==1)throw new Error(`messageCreate listeners = ${count}, المتوقع 1`);
const start=s.indexOf("client.on('messageCreate'");
const end=s.indexOf("client.on('interactionCreate'",start);
const block=s.slice(start,end>start?end:start+3000);
if(block.includes('ensurePublicRoom('))throw new Error('messageCreate ما زال يستدعي ensurePublicRoom');
if(!block.includes('aiChatRoomService?.handleMessage(message)'))throw new Error('handleMessage غير مربوط');
console.log('✅ index checks passed');
NODE

say ""
say "✅ AI 967 Public Chat v${VERSION} تم إصلاحه."
say "🛟 Backup: $BACKUP"
say ""
say "النتيجة:"
say "  • رسالة الترحيب لا تُحذف عند كل سؤال"
say "  • رسالة الترحيب الجديدة لا تُرسل مرة ثانية عند كل سؤال"
say "  • handleMessage يعالج السؤال مباشرة"
say "  • messageCreate يحتوي على مستمع واحد فقط"
say "  • لا يوجد ensurePublicRoom داخل مسار استقبال الأسئلة"
say ""
say "أعد تشغيل البوت:"
say "npm start"
