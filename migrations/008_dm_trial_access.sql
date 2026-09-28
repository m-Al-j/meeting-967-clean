INSERT INTO permissions(permission_key, description_ar) VALUES
('system.dm_trial_access','وصول خاص تجريبي — يتيح للمستخدم المحدد استخدام لوحة Meeting 967 في الخاص دون منحه صلاحيات إدارية إضافية')
ON CONFLICT(permission_key) DO UPDATE SET description_ar=EXCLUDED.description_ar;
