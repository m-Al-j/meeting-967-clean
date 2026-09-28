# Meeting 967 — Feature Checklist

| الميزة | الحالة | ملاحظات |
|---|---|---|
| إدارة الاجتماعات | ✅ | إنشاء/تعديل/تغيير موعد/تأجيل/إلغاء/بدء/إنهاء + حالات + فحص جاهزية |
| Snapshot أعضاء الاجتماع | ✅ | يؤخذ عند Start ويصبح أساس الحضور |
| الفرق والأعضاء | ✅ | إنشاء/تعطيل/إضافة/إزالة/نقل عضو |
| رؤية العضو لاجتماعات فريقه | ✅ | Query مرتبط بعضوية الفرق |
| الحضور الصوتي | ✅ | دخول/خروج/جلسات/مدة/نسبة/تأخير |
| حاضر/غائب/متأخر/معتذر | ✅ | مشتقة عند إنهاء الاجتماع مع override يدوي |
| التعديل اليدوي للحضور | ✅ | يحفظ original_status وAudit Log |
| الاعتذارات | ✅ | Pending/Approved/Rejected + duplicate protection |
| التسجيل الصوتي | ⚠️ منفذ مع قيد | Ogg Opus segments؛ استقبال صوت Discord غير موثق رسميًا |
| تقارير DOCX | ✅ | توليد وربط وحفظ وSHA-256 وإرسال لقناة التقارير إن ضُبطت |
| القرارات | ✅ | مرتبطة بالاجتماع وتدخل التقرير |
| الأرشيف والبحث | ✅ | اسم/وصف/اسم فريق/تاريخ/عضو/حالة + تفاصيل |
| User Permissions | ✅ | allow/deny + scopes |
| Role Permissions | ✅ | allow/deny + scopes |
| Team Permissions | ✅ | توريث لأعضاء الفريق + scopes |
| Global/Team/Meeting Scope | ✅ | Resolver واختبارات |
| إخفاء UI غير المسموح | ✅ | `/panel` يبني الأزرار حسب الصلاحيات |
| Server-side permission checks | ✅ | داخل handlers قبل الإجراءات الحساسة |
| لوحة العضو | ✅ | اجتماعات/اعتذارات/فريق/حضور عند السماح |
| لوحة الإدارة | ✅ | اجتماعات/فرق/اعتذارات/حضور/تقارير/تسجيلات/أرشيف/صلاحيات/Audit/Backup/Settings |
| Audit Log | ✅ | Actor/Action/Target/Old/New/Metadata/Timestamp |
| Backup يدوي | ✅ | pg_dump custom format |
| Backup دوري | ✅ | يعمل ما دام البوت شغالًا |
| Owner protection | ✅ | Owner allow افتراضي خارج Rows القابلة للسحب |
| Rate limiting | ✅ جزئي مقصود | اعتذارات/Backup/صلاحيات؛ قابل للتوسعة |
| Input validation | ✅ | Zod + DB constraints + UI validators |
| Central error handler | ✅ | Interaction + global process logging |
| PostgreSQL Schema | ✅ | Models المطلوبة + attendance_sessions/recording_tracks إضافية |
| Migration System | ✅ | SQL files + schema_migrations runner |
| `/setup` | ✅ | قنوات/رتبة إدارة/فرق/تسجيل |
| `/panel` | ✅ | الواجهة الرئيسية |
| Termux compatibility | ✅ قدر الإمكان | pg pure JS + DNS/IPv4 workaround + لا Native Opus decoder |
| npm scripts المطلوبة | ✅ | dev/start/migrate/deploy/lint/test + seed/doctor/backup |
| اختبارات Permission Resolver | ✅ | موجودة |
| اختبارات Meeting lifecycle | ✅ | موجودة |
| اختبارات Excuse workflow | ✅ | موجودة |
| اختبارات Attendance state | ✅ | موجودة |
| اختبارات Permission scope | ✅ | موجودة |
| Syntax / local imports | ✅ | `npm run lint` نجح أثناء البناء |
| Unit tests | ✅ |  نجحت أثناء البناء |
| npm install داخل بيئة البناء | ⚠️ لم يكتمل | بيئة الإنشاء لم تُتم اتصال npm ضمن المهلة؛ التثبيت يجب اختباره على Termux |
| PostgreSQL migration end-to-end داخل بيئة البناء | ⚠️ لم يُنفذ | لا يوجد PostgreSQL server في بيئة الإنشاء؛ `npm run migrate` مخصص لبيئتك بعد إعداد DB |
| Discord end-to-end الحقيقي | ⚠️ يحتاج بياناتك | لا توجد Tokens حقيقية داخل المشروع؛ `npm run doctor` و`npm run deploy` مخصصان لبيئتك |


