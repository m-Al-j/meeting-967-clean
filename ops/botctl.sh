#!/data/data/com.termux/files/usr/bin/bash
set -u
PROJECT_DIR="${MEETING967_DIR:-$HOME/meeting-967-clean}"
RUNTIME="$PROJECT_DIR/.runtime"
LOGDIR="$PROJECT_DIR/logs"
GUARDIAN_PID="$RUNTIME/guardian.pid"
NODE_PID="$RUNTIME/node.pid"
LOG_FILE="$LOGDIR/meeting967.log"
mkdir -p "$RUNTIME" "$LOGDIR"

alive(){ [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
readpid(){ [ -f "$1" ] && cat "$1" 2>/dev/null || true; }

start(){
  local gp
  gp=$(readpid "$GUARDIAN_PID")
  if alive "$gp"; then echo "🟢 Meeting 967 guardian شغال (PID $gp)"; status; return 0; fi
  rm -f "$GUARDIAN_PID" "$NODE_PID"
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock >/dev/null 2>&1 || true
  cd "$PROJECT_DIR" || { echo "❌ المشروع غير موجود: $PROJECT_DIR"; exit 1; }
  nohup bash ops/guardian.sh >/dev/null 2>&1 </dev/null &
  echo $! > "$GUARDIAN_PID"
  sleep 2
  gp=$(readpid "$GUARDIAN_PID")
  if alive "$gp"; then echo "✅ الحارس الدائم بدأ (PID $gp)"; else echo "❌ فشل تشغيل الحارس. نفذ: bash ops/botctl.sh logs"; exit 1; fi
  status
}

stop(){
  local gp np i
  gp=$(readpid "$GUARDIAN_PID")
  np=$(readpid "$NODE_PID")

  # Stop the guardian first. Production guardian forwards TERM to Node and
  # will not restart it while Node finishes reports/audio/FFmpeg cleanup.
  alive "$gp" && kill -TERM "$gp" 2>/dev/null || true
  if ! alive "$gp" && alive "$np"; then kill -TERM "$np" 2>/dev/null || true; fi

  for i in $(seq 1 75); do
    gp=$(readpid "$GUARDIAN_PID")
    np=$(readpid "$NODE_PID")
    if ! alive "$gp" && ! alive "$np"; then break; fi
    # If guardian has already gone but Node is still alive, make sure Node saw TERM.
    if ! alive "$gp" && alive "$np" && [ "$i" -eq 3 ]; then kill -TERM "$np" 2>/dev/null || true; fi
    sleep 1
  done

  gp=$(readpid "$GUARDIAN_PID")
  np=$(readpid "$NODE_PID")
  if alive "$np"; then
    echo "⚠️ Node لم يغلق بعد مهلة الإغلاق الآمن؛ سيتم إيقافه بالقوة."
    kill -KILL "$np" 2>/dev/null || true
  fi
  if alive "$gp"; then
    echo "⚠️ Guardian لم يغلق بعد المهلة؛ سيتم إيقافه بالقوة."
    kill -KILL "$gp" 2>/dev/null || true
  fi

  rm -f "$GUARDIAN_PID" "$NODE_PID"
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock >/dev/null 2>&1 || true
  echo "⏹️ Meeting 967 توقف"
}

status(){
  local gp np hb state
  gp=$(readpid "$GUARDIAN_PID"); np=$(readpid "$NODE_PID")
  state=$(cat "$RUNTIME/guardian-state.txt" 2>/dev/null || echo unknown)
  if alive "$gp"; then echo "🛡️ Guardian: شغال (PID $gp)"; else echo "🔴 Guardian: متوقف"; fi
  if alive "$np"; then echo "🤖 Bot process: شغال (PID $np)"; else echo "🔴 Bot process: متوقف/يعاد تشغيله"; fi
  if [ -f "$RUNTIME/heartbeat.json" ]; then
    if command -v node >/dev/null 2>&1; then
      node - "$RUNTIME/heartbeat.json" "$state" <<'JS'
import fs from 'node:fs';
const p=process.argv[2];
const guardianState=process.argv[3]||'unknown';
try{
  const h=JSON.parse(fs.readFileSync(p,'utf8'));
  const age=Math.floor((Date.now()-new Date(h.ts).getTime())/1000);
  const healthy=h.state==='online' && age>=0 && age<=90;
  console.log(`📍 Guardian state: ${healthy?'healthy':guardianState}`);
  console.log(`💓 Discord: ${h.state} | heartbeat age ${age}s | ping ${h.pingMs ?? '-'}ms | uptime ${h.uptimeSeconds ?? '-'}s`);
}catch{
  console.log(`📍 Guardian state: ${guardianState}`);
  console.log('💓 Heartbeat: غير قابل للقراءة');
}
JS
    else
      echo "📍 Guardian state: $state"
      echo "💓 Heartbeat موجود: $RUNTIME/heartbeat.json"
    fi
  else
    echo "📍 Guardian state: $state"
    echo "💓 Heartbeat: لم يُنشأ بعد"
  fi
  command -v pg_isready >/dev/null 2>&1 && (pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && echo "🐘 PostgreSQL: جاهز" || echo "🔴 PostgreSQL: غير جاهز")
  echo "📄 Logs: $LOG_FILE"
}

logs(){ touch "$LOG_FILE"; tail -n 120 "$LOG_FILE"; }
case "${1:-status}" in
 start) start;;
 stop) stop;;
 restart) stop; start;;
 status) status;;
 logs) logs;;
 follow) touch "$LOG_FILE"; tail -f "$LOG_FILE";;
 *) echo "usage: $0 {start|stop|restart|status|logs|follow}"; exit 2;;
esac
