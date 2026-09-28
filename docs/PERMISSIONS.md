# Permission System

مصادر الصلاحية:

1. `OWNER_USER_ID`: سماح كامل افتراضي لا يعتمد على Rows في قاعدة البيانات، لذلك لا يمكن لمسؤول عادي إزالة صلاحيات الـOwner.
2. UserPermission.
3. RolePermission لرتب Discord.
4. TeamPermission لكل أعضاء فريق معين.

النطاقات:

- `global`: على كل النظام.
- `team`: فقط عندما يطابق `scope_id` الفريق الحالي.
- `meeting`: فقط عندما يطابق `scope_id` الاجتماع الحالي.

الحل النهائي:

- يتم جمع المنح التي تنطبق على المستخدم.
- يتم اختيار **أكثر نطاق تحديدًا**: Meeting ثم Team ثم Global.
- عند التعادل في نفس النطاق، `deny` يفوز على `allow`.
- الـOwner مسموح دائمًا.

هذه القاعدة مطبقة في `src/core/permissions/PermissionResolver.js` ومختبرة في `tests/permission-*.test.js`.
