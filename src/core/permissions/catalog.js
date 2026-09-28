export const SUPER_ADMIN_PERMISSION = 'system.super_admin';
export const DM_TRIAL_PERMISSION = 'system.dm_trial_access';

export const PERMISSIONS = Object.freeze([
  'meetings.view','meetings.create','meetings.edit','meetings.cancel','meetings.start','meetings.end','meetings.lead',
  'attendance.view','attendance.edit',
  'excuses.view','excuses.approve','excuses.reject',
  'recordings.view','recordings.manage','recordings.receive',
  'reports.view','reports.generate','reports.download','reports.receive',
  'tasks.view','tasks.manage','tasks.review','performance.view',
  'operations.view','decisions.view','decisions.manage','workflows.view','workflows.manage',
  'teams.view','teams.manage','members.view','members.view_sensitive','members.manage',
  'permissions.manage','audit.view','backups.manage','settings.manage'
]);

// الصلاحيات الخاصة لا تظهر ضمن منح الصلاحيات العادي ولا تُمنح لرتبة/فريق.
export const ALL_PERMISSIONS = Object.freeze([...PERMISSIONS, SUPER_ADMIN_PERMISSION, DM_TRIAL_PERMISSION]);
export const ADMIN_BUNDLE = Object.freeze(PERMISSIONS.filter((p) => p !== 'permissions.manage'));
export const SCOPE_RANK = Object.freeze({ global: 1, team: 2, meeting: 3 });

export const PERMISSION_CATEGORIES = Object.freeze({
  meetings:{label:'الاجتماعات',emoji:'🗓️',description:'عرض الاجتماعات وجدولتها وتعديلها وتشغيلها وإنهاؤها وقيادتها.'},
  attendance:{label:'الحضور',emoji:'✅',description:'عرض الحضور والغياب والتأخير وتعديل السجلات عند الحاجة.'},
  excuses:{label:'الاعتذارات',emoji:'📨',description:'عرض الاعتذارات ومراجعتها واعتمادها أو رفضها.'},
  recordings:{label:'التسجيلات',emoji:'🎙️',description:'عرض التسجيلات وإدارتها وتحديد من يستلمها.'},
  reports:{label:'التقارير',emoji:'📄',description:'عرض التقارير وتوليدها وتنزيلها وتحديد مستلميها.'},
  tasks:{label:'المهام والأداء',emoji:'📋',description:'عرض المهام وإدارتها ومراجعتها والاطلاع على تقييم الأداء.'},
  operations:{label:'القيادة والقرارات والمسارات',emoji:'🏛️',description:'مركز القيادة، سجل القرارات والالتزامات، ومسارات العمل المؤسسية.'},
  teams:{label:'الفرق والأعضاء',emoji:'👥',description:'عرض الفرق وإدارتها وإدارة أعضاء الفرق.'},
  governance:{label:'الإدارة والحوكمة',emoji:'🛡️',description:'إدارة الصلاحيات وسجل التدقيق والنسخ الاحتياطي وإعدادات النظام.'},
});

