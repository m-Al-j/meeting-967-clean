import 'dotenv/config';
import { z } from 'zod';

const id = z.string().regex(/^\d{15,22}$/, 'يجب أن يكون Discord ID صالحًا');

export function getDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL غير موجود في .env');
  return value;
}

export function getAppEnv() {
  const schema = z.object({
    DISCORD_TOKEN: z.string().min(30),
    CLIENT_ID: id,
    GUILD_ID: id,
    OWNER_USER_ID: id,
    DATABASE_URL: z.string().min(10),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    STORAGE_DIR: z.string().default('./storage')
  });
  return schema.parse({
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    OWNER_USER_ID: process.env.OWNER_USER_ID,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    STORAGE_DIR: process.env.STORAGE_DIR
  });
}
