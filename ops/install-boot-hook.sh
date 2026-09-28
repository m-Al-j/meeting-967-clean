#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
BOOT_DIR="$HOME_DIR/.termux/boot"
HOOK="$BOOT_DIR/00-meeting967.sh"
OLD_HOOK="$BOOT_DIR/meeting967.sh"
PROJECT_DIR="$HOME_DIR/meeting-967-clean"

mkdir -p "$BOOT_DIR" "$PROJECT_DIR/logs" 2>/dev/null || true
rm -f "$OLD_HOOK" 2>/dev/null || true

cat > "$HOOK" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
# Meeting 967 robust Android boot hook.
PREFIX="/data/data/com.termux/files/usr"
HOME="/data/data/com.termux/files/home"
PATH="$PREFIX/bin:$PATH"
export PREFIX HOME PATH
PROJECT_DIR="$HOME/meeting-967-clean"
LOG_DIR="$PROJECT_DIR/logs"
BOOT_LOG="$LOG_DIR/boot.log"
mkdir -p "$LOG_DIR" "$PROJECT_DIR/.runtime" 2>/dev/null || true
exec >>"$BOOT_LOG" 2>&1

echo "============================================================"
echo "[$(date -Iseconds)] Termux:Boot hook invoked pid=$$"
echo "[$(date -Iseconds)] PATH=$PATH"

# Android may still be bringing networking/services up after BOOT_COMPLETED.
sleep 25

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock >/dev/null 2>&1 || true

if [ ! -d "$PROJECT_DIR" ]; then
  echo "[$(date -Iseconds)] ERROR project-missing: $PROJECT_DIR"
  exit 1
fi
cd "$PROJECT_DIR" || exit 1

# Retry startup because PostgreSQL/network may not be ready immediately after boot.
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  echo "[$(date -Iseconds)] startup-attempt=$attempt"
  bash ops/botctl.sh start || true
  sleep 8

  GP="$(cat .runtime/guardian.pid 2>/dev/null || true)"
  if [ -n "$GP" ] && kill -0 "$GP" 2>/dev/null; then
    echo "[$(date -Iseconds)] SUCCESS guardian-running pid=$GP"
    bash ops/botctl.sh status || true
    exit 0
  fi

  echo "[$(date -Iseconds)] guardian-not-running; retrying in 12s"
  sleep 12
done

echo "[$(date -Iseconds)] ERROR boot-start-failed-after-retries"
bash ops/botctl.sh status || true
exit 1
BOOT

chmod 700 "$HOOK"

echo "✅ تم تثبيت Boot hook المحسن: $HOOK"
echo "✅ تم حذف hook القديم إن وجد لمنع التشغيل المكرر."
echo "بعد إعادة تشغيل الهاتف افحص: npm run boot:status"
