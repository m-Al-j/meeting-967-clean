import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  InteractionContextType
} from 'discord.js';

const panel = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('فتح لوحتك الشخصية حسب صلاحياتك في Meeting 967')
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM
  );

const setup = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('إعداد Meeting 967 — للمالك والإدارة فقط')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM
  );

const health = new SlashCommandBuilder()
  .setName('health')
  .setDescription('فحص حالة Meeting 967 — للإدارة فقط')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM
  );


const ai = new SlashCommandBuilder()
  .setName('ai')
  .setDescription('اسأل مساعد 967 عن المبادرة أو لوحتك الشخصية')
  .addStringOption(option => option
    .setName('question')
    .setDescription('اكتب سؤالك')
    .setRequired(true)
    .setMaxLength(1200))
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM
  );

export const commandBuilders = [panel, setup, health , ai];
export const commandJSON = commandBuilders.map((command) => command.toJSON());
