import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { getDatabaseUrl } from '../src/config/env.js';
const { Client } = pg;
const client = new Client({ connectionString: getDatabaseUrl() });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = (await fs.readdir(path.resolve('migrations'))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await client.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [file]);
    if (done.rowCount) { console.log(`↪ ${file} already applied`); continue; }
    const sql = await fs.readFile(path.resolve('migrations', file), 'utf8');
    await client.query('BEGIN');
    try { await client.query(sql); await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [file]); await client.query('COMMIT'); console.log(`✅ ${file}`); }
    catch (e) { await client.query('ROLLBACK'); throw e; }
  }
} finally { await client.end(); }
