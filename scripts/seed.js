import 'dotenv/config';
import { pool } from '../src/infrastructure/db/pool.js';
import { ALL_PERMISSIONS } from '../src/core/permissions/catalog.js';
for (const key of ALL_PERMISSIONS) await pool.query('INSERT INTO permissions(permission_key, description_ar) VALUES($1,$2) ON CONFLICT DO NOTHING', [key, key]);
console.log(`✅ permissions: ${ALL_PERMISSIONS.length}`);
await pool.end();
