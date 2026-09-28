#!/data/data/com.termux/files/usr/bin/bash
set -u

PROJECT_DIR="${MEETING967_DIR:-$HOME/meeting-967-clean}"
RUNTIME="$PROJECT_DIR/.runtime"
LOGDIR="$PROJECT_DIR/logs"
mkdir -p "$RUNTIME" "$LOGDIR"
GUARDIAN_PID="$RUNTIME/guardian.pid"
NODE_PID="$RUNTIME/node.pid"
STATE_FILE="$RUNTIME/guardian-state.txt"
LOG_FILE="$LOGDIR/meeting967.log"
MAX_LOG_BYTES=$((15*1024*1024))
STOP_REQUESTED=0
CHILD=""

alive(){ [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

rotate_log(){
  if [ -f "$LOG_FILE" ]; then
    size=$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "${size:-0}" -gt "$MAX_LOG_BYTES" ]; then
      mv -f "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
      : > "$LOG_FILE"
    fi
  fi
}

ensure_postgres(){
  if command -v pg_isready >/dev/null 2>&1 && pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then return 0; fi
  if command -v pg_ctl >/dev/null 2>&1 && [ -n "${PREFIX:-}" ] && [ -d "$PREFIX/var/lib/postgresql" ]; then
    pg_ctl -D "$PREFIX/var/lib/postgresql" -l "$LOGDIR/postgresql.log" start >>"$LOG_FILE" 2>&1 || true
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$STOP_REQUESTED" -eq 1 ] && return 1
    command -v pg_isready >/dev/null 2>&1 && pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

interruptible_sleep(){
  local seconds="${1:-1}" i
  for ((i=0;i<seconds;i++)); do
    [ "$STOP_REQUESTED" -eq 1 ] && return 0
    sleep 1
  done
}

request_stop(){
  STOP_REQUESTED=1
  echo "stopping" > "$STATE_FILE" 2>/dev/null || true
  echo "[$(date -Iseconds)] guardian-stop-request" >> "$LOG_FILE" 2>/dev/null || true
  if alive "$CHILD"; then kill -TERM "$CHILD" 2>/dev/null || true; fi
}

cleanup(){
  rm -f "$NODE_PID"
  if [ -f "$GUARDIAN_PID" ] && [ "$(cat "$GUARDIAN_PID" 2>/dev/null || true)" = "$$" ]; then rm -f "$GUARDIAN_PID"; fi
  echo "stopped" > "$STATE_FILE" 2>/dev/null || true
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock >/dev/null 2>&1 || true
}

trap request_stop TERM INT
trap cleanup EXIT

echo $$ > "$GUARDIAN_PID"
cd "$PROJECT_DIR" || exit 70
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock >/dev/null 2>&1 || true

echo "[$(date -Iseconds)] guardian-start pid=$$" >> "$LOG_FILE"
BACKOFF=3
while [ "$STOP_REQUESTED" -eq 0 ]; do
  rotate_log
  if ! ensure_postgres; then
    [ "$STOP_REQUESTED" -eq 1 ] && break
    echo "[$(date -Iseconds)] postgres-not-ready; retrying in 10s" >> "$LOG_FILE"
    echo "postgres-wait" > "$STATE_FILE"
    interruptible_sleep 10
    continue
  fi

  [ "$STOP_REQUESTED" -eq 1 ] && break
  echo "starting" > "$STATE_FILE"
  echo "[$(date -Iseconds)] bot-start" >> "$LOG_FILE"
  node src/index.js >> "$LOG_FILE" 2>&1 &
  CHILD=$!
  echo "$CHILD" > "$NODE_PID"

  wait "$CHILD"
  CODE=$?
  rm -f "$NODE_PID"
  CHILD=""

  if [ "$STOP_REQUESTED" -eq 1 ]; then
    echo "[$(date -Iseconds)] bot-exit-during-stop code=$CODE" >> "$LOG_FILE"
    break
  fi

  echo "[$(date -Iseconds)] bot-exit code=$CODE" >> "$LOG_FILE"
  echo "restarting:$CODE" > "$STATE_FILE"
  if [ "$CODE" -eq 0 ]; then BACKOFF=3; else BACKOFF=$((BACKOFF<60 ? BACKOFF*2 : 60)); fi
  interruptible_sleep "$BACKOFF"
done

exit 0
