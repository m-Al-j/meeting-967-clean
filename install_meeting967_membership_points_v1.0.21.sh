#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$HOME/meeting-967-clean"
VERSION="1.0.21"
STAMP="$(date +%Y%m%d-%H%M%S)"
SERVICE="$ROOT/src/application/services/MembershipRoleService.js"
BACKUP_DIR="$ROOT/backups/membership-points-v${VERSION}-${STAMP}"
BACKUP="$BACKUP_DIR/MembershipRoleService.before-v${VERSION}.js"
TMP="${PREFIX:-/data/data/com.termux/files/usr}/tmp/meeting967-membership-v${VERSION}-${STAMP}"
STAGED="$TMP/MembershipRoleService.js"

say(){ printf '%s\n' "$*"; }

rollback(){
  code=$?
  if [ "$code" -ne 0 ]; then
    say ""
    say "❌ التعديل لم يكتمل"
    if [ -f "$BACKUP" ]; then
      cp -f "$BACKUP" "$SERVICE" || true
      say "↩️ تم استرجاع النسخة الاحتياطية"
    fi
  fi
  rm -rf "$TMP" 2>/dev/null || true
  exit "$code"
}
trap rollback EXIT

say "============================================================"
say " Meeting 967 — Membership Points v1.0.21"
say " إصلاح تذبذب رتب العضوية والمكافآت"
say "============================================================"

[ -d "$ROOT" ] || { say "❌ المشروع غير موجود: $ROOT"; exit 1; }
[ -f "$SERVICE" ] || { say "❌ الملف غير موجود: $SERVICE"; exit 1; }

mkdir -p "$BACKUP_DIR" "$TMP"
cp -f "$SERVICE" "$BACKUP"
cp -f "$SERVICE" "$STAGED"

python - "$STAGED" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
src = path.read_text()

old = """  async applyRoleKey(member, roleMap, roleKey) {
    const target = roleMap[roleKey];
    if (!target) return false;

    await this.removeManagedMembershipRoles(member, roleMap);

    if (!member.roles.cache.has(String(target.id))) {
      await member.roles.add(
        String(target.id),
        'Meeting 967 — Monthly membership status'
      ).catch(() => null);
    }

    return true;
  }"""

new = """  async applyRoleKey(member, roleMap, roleKey) {
    const target = roleMap[roleKey];
    if (!target || !member || member.user?.bot) return false;

    const targetId = String(target.id);

    // لا نسحب الرتبة المطلوبة ثم نعيدها.
    // نزيل فقط رتب العضوية الأخرى، ونضيف الهدف إذا لم يكن موجودًا.
    for (const role of Object.values(roleMap)) {
      if (!role?.id) continue;

      const roleId = String(role.id);
      if (roleId === targetId) continue;

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(
          roleId,
          'Meeting 967 — Monthly membership replacement'
        ).catch(() => null);
      }
    }

    // الرتبة المطلوبة موجودة بالفعل: لا نرسل طلب Discord جديد.
    if (member.roles.cache.has(targetId)) {
      return true;
    }

    await member.roles.add(
      targetId,
      'Meeting 967 — Monthly membership status'
    ).catch(() => null);

    return true;
  }"""

if old not in src:
    raise SystemExit("لم أجد applyRoleKey المتوقع — أوقف التثبيت بدون تغيير المصدر.")

src = src.replace(old, new, 1)
path.write_text(src)
print("✅ applyRoleKey patched")
PY

say "🧪 فحص JavaScript..."
node --check "$STAGED"

say "🧪 التحقق من السلوك الجديد..."
grep -n -A32 -B2 "async applyRoleKey" "$STAGED"

if grep -A18 -B1 "async applyRoleKey" "$STAGED" | grep -q "removeManagedMembershipRoles(member, roleMap)"; then
  say "❌ ما زال الاستدعاء القديم موجودًا"
  exit 1
fi

say "📦 تطبيق الملف..."
cp -f "$STAGED" "$SERVICE"

say "✅ فحص المصدر بعد التطبيق..."
node --check "$SERVICE"

say "♻️ إعادة تشغيل البوت..."
if npm run managed:restart; then
  :
elif [ -x "$ROOT/ops/botctl.sh" ]; then
  bash "$ROOT/ops/botctl.sh start"
else
  say "❌ تعذر إعادة التشغيل تلقائيًا"
  exit 1
fi

say ""
say "============================================================"
say " ✅ Membership Points v1.0.21 تم تطبيقه"
say "============================================================"
say "• العضو العادي لن تُسحب رتبته ثم تُعاد في كل مزامنة"
say "• رتبة المكافأة الحالية لن تُسحب ثم تُعاد إذا كانت موجودة"
say "• عند تغيير الرتبة فقط يتم إزالة الرتب الأخرى وإضافة الرتبة الجديدة"
say "• تم إنشاء نسخة احتياطية قبل التعديل:"
say "$BACKUP"