export const PERMISSION_METADATA = Object.freeze({
  'meetings.view':{label:'عرض الاجتماعات',category:'meetings',description:'يسمح بعرض الاجتماعات التي يشملها النطاق: المجدولة والجارية والسابقة.',risk:'منخفضة'},
  'meetings.create':{label:'إنشاء وجدولة الاجتماعات',category:'meetings',description:'يسمح بإنشاء اجتماع جديد وتحديد الفريق والموعد والإعدادات الأساسية.',risk:'متوسطة'},
  'meetings.edit':{label:'تعديل الاجتماعات',category:'meetings',description:'يسمح بتعديل بيانات الاجتماع وموعده وإعداداته قبل أو أثناء دورة الاجتماع حسب النظام.',risk:'عالية'},
  'meetings.cancel':{label:'إلغاء الاجتماعات',category:'meetings',description:'يسمح بإلغاء اجتماع قائم وتسجيل الإلغاء في النظام.',risk:'عالية'},
  'meetings.start':{label:'بدء الاجتماعات',category:'meetings',description:'يسمح ببدء الاجتماع يدويًا عندما يكون البدء اليدوي متاحًا.',risk:'عالية'},
  'meetings.end':{label:'إنهاء الاجتماعات',category:'meetings',description:'يسمح بإنهاء الاجتماع يدويًا وإغلاق دورته التشغيلية.',risk:'عالية'},
  'meetings.lead':{label:'قيادة الاجتماع والمهام الحية',category:'meetings',description:'يسمح بإدارة المهام والقرارات الحية المرتبطة بالاجتماع أثناء انعقاده.',risk:'عالية'},

  'attendance.view':{label:'عرض الحضور',category:'attendance',description:'يسمح بعرض الحضور والغياب والتأخير ومدد المشاركة في الاجتماعات التي يشملها النطاق.',risk:'منخفضة'},
  'attendance.edit':{label:'تعديل الحضور',category:'attendance',description:'يسمح بتعديل أو تصحيح سجلات الحضور يدويًا، لذلك يجب منحه بحذر.',risk:'عالية'},

  'excuses.view':{label:'عرض الاعتذارات',category:'excuses',description:'يسمح بعرض الاعتذارات المرتبطة بالاجتماعات ضمن النطاق.',risk:'منخفضة'},
  'excuses.approve':{label:'اعتماد الاعتذارات',category:'excuses',description:'يسمح بالموافقة على اعتذار عضو واحتسابه كاعتذار معتمد.',risk:'متوسطة'},
  'excuses.reject':{label:'رفض الاعتذارات',category:'excuses',description:'يسمح برفض الاعتذارات المقدمة للأعضاء ضمن النطاق.',risk:'متوسطة'},

  'recordings.view':{label:'عرض التسجيلات',category:'recordings',description:'يسمح بالوصول إلى معلومات وملفات التسجيلات التي يسمح بها النطاق.',risk:'متوسطة'},
  'recordings.manage':{label:'إدارة التسجيلات',category:'recordings',description:'يسمح بإدارة عمليات التسجيل وملفاته وإجراءات المعالجة المتاحة داخل النظام.',risk:'عالية'},
  'recordings.receive':{label:'وصول التسجيلات (توافقي)',category:'recordings',description:'صلاحية توافقية للوصول إلى حالة التسجيلات ضمن النطاق؛ لا ترسل التسجيل في الخاص. التسجيل يُنشر في قناة الفريق فقط.',risk:'متوسطة'},

  'reports.view':{label:'عرض التقارير',category:'reports',description:'يسمح بعرض تقارير الاجتماعات ضمن النطاق.',risk:'منخفضة'},
  'reports.generate':{label:'توليد التقارير',category:'reports',description:'يسمح بإعادة إنشاء أو توليد التقرير الرسمي للاجتماع.',risk:'متوسطة'},
  'reports.download':{label:'تنزيل التقارير',category:'reports',description:'يسمح بتنزيل أو الحصول على ملف التقرير عندما يكون متاحًا.',risk:'متوسطة'},
  'reports.receive':{label:'وصول التقارير (توافقي)',category:'reports',description:'صلاحية توافقية للوصول إلى حالة التقارير ضمن النطاق؛ لا ترسل التقرير في الخاص. التقرير يُنشر في قناة الفريق فقط.',risk:'متوسطة'},

  'tasks.view':{label:'عرض المهام',category:'tasks',description:'يسمح بعرض مهام الاجتماعات والتكليفات ضمن النطاق.',risk:'منخفضة'},
  'tasks.manage':{label:'إدارة المهام',category:'tasks',description:'يسمح بإنشاء وتعديل وإدارة التكليفات المرتبطة بالعمل والاجتماعات.',risk:'عالية'},
  'tasks.review':{label:'مراجعة المهام',category:'tasks',description:'يسمح بمراجعة تسليمات المهام واعتماد حالتها أو تقييمها حسب مسار النظام.',risk:'متوسطة'},
  'performance.view':{label:'عرض تقييم الأداء',category:'tasks',description:'يسمح بالاطلاع على مؤشرات وتقييم أداء الأعضاء المتاحة داخل النظام.',risk:'متوسطة'},

  'operations.view':{label:'عرض مركز القيادة',category:'operations',description:'يسمح بفتح مركز القيادة ورؤية المؤشرات التشغيلية والتنبيهات المجمعة للمبادرة.',risk:'متوسطة'},
  'decisions.view':{label:'عرض سجل القرارات',category:'operations',description:'يسمح بعرض القرارات المؤسسية المرتبطة بالاجتماعات ومسؤولها وموعدها وحالة تنفيذها.',risk:'متوسطة'},
  'decisions.manage':{label:'إدارة القرارات والالتزامات',category:'operations',description:'يسمح بتعيين مسؤول القرار وموعده وأولويته وتغيير حالته وإرفاق دليل التنفيذ.',risk:'عالية'},
  'workflows.view':{label:'عرض مسارات العمل',category:'operations',description:'يسمح بعرض مسارات العمل المؤسسية النشطة والمكتملة وخطواتها الحالية.',risk:'متوسطة'},
  'workflows.manage':{label:'إدارة مسارات العمل',category:'operations',description:'يسمح ببدء مسار عمل وتعيين المسؤول والموعد والتقدم بين الخطوات وتعطيل المسار أو استئنافه.',risk:'عالية'},

  'teams.view':{label:'عرض الفرق',category:'teams',description:'يسمح بعرض الفرق وأعضاء الفريق والمعلومات التنظيمية المتاحة.',risk:'منخفضة'},
  'teams.manage':{label:'إدارة الفرق',category:'teams',description:'يسمح بإنشاء وتعديل وربط وإدارة الفرق، لذلك يعد من الصلاحيات الحساسة.',risk:'عالية'},
  'members.manage':{label:'إدارة الأعضاء',category:'teams',description:'يسمح بإدارة عضوية الأشخاص داخل الفرق وتحديث ارتباطاتهم التنظيمية.',risk:'عالية'},
  'members.view':{label:'عرض الأعضاء',category:'teams',description:'يسمح بعرض بيانات الأعضاء الأساسية ضمن النطاق الممنوح فقط.',risk:'منخفضة'},
  'members.view_sensitive':{label:'عرض البيانات الحساسة للأعضاء',category:'teams',description:'يسمح بعرض بيانات عضوية حساسة مثل الحالة والنقاط ضمن النطاق الممنوح.',risk:'عالية'},

  'permissions.manage':{label:'إدارة الصلاحيات',category:'governance',description:'يسمح بمنح وسحب الصلاحيات للمستخدمين والرتب والفرق. من أخطر صلاحيات النظام.',risk:'حرجة'},
  'audit.view':{label:'عرض سجل التدقيق',category:'governance',description:'يسمح بعرض سجل الإجراءات الإدارية: من نفذ ماذا ومتى وعلى أي عنصر.',risk:'متوسطة'},
  'backups.manage':{label:'إدارة النسخ الاحتياطي',category:'governance',description:'يسمح بإدارة النسخ الاحتياطية وعمليات الاستعادة المتاحة. صلاحية شديدة الحساسية.',risk:'حرجة'},
  'settings.manage':{label:'إدارة إعدادات النظام',category:'governance',description:'يسمح بتغيير إعدادات النظام والأتمتة والسلوك التشغيلي العام.',risk:'حرجة'},

  [SUPER_ADMIN_PERMISSION]:{label:'وصول الإدارة العليا',category:'special',description:'وصول خاص يمنح مستخدمًا محددًا جميع أدوات الإدارة التشغيلية تقريبًا. لا يحوله إلى Owner ولا يغير OWNER_USER_ID.',risk:'حرجة'},
  [DM_TRIAL_PERMISSION]:{label:'وصول الخاص التجريبي',category:'special',description:'يسمح لمستخدم محدد بفتح تفاعلات Meeting 967 في الخاص خلال التجربة دون منحه صلاحيات إدارية إضافية.',risk:'خاصة'},
});

export const PERMISSION_LABELS = Object.freeze(Object.fromEntries(
  Object.entries(PERMISSION_METADATA).map(([key,meta])=>[key,meta.label])
));

export function permissionMeta(key){
  return PERMISSION_METADATA[key]??{label:key,category:'other',description:'لا يوجد وصف عربي مسجل لهذه الصلاحية.',risk:'غير محددة'};
}
export function permissionLabel(key){return permissionMeta(key).label;}
export function permissionDescription(key){return permissionMeta(key).description;}
export function permissionsInCategory(category){return PERMISSIONS.filter((key)=>permissionMeta(key).category===category);}
