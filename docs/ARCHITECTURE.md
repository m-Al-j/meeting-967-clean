# Architecture — Meeting 967

المشروع مقسّم إلى طبقات بدل وضع المنطق داخل `index.js`:

- `core/`: قواعد المجال التي لا تعتمد على Discord أو PostgreSQL، مثل انتقالات الاجتماعات وحل الصلاحيات.
- `application/services/`: Use Cases وخدمات التطبيق: الاجتماعات، الحضور، الاعتذارات، التقارير، التسجيل، النسخ الاحتياطي.
- `infrastructure/`: PostgreSQL repositories، Discord Client، وإصلاح الشبكة الخاص بـTermux.
- `interfaces/discord/`: أوامر `/setup` و`/panel` و`/health`، والـButtons/Selects/Modals والـVoice events.
- `migrations/`: مخطط قاعدة البيانات وإصداراته.
- `tests/`: اختبارات القواعد الأساسية بدون الحاجة للاتصال بـDiscord.

## قرار قاعدة البيانات

استخدم PostgreSQL مع حزمة `pg` لأنها لا تتطلب Native addon في Node، وتدعم العلاقات والـconstraints والـindexes المطلوبة. على Termux يمكن تشغيل PostgreSQL محليًا، أو استخدام قاعدة PostgreSQL خارجية من خلال `DATABASE_URL`.

## مبدأ الصلاحيات

إخفاء الأزرار UI فقط لتحسين التجربة. كل handler يعيد التحقق من الصلاحية في الخادم قبل أي كتابة أو قراءة حساسة.

## Atomicity

العمليات التي تحتاج أكثر من تحديث تستخدم transaction، خصوصًا بدء/إنهاء الاجتماعات والاعتذارات وتعديلات الحضور.
