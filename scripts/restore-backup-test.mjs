import 'dotenv/config';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

function connectionFrom(value, variableName) {
  if (!value) throw new Error(`${variableName} is required. Use a disposable Supabase test-project connection string.`);
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
    child.once('error', error => reject(new Error(`${command} could not start. Install PostgreSQL client tools (pg_restore) and try again. ${error.message}`)));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code ?? 'unknown'}.`)));
  });
}

if (process.env.CONFIRM_RESTORE_TO_NON_PRODUCTION !== 'RESTORE_TEST') {
  throw new Error('Refusing to restore. Set CONFIRM_RESTORE_TO_NON_PRODUCTION=RESTORE_TEST after verifying the target is disposable.');
}
if (!/test|staging|restore|drill/i.test(String(process.env.RESTORE_TARGET_LABEL || ''))) {
  throw new Error('Refusing to restore. Set RESTORE_TARGET_LABEL to a value such as restore-drill after verifying the target is non-production.');
}

const backupFile = path.resolve(String(process.env.BACKUP_FILE || ''));
if (!process.env.BACKUP_FILE || path.extname(backupFile) !== '.dump') {
  throw new Error('BACKUP_FILE must point to a .dump file created by npm run db:backup.');
}
const backup = await stat(backupFile).catch(() => null);
if (!backup?.isFile() || backup.size === 0) throw new Error('BACKUP_FILE does not exist or is empty.');

const target = connectionFrom(process.env.RESTORE_DATABASE_URL, 'RESTORE_DATABASE_URL');
const source = process.env.DATABASE_URL ? connectionFrom(process.env.DATABASE_URL, 'DATABASE_URL') : null;
if (source && source.host === target.host && source.port === target.port && source.database === target.database) {
  throw new Error('Refusing to restore over DATABASE_URL. RESTORE_DATABASE_URL must point to a separate, disposable database.');
}

console.log(`Restoring ${path.basename(backupFile)} into the labelled non-production target: ${process.env.RESTORE_TARGET_LABEL}`);
await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${target.database}`, backupFile], databaseEnvironment(target));
console.log('Restore rehearsal completed. Sign in to the disposable target and run the critical workflow checks before deleting it.');
