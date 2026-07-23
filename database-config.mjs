import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

export function databaseUrl(env = process.env) {
  return String(env.DATABASE_URL || '').trim();
}

function databaseSsl(env = process.env) {
  const url = databaseUrl(env);
  const sslMode = url ? new URL(url).searchParams.get('sslmode') : null;
  if (sslMode === 'verify-full') {
    const caPath = String(env.DATABASE_CA_CERT_PATH || '').trim();
    if (!caPath) throw new Error('DATABASE_CA_CERT_PATH is required when sslmode=verify-full.');
    return { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') };
  }
  if (env.DATABASE_SSL === 'true' || sslMode === 'require') return { rejectUnauthorized: false };
  return undefined;
}

export function createDatabasePool(env = process.env) {
  const connectionString = databaseUrl(env);
  if (!connectionString) return null;
  return new Pool({
    connectionString,
    ssl: databaseSsl(env),
    max: Number(env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: Number(env.DATABASE_IDLE_TIMEOUT_MS || 30_000),
    connectionTimeoutMillis: Number(env.DATABASE_CONNECT_TIMEOUT_MS || 10_000)
  });
}
