#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

echo "== Meeting 967 / تثبيت Termux =="
pkg update -y
pkg install -y git postgresql ffmpeg curl procps
pkg install -y nodejs-lts || pkg install -y nodejs

if [ ! -f .env ]; then
  cp .env.example .env
  echo "تم إنشاء .env. عدّل القيم أولًا: nano .env"
  echo "ثم أعد تشغيل: bash install-termux.sh"
  exit 0
fi

npm install
npm run migrate
npm run seed
npm run lint
npm test
npm run doctor
npm run deploy

echo "✅ التثبيت والفحص انتهى. للتشغيل الدائم: npm run managed:start"