## v1.1.3 — Server Auto Sync
- [x] استيراد الفرق تلقائيًا من Discord Roles.
- [x] ربط القناة الصوتية تلقائيًا بالاسم/التصنيف.
- [x] ربط قناة تنبيهات الفريق تلقائيًا.
- [x] مزامنة أعضاء الرتبة مع أعضاء الفريق.
- [x] مزامنة تلقائية عند تشغيل البوت.
- [x] زر مزامنة يدوي من Setup ولوحة الفرق.
- [x] منع تحويل @everyone/الرتب المدارة/رتب Administrator إلى فرق تلقائيًا.

- [x] المزامنة مع بنية Discord تعمل تلقائيًا دون زر (startup + events + periodic safety check).

## v1.1.6
- [x] عرض كل الفرق المسموح بها وكل أعضائها مباشرة بدون Select للعرض.
- [x] مزامنة كل أعضاء رتبة الفريق Online وOffline.
- [x] إزالة التباس كلمة "نشط" مع Presence.
- [x] دمج وحذف الفريق اليدوي المكرر مع الحفاظ على الاجتماعات والأعضاء والصلاحيات.
- [x] الحفاظ على Permission Scopes بعد الدمج.

- ✅ v1.11.0: قالب التقرير الرسمي مطابق لهوية 967 المرجعية (شعار + أسود/ذهبي + بيانات/ملخص/كشف/اعتذارات/تسجيل/قرارات).

## v1.1.8
- ✅ تمييز الفرق اليدوية عن فرق Discord ودمج المكرر اليدوي فقط.
- ✅ تسجيل تلقائي عند بدء الاجتماع إذا كان اتصال الصوت متاحًا.
- ✅ توليد تسجيل نهائي مختلط/مجزأ عبر FFmpeg مع fallback للمسارات الخام.
- ✅ `reports.receive` و`recordings.receive` بنطاق Global / Team / Meeting.
- ✅ الـOwner يستلم كل المخرجات تلقائيًا.
- ✅ تعيين شخص لاستلام مخرجات فريق من لوحة الصلاحيات.
- ✅ تسليم DM مع عزل كامل حسب Permission Scope.
- ✅ عدم إرسال التقرير تلقائيًا إلى قناة عامة مشتركة.
- ✅ اجتماعات متزامنة مستقلة في الحضور والتقارير والتسليم.
- ✅ منع اجتماعين جاريين على نفس القناة الصوتية.
- ⚠️ تسجيل صوتي متزامن لقناتين مختلفتين في نفس Guild يحتاج Bot Account/Voice Worker إضافي بسبب قيد Discord.

## v1.1.9
- ✅ حذف فريق من شاشة الفرق أو من شاشات اختيار الفريق الإدارية.
- ✅ تأكيد قبل الحذف.
- ✅ `teams.manage` مطلوب Server-side حسب Team Scope.
- ✅ حذف منطقي يحافظ على أرشيف الاجتماعات القديم.
- ✅ فرق Discord المحذوفة تدخل `team_sync_exclusions` ولا تعود بالمزامنة التلقائية.
- ✅ رتبة Discord والقنوات لا تُحذف من السيرفر.
- ✅ اختبارات حذف/استبعاد الفريق: 3/3 نجحت.
- ✅ إجمالي اختبارات Node الحالية: 34/34 نجحت أثناء بناء v1.1.9.


> تحديث 1.2.0: قوائم المستخدمين والرتب في الصلاحيات تُجلب من السيرفر مباشرة وتعمل من خاص البوت مع دعم الصفحات.

- [x] وصول إدارة عليا خاص لمستخدمين محددين، Owner-only grant/revoke، ولوحة كاملة مشابهة للمالك.

- [x] v1.2.2: إصلاح منح وصول الإدارة العليا من DM مع defer/fallback ورسالة خطأ واضحة.


## Audit baseline — v1.11.0

- [x] DM replies remain non-ephemeral in private chats
- [x] Production DM gate is configured-guild membership
- [x] Recording publication requires verified integrity metadata
- [x] Team-channel-only recording delivery is enforced
- [x] Failover tests tolerate source formatting whitespace
- [x] Secret-bearing `.env.*` backups excluded from source packaging
