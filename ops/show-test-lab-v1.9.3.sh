#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
APP="${MEETING967_ROOT:-$HOME/meeting-967-clean}"
cd "$APP"
node --input-type=module <<'NODE'
import 'dotenv/config';
import {pool} from './src/infrastructure/db/pool.js';
import {getAppEnv} from './src/config/env.js';
const env=getAppEnv();
try{
  await pool.query(`INSERT INTO meeting967_test_lab_settings(guild_id,visible,updated_at)
    VALUES($1,true,now()) ON CONFLICT(guild_id) DO UPDATE SET visible=true,updated_at=now()`,[env.GUILD_ID]);
  console.log('✅ عاد خيار التجارب إلى لوحة المالك.');
}finally{await pool.end().catch(()=>{});}
NODE
