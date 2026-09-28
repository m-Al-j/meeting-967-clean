#!/data/data/com.termux/files/usr/bin/bash
set -u
shopt -s nullglob
files=(tests/*.test.js)
if [ ${#files[@]} -eq 0 ]; then
  echo "No tests found"
  exit 1
fi
pass=0
for f in "${files[@]}"; do
  echo "▶ $f"
  ok=0
  for attempt in 1 2; do
    if node --test "$f"; then ok=1; break; fi
    if [ "$attempt" -eq 1 ]; then
      echo "⚠️ retrying $f once (Termux/Node test-runner can occasionally fail IPC deserialization)" >&2
      sleep 1
    fi
  done
  if [ "$ok" -ne 1 ]; then
    echo "❌ test failed twice: $f" >&2
    exit 1
  fi
  pass=$((pass+1))
done
echo "✅ safe test runner: ${pass}/${#files[@]} test files passed"
