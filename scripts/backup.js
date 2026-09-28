import 'dotenv/config';
import {buildApp} from '../src/app.js';
const app=buildApp();
try{const b=await app.backupService.create({guildId:app.env.GUILD_ID,actorId:app.env.OWNER_USER_ID});console.log(`✅ ${b.path} (${b.size_bytes} bytes)`);}finally{await app.db.end();}
