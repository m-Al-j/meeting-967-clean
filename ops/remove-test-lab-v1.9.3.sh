#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
VERSION="1.9.3"
APP="${MEETING967_ROOT:-$HOME/meeting-967-clean}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUNTIME="$APP/.runtime/test-lab-v${VERSION}"
BACKUP="$APP/backups/remove-test-lab-v${VERSION}-$STAMP"
cd "$APP"
say(){ printf '%s\n' "$*"; }
die(){ say "❌ $*"; exit 1; }
[ -f "$RUNTIME/unpatch.mjs" ] || die "ملف الإزالة الآمنة غير موجود."

ACTIVE="$(node --input-type=module <<'NODE' 2>/dev/null || true
import 'dotenv/config'; import {pool} from './src/infrastructure/db/pool.js'; import {getAppEnv} from './src/config/env.js';
try{const env=getAppEnv();const {rows}=await pool.query("SELECT count(*)::int n FROM meeting967_test_lab_runs WHERE guild_id=$1 AND status IN ('starting','active','ending')",[env.GUILD_ID]);console.log(rows[0]?.n??0);}catch{console.log('unknown');}finally{await pool.end().catch(()=>{});}
NODE
)"
ACTIVE="$(printf '%s' "$ACTIVE" | tail -n1 | tr -d '[:space:]')"
[ "$ACTIVE" = "0" ] || die "يوجد اختبار جارٍ أو تعذر التحقق ($ACTIVE). أنهِ التجربة أولًا."

TOUCHED=(src/app.js src/infrastructure/repositories/MeetingRepository.js src/interfaces/discord/voiceHandler.js src/interfaces/discord/interactions/misc.js src/interfaces/discord/ownerMeetingCenter.js)
NEWFILES=(src/application/services/TestLabService.js migrations/100_test_lab.sql tests/test-lab-v193.test.js ops/show-test-lab-v1.9.3.sh)
mkdir -p "$BACKUP"
for rel in "${TOUCHED[@]}" "${NEWFILES[@]}"; do [ -f "$APP/$rel" ] || continue; mkdir -p "$BACKUP/$(dirname "$rel")"; cp -p "$APP/$rel" "$BACKUP/$rel"; done

rollback(){
  say "↩️ فشل الإزالة؛ إعادة نسخة ما قبل الإزالة..."
  for rel in "${TOUCHED[@]}" "${NEWFILES[@]}"; do [ -f "$BACKUP/$rel" ] || continue; mkdir -p "$APP/$(dirname "$rel")"; cp -p "$BACKUP/$rel" "$APP/$rel"; done
  bash ops/botctl.sh start >/dev/null 2>&1 || true
}
trap 'rollback' ERR INT TERM

say "🧹 تنظيف ملفات وبيانات التجارب فقط..."
node --input-type=module <<'NODE'
import 'dotenv/config'; import fs from 'node:fs/promises'; import path from 'node:path';
import {pool} from './src/infrastructure/db/pool.js'; import {getAppEnv} from './src/config/env.js';
const env=getAppEnv();
try{
 const {rows}=await pool.query('SELECT * FROM meeting967_test_lab_runs WHERE guild_id=$1',[env.GUILD_ID]);
 for(const r of rows){
   const vals=[r.report_path];
   for(const k of ['recording_paths','recording_roots']){let v=r[k]; if(typeof v==='string'){try{v=JSON.parse(v)}catch{v=[]}} if(Array.isArray(v))vals.push(...v);}
   for(const x of vals.filter(Boolean)){const target=path.resolve(String(x)); const root=path.resolve(env.STORAGE_DIR); if(target===root||target.startsWith(root+path.sep))await fs.rm(target,{recursive:true,force:true}).catch(()=>{});}
 }
 await pool.query("DELETE FROM meetings WHERE guild_id=$1 AND COALESCE(is_test,false)=true",[env.GUILD_ID]);
 await pool.query('DELETE FROM meeting967_test_lab_runs WHERE guild_id=$1',[env.GUILD_ID]);
 await pool.query('DELETE FROM meeting967_test_lab_settings WHERE guild_id=$1',[env.GUILD_ID]);
 console.log(`✅ تم تنظيف ${rows.length} تجربة.`);
}finally{await pool.end().catch(()=>{});}
NODE

say "🛑 إيقاف البوت..."
bash ops/botctl.sh stop >/dev/null 2>&1 || true
node "$RUNTIME/unpatch.mjs" "$APP"
rm -f "$APP/src/application/services/TestLabService.js" "$APP/migrations/100_test_lab.sql" "$APP/tests/test-lab-v193.test.js" "$APP/ops/show-test-lab-v1.9.3.sh"

npm run lint
for rel in "${TOUCHED[@]}"; do node --check "$APP/$rel" >/dev/null; done
trap - ERR INT TERM
bash ops/botctl.sh start
sleep 4
bash ops/botctl.sh status || true
rm -rf "$RUNTIME" 2>/dev/null || true
say "✅ تمت إزالة مختبر التجارب نهائيًا من الكود والواجهة."
say "ℹ️ جداول/أعمدة PostgreSQL التي سبق إنشاؤها تبقى خاملة فقط ولا تؤثر على البوت."
rm -f "$APP/ops/remove-test-lab-v1.9.3.sh" 2>/dev/null || true
