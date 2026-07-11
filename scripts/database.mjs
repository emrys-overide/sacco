import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

const CONTAINER_NAME = 'matatu-sacco-postgres';
const IMAGE = process.env.POSTGRES_IMAGE || 'postgres:18-alpine';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing. Configure it in .env before running database commands.');
}

const connection = new URL(databaseUrl);
const database = connection.pathname.replace(/^\//, '');
const username = decodeURIComponent(connection.username);
const password = decodeURIComponent(connection.password);

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: options.quiet ? 'pipe' : 'inherit',
    env: { ...process.env, POSTGRES_PASSWORD: password }
  });
  if (result.error) throw result.error;
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`docker ${args[0]} failed with exit code ${result.status}`);
  }
  return result;
}

function inspectContainer() {
  const result = docker(['inspect', '--format', '{{.State.Running}}', CONTAINER_NAME], {
    quiet: true,
    allowFailure: true
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() === 'true';
}

async function waitForDatabase(pool) {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${lastError?.message || 'unknown error'}`);
}

async function migrate(pool) {
  const migrationsDirectory = path.resolve('database/migrations');
  const files = (await readdir(migrationsDirectory))
    .filter(file => /^\d+.*\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const version = file.match(/^(\d+)/)?.[1];
    if (!version) continue;

    const tableExists = await pool.query("SELECT to_regclass('public.schema_migrations') AS table_name");
    if (tableExists.rows[0]?.table_name) {
      const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (applied.rowCount) {
        console.log(`Migration ${file}: already applied`);
        continue;
      }
    }

    const sql = await readFile(path.join(migrationsDirectory, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version, name)
         VALUES ($1, $2)
         ON CONFLICT (version) DO NOTHING`,
        [version, file.replace(/^\d+_?/, '').replace(/\.sql$/, '')]
      );
      await client.query('COMMIT');
      console.log(`Migration ${file}: applied`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function withPool(action) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await waitForDatabase(pool);
    await action(pool);
  } finally {
    await pool.end();
  }
}

async function up() {
  const running = inspectContainer();
  if (running === null) {
    docker([
      'run', '-d',
      '--name', CONTAINER_NAME,
      '--restart', 'unless-stopped',
      '-e', `POSTGRES_USER=${username}`,
      '-e', 'POSTGRES_PASSWORD',
      '-e', `POSTGRES_DB=${database}`,
      '-p', `${connection.hostname}:${connection.port || '5432'}:5432`,
      '-v', 'matatu-sacco-postgres-18-data:/var/lib/postgresql',
      IMAGE
    ]);
  } else if (!running) {
    docker(['start', CONTAINER_NAME]);
  }

  await withPool(async pool => {
    await migrate(pool);
    const result = await pool.query(
      'SELECT current_database() AS database, current_user AS username, version() AS version'
    );
    console.log(`Database ready: ${result.rows[0].database} as ${result.rows[0].username}`);
  });
}

async function status() {
  const running = inspectContainer();
  console.log(`Container: ${running === null ? 'not created' : running ? 'running' : 'stopped'}`);
  if (!running) return;
  await withPool(async pool => {
    const migrations = await pool.query('SELECT version, name, applied_at FROM schema_migrations ORDER BY version');
    console.table(migrations.rows);
  });
}

const command = process.argv[2] || 'status';
if (command === 'up') {
  await up();
} else if (command === 'migrate') {
  await withPool(migrate);
} else if (command === 'status') {
  await status();
} else if (command === 'down') {
  const running = inspectContainer();
  if (running) docker(['stop', CONTAINER_NAME]);
  console.log('Database container stopped. The Docker volume was preserved.');
} else {
  throw new Error(`Unknown database command: ${command}`);
}
