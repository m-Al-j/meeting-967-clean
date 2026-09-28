import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,User} from 'discord.js';

const INSTALL_SYMBOL=Symbol.for('operations967.firstDmWelcome.installed.v1.10.2');
const ORIGINAL_SEND_SYMBOL=Symbol.for('operations967.firstDmWelcome.originalSend');
const GOLD=0xD4AF37;

function textFromPayload(payload){
  if(typeof payload==='string')return payload;
  if(!payload||typeof payload!=='object')return '';
  const parts=[];
  if(payload.content)parts.push(String(payload.content));
  for(const embed of payload.embeds??[]){
    const data=typeof embed?.toJSON==='function'?embed.toJSON():embed;
    if(data?.title)parts.push(String(data.title));
    if(data?.description)parts.push(String(data.description));
  }
  return parts.join('\n');
}

export function classifyFirstDmReason(payload){
  const text=textFromPayload(payload);
  if(/تكليف|مهمة|مهمتك|المهام/.test(text))return '📋 **سبب فتح المحادثة الآن:** تكليف أو متابعة تخصك.';
  if(/صلاحية|الصلاحيات|وصول الإدارة|استلام.*تقرير|استلام.*تسجيل/.test(text))return '🔐 **سبب فتح المحادثة الآن:** تحديث في صلاحياتك أو مسؤولياتك.';
  if(/اجتماع|تذكير|موعد/.test(text))return '📅 **سبب فتح المحادثة الآن:** تنبيه مرتبط باجتماع أو موعد.';
  if(/تقرير|تسجيل|مخرجات|ملف/.test(text))return '📦 **سبب فتح المحادثة الآن:** مخرجات أو ملفات أصبحت متاحة لك.';
  return '🔔 **سبب فتح المحادثة الآن:** لديك إشعار جديد مخصص لك.';
}

export function buildFirstDmWelcomePayload({username='عضو 967',avatarUrl=null,reason='🔔 لديك إشعار جديد مخصص لك.'}={}){
  const embed=new EmbedBuilder()
    .setColor(GOLD)
    .setTitle('مرحبًا بك في Operations 967 👋')
    .setDescription([
      `أهلًا **${String(username).slice(0,80)}**،`,'',
      'هذه المحادثة هي قناتك المباشرة مع نظام **Operations 967**. من هنا ستصلك فقط الأشياء المرتبطة بك، بشكل واضح ومرتب بدون الحاجة لمتابعة كل القنوات.','',
      reason,'',
      '━━━━━━━━━━━━━━━━━━',
      '📋 **التكليفات والمتابعة** — ما أُسند إليك ومواعيده وحالته.',
      '🔐 **الصلاحيات والمسؤوليات** — أي صلاحية أو مسؤولية تُمنح لك أو تتغير.',
      '📅 **الاجتماعات والتنبيهات** — المواعيد والتذكيرات التي تخصك.',
      '📦 **المخرجات** — التقارير والتسجيلات المصرح لك باستلامها.','',
      'بعد هذه البطاقة ستصلك الرسالة التي فتحت المحادثة الآن. وبعدها لن نكرر الترحيب مرة ثانية.',
      'اضغط **فتح لوحتي** في أي وقت لمشاهدة كل ما يخصك.'
    ].join('\n'))
    .setFooter({text:'967 • تشغيل مؤسسي • توثيق • متابعة • استمرارية'});
  if(avatarUrl)embed.setThumbnail(avatarUrl);
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:refresh').setLabel('فتح لوحتي').setEmoji('🏠').setStyle(ButtonStyle.Primary)
  );
  return {embeds:[embed],components:[row]};
}

async function claimFirst(db,userId){
  const {rows}=await db.query(`
    INSERT INTO bot_dm_first_contact(user_id)
    VALUES($1)
    ON CONFLICT(user_id) DO NOTHING
    RETURNING user_id
  `,[String(userId)]);
  return Boolean(rows?.[0]);
}

async function markSent(db,userId,reason){
  await db.query(`UPDATE bot_dm_first_contact SET welcomed_at=now(), first_reason=$2 WHERE user_id=$1`,[String(userId),String(reason).slice(0,240)]);
}

async function releaseClaim(db,userId){
  await db.query(`DELETE FROM bot_dm_first_contact WHERE user_id=$1 AND welcomed_at IS NULL`,[String(userId)]);
}

export function installFirstDmWelcome({db,logger}={}){
  if(!db?.query)throw new Error('FirstDmWelcome requires db.query');
  if(User.prototype[INSTALL_SYMBOL])return false;
  const original=User.prototype.send;
  if(typeof original!=='function')throw new Error('Discord User.send is unavailable');
  Object.defineProperty(User.prototype,ORIGINAL_SEND_SYMBOL,{value:original,configurable:false,writable:false});
  Object.defineProperty(User.prototype,INSTALL_SYMBOL,{value:true,configurable:false,writable:false});

  User.prototype.send=async function(payload){
    // Do not attempt onboarding messages to bot accounts.
    if(this.bot)return original.call(this,payload);
    let first=false;
    try{
      first=await claimFirst(db,this.id);
    }catch(error){
      logger?.warn?.('first-dm-welcome-claim-failed',{userId:String(this.id),error:error?.message??String(error)});
      return original.call(this,payload);
    }

    if(first){
      const reason=classifyFirstDmReason(payload);
      const avatar=this.client?.user?.displayAvatarURL?.({size:256})??null;
      const name=this.globalName??this.username??'عضو 967';
      try{
        await original.call(this,buildFirstDmWelcomePayload({username:name,avatarUrl:avatar,reason}));
        await markSent(db,this.id,reason).catch(error=>logger?.warn?.('first-dm-welcome-mark-failed',{userId:String(this.id),error:error?.message??String(error)}));
      }catch(error){
        await releaseClaim(db,this.id).catch(()=>{});
        logger?.warn?.('first-dm-welcome-send-failed',{userId:String(this.id),error:error?.message??String(error)});
        throw error;
      }
    }
    return original.call(this,payload);
  };
  return true;
}
