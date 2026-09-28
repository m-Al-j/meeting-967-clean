import 'dotenv/config';
import {Agent,request} from 'undici';
import {getAppEnv} from '../src/config/env.js';
import {applyDiscordNetworkFix} from '../src/infrastructure/network/discordDns.js';
import pg from 'pg';
const {Client}=pg;const env=getAppEnv();console.log('Node:',process.version);console.log('Guild:',env.GUILD_ID);console.log('Owner:',env.OWNER_USER_ID);console.log('Token length:',env.DISCORD_TOKEN.length);
const db=new Client({connectionString:env.DATABASE_URL});await db.connect();await db.query('SELECT 1');console.log('✅ PostgreSQL');await db.end();
applyDiscordNetworkFix();const agent=new Agent({connect:{family:4,timeout:20_000}});const me=await request('https://discord.com/api/v10/users/@me',{dispatcher:agent,headers:{Authorization:`Bot ${env.DISCORD_TOKEN}`}});if(me.statusCode!==200)throw new Error(`Discord token failed HTTP ${me.statusCode}`);const bot=await me.body.json();console.log(`✅ Discord Bot: ${bot.username} (${bot.id})`);if(String(bot.id)!==String(env.CLIENT_ID))console.warn('⚠️ CLIENT_ID لا يساوي Bot User/Application ID المتوقع. تأكد من Application ID.');const g=await request(`https://discord.com/api/v10/guilds/${env.GUILD_ID}`,{dispatcher:agent,headers:{Authorization:`Bot ${env.DISCORD_TOKEN}`}});if(g.statusCode!==200)throw new Error(`Bot cannot access guild HTTP ${g.statusCode}`);const guild=await g.body.json();console.log(`✅ Guild: ${guild.name}`);await agent.close();
