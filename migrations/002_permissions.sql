INSERT INTO permissions(permission_key, description_ar) VALUES
('meetings.view','عرض الاجتماعات'),('meetings.create','إنشاء الاجتماعات'),('meetings.edit','تعديل الاجتماعات'),('meetings.cancel','إلغاء الاجتماعات'),('meetings.start','بدء الاجتماعات'),('meetings.end','إنهاء الاجتماعات'),
('attendance.view','عرض الحضور'),('attendance.edit','تعديل الحضور'),
('excuses.view','عرض الاعتذارات'),('excuses.approve','اعتماد الاعتذارات'),('excuses.reject','رفض الاعتذارات'),
('recordings.view','عرض التسجيلات'),('recordings.manage','إدارة التسجيلات'),
('reports.view','عرض التقارير'),('reports.generate','إنشاء التقارير'),('reports.download','تنزيل التقارير'),
('teams.view','عرض الفرق'),('teams.manage','إدارة الفرق'),('members.manage','إدارة الأعضاء'),
('permissions.manage','إدارة الصلاحيات'),('audit.view','عرض سجل التدقيق'),('backups.manage','إدارة النسخ الاحتياطي'),('settings.manage','إدارة الإعدادات')
ON CONFLICT(permission_key) DO NOTHING;
