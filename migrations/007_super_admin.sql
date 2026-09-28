INSERT INTO permissions(permission_key, description_ar) VALUES
('system.super_admin','وصول الإدارة العليا — جميع الصلاحيات التشغيلية ولوحة كاملة مشابهة للمالك')
ON CONFLICT(permission_key) DO UPDATE SET description_ar=EXCLUDED.description_ar;
