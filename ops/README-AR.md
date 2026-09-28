# Meeting 967 - التشغيل الدائم على Termux

الأوامر:

- `npm run managed:start` تشغيل البوت بالحارس.
- `npm run managed:status` معرفة حالة الحارس والبوت وPostgreSQL وHeartbeat.
- `npm run managed:restart` إعادة تشغيل منظمة.
- `npm run managed:logs` آخر السجلات.
- `bash ops/botctl.sh follow` متابعة السجل مباشرة.
- `bash ops/install-boot-hook.sh` تجهيز التشغيل بعد إعادة تشغيل الهاتف (يتطلب Termux:Boot).

الحارس يعيد تشغيل Node تلقائيًا إذا خرج أو فشل تسجيل الدخول، ويحاول تشغيل PostgreSQL إذا كان متوقفًا، ويستخدم wakelock عند توفره. Android ما يزال قادرًا على قتل تطبيق Termux بالكامل إذا كان تقييد البطارية مفعّلًا، لذلك يجب جعل بطارية Termux "Unrestricted/غير مقيد". للاستضافة الحرجة 24/7 يوصى بسيرفر/VPS بدل الهاتف.

## v1.2.4: الإقلاع ورسائل الخاص
- ملف الإقلاع أصبح `~/.termux/boot/00-meeting967.sh` مع سجل مستقل في `logs/boot.log` وإعادات محاولة بعد الإقلاع.
- الأمر `npm run boot:status` يوضح هل Termux:Boot نفّذ الـhook فعلًا.
- ردود لوحة التحكم داخل DM أصبحت رسائل عادية محفوظة في المحادثة. داخل قنوات السيرفر تبقى Ephemeral لحماية الخصوصية.
