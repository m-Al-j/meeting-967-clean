#!/data/data/com.termux/files/usr/bin/bash
set -u
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
PROJECT_DIR="${MEETING967_DIR:-$HOME_DIR/meeting-967-clean}"
HOOK="$HOME_DIR/.termux/boot/00-meeting967.sh"
OLD_HOOK="$HOME_DIR/.termux/boot/meeting967.sh"
LOG="$PROJECT_DIR/logs/boot.log"

echo "=== Meeting 967 / Boot diagnostics ==="
if [ -f "$HOOK" ]; then
  if [ -x "$HOOK" ]; then echo "✅ Boot hook موجود وقابل للتنفيذ: $HOOK"; else echo "⚠️ Boot hook موجود لكنه غير executable: $HOOK"; fi
else
  echo "❌ Boot hook غير موجود: $HOOK"
fi
[ -f "$OLD_HOOK" ] && echo "⚠️ يوجد hook قديم أيضًا: $OLD_HOOK" || true

if command -v pm >/dev/null 2>&1; then
  if pm path com.termux.boot >/dev/null 2>&1; then echo "✅ Android يرى حزمة Termux:Boot"; else echo "⚠️ لم أستطع تأكيد حزمة Termux:Boot عبر pm"; fi
fi

if [ -f "$LOG" ]; then
  echo "\n--- آخر Boot log ---"
  tail -n 80 "$LOG"
else
  echo "\n❌ لا يوجد boot.log حتى الآن."
  echo "إذا كنت أعدت تشغيل الهاتف بعد تثبيت Termux:Boot فهذا يعني غالبًا أن Android/Termux:Boot لم ينفذ الـhook أصلًا، وليس أن Node فشل بعد تشغيله."
fi

echo "\n--- حالة البوت الآن ---"
cd "$PROJECT_DIR" 2>/dev/null && bash ops/botctl.sh status || true
