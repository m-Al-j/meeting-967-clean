#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
APP="${MEETING967_HOME:-$HOME/meeting-967-clean}"
cd "$APP"
STOPPED=0
restart(){
  if [ "$STOPPED" -eq 1 ] && [ -f ops/botctl.sh ]; then
    echo "🚀 إعادة تشغيل البوت..."
    bash ops/botctl.sh start || true
    STOPPED=0
  fi
}
trap 'rc=$?; restart; exit $rc' ERR INT TERM

ONGOING="$(node --input-type=module <<'NODE' 2>/dev/null || true
import 'dotenv/config';import pg from 'pg';
const cs=String(process.env.DATABASE_URL??'').trim();if(!cs){console.log('unknown');process.exit()}
const db=new pg.Client({connectionString:cs});try{await db.connect();const {rows}=await db.query("SELECT count(*)::int n FROM meetings WHERE status='ongoing'");console.log(rows[0]?.n??0)}catch{console.log('unknown')}finally{await db.end().catch(()=>{})}
NODE
)"
ONGOING="$(printf '%s' "$ONGOING" | tail -n1 | tr -d '[:space:]')"
[ "$ONGOING" = "0" ] || { echo "❌ يوجد اجتماع جارٍ أو تعذر التحقق ($ONGOING). أعد المحاولة بعد انتهاء الاجتماع."; exit 20; }

if [ -f ops/botctl.sh ]; then
  echo "🛑 إيقاف البوت مؤقتًا أثناء تنظيف الرسائل القديمة..."
  bash ops/botctl.sh stop || true
  STOPPED=1
fi

set +e
RECORDING_CLEANUP_APPLY=1 node ops/consolidate-old-recordings-v1.10.10.mjs
RC=$?
set -e

restart
sleep 4
[ -f ops/botctl.sh ] && bash ops/botctl.sh status || true
exit "$RC"

