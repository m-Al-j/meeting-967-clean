import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { getAppEnv } from '../src/config/env.js';
import { commandJSON } from '../src/infrastructure/discord/commandDefinitions.js';

const env = getAppEnv();
const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
const guildRoute = Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID);
const globalRoute = Routes.applicationCommands(env.CLIENT_ID);

const deployed = await rest.put(guildRoute, { body: commandJSON });
const deployedNames = new Set(Array.isArray(deployed) ? deployed.map((command) => command.name) : []);
const missing = commandJSON.map((command) => command.name).filter((name) => !deployedNames.has(name));
if (missing.length) throw new Error(`Discord did not confirm guild commands: ${missing.join(', ')}`);

console.log(`✅ تم نشر ${commandJSON.length} أوامر داخل سيرفر ${env.GUILD_ID}: /${commandJSON.map((command) => command.name).join('، /')}`);

try {
  await rest.put(globalRoute, { body: commandJSON });
  console.log('✅ تم نشر أوامر الخاص/العامة بنجاح.');
} catch (error) {
  console.warn(`⚠️ أوامر السيرفر تعمل، لكن تعذر تنظيف الأوامر العامة القديمة: ${error?.message || error}`);
}

console.log('👤 /panel متاح للجميع، ومحتواه يُبنى حسب صلاحيات الشخص ويظهر له بصورة خاصة.');
