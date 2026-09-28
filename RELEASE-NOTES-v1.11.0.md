# Meeting 967 v1.11.0 — Recording Continuity & Publication Hard Gate

## Recording contract
- The meeting is not published from raw recording tracks.
- Every recording session for the meeting remains part of the final timeline.
- Worker → Main failover uses make-before-break where possible.
- Final mixing must produce exactly one final file covering the verified meeting timeline.
- Delivery is allowed only when the final recording is `completed`, has exactly one `final_path`, and has `integrityGuardVersion=1.10.11` with `integrityStatus=verified`.
- Manual-recovery and legacy recordings cannot bypass the publication gate.
- If integrity verification or final mixing fails, the recording stays blocked and is retried/recovered instead of being published as complete.

## Validation
- JavaScript syntax checks passed for RecordingService, DeliveryService, OutputReliabilityService, and MeetingService.
- Recording/delivery hardening tests executed: 8 passed, 0 failed.

## Audit refresh — 2026-09-25
- تم توحيد اختبارات الـDM مع بوابة عضوية سيرفر 967 الإنتاجية.
- تم إصلاح ردود DM hard-coded `ephemeral:true` في Owner Access Center.
- تم تحديث fixtures الخاصة بالتسجيل لتطابق publication hard gate الحالي.
- تم تحديث اختبارات failover وواجهة Components V2 بعد انتقال الواجهة إلى الإصدار الحالي.
- تم تحديث اعتماد `jszip` ليكون صريحًا ضمن devDependencies لأن الاختبارات تستورده مباشرة.
- تم منع ملفات `.env.*` الاحتياطية من دخول المستودع، مع استثناء ملفات الأمثلة فقط.
- فحص lint الحالي: **168 ملف JavaScript**.
- نتائج الاختبارات في بيئة التدقيق: **59 ملف اختبار نجح**، و**3 ملفات لم تُشغّل كاملًا بسبب تثبيت dependencies غير مكتمل في بيئة التدقيق** (`docx`، `@discordjs/voice`، `jszip`).
