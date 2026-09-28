import pg from 'pg';
import { getDatabaseUrl } from '../../config/env.js';
const { Pool } = pg;
export const pool = new Pool({ connectionString: getDatabaseUrl(), max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
export async function withTransaction(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
