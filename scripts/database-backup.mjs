import 'dotenv/config';
import { spawn } from 'node:child_process';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

function connectionFrom(value, variableName) {
  if (!value) throw new Error(`${variableName} is required. Use the Supabase PostgreSQL connection string.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection string.`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error(`${variableName} must include a PostgreSQL host and database name.`);
  }
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    sslMode: url.searchParams.get('sslmode') || (process.env.DATABASE_SSL === 'true' ? 'require' : '')
  };
}

function databaseEnvironment(connection) {
  return {
    ...process.env,
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
    ...(connection.sslMode ? { PGSSLMODE: connection.sslMode } : {})
  };
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.once('error', error => reject(new Error(`${command} could not start. Install PostgreSQL client tools (pg_dump) and try again. ${error.message}`)));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code ?? 'unknown'}.`)));
  });
}

const connection = connectionFrom(process.env.DATABASE_URL, 'DATABASE_URL');
const backupDirectory = path.resolve(process.env.BACKUP_DIRECTORY || '.backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDirectory, `sacco-postgres-${timestamp}.dump`);

await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
await chmod(backupDirectory, 0o700);
await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--file=${backupPath}`], databaseEnvironment(connection));
await chmod(backupPath, 0o600);

const backup = await stat(backupPath);
const manifest = {
  createdAt: new Date().toISOString(),
  database: connection.database,
  host: connection.host,
  file: path.basename(backupPath),
  bytes: backup.size,
  format: 'pg_dump custom',
  restoreCommand: 'npm run db:restore-test'
};
await writeFile(`${backupPath}.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await chmod(`${backupPath}.json`, 0o600);
console.log(`Backup created: ${backupPath} (${backup.size.toLocaleString()} bytes)`);
console.log('Copy this encrypted backup to SACCO-controlled storage. The .backups directory is intentionally not committed to Git.');
