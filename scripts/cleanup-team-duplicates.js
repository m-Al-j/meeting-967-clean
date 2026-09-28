import 'dotenv/config';
import {buildApp} from '../src/app.js';
const app=buildApp();
try{
  const merged=await app.teamService.cleanupLinkedDuplicates({guildId:app.env.GUILD_ID,actorId:app.env.OWNER_USER_ID});
  console.log(`✅ duplicate teams merged: ${merged}`);
}finally{await app.db.end();}
