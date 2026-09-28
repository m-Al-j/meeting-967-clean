import { Client, GatewayIntentBits, Partials, ActivityType } from 'discord.js';
import { Agent } from 'undici';
import { applyDiscordNetworkFix } from '../network/discordDns.js';
export function createDiscordClient(){applyDiscordNetworkFix();const agent=new Agent({connect:{family:4,timeout:30_000}});return new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.DirectMessages],partials:[Partials.Channel],rest:{agent,timeout:30_000,retries:5},presence:{status:'online',activities:[{name:'اجتماعات 967',type:ActivityType.Watching}]}});}
