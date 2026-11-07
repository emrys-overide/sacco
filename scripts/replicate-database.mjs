import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createDatabasePool } from '../database-config.mjs';

const REPLICA_DIR = path.resolve('database/replica');
const DATA_DIR = path.join(REPLICA_DIR, 'data');

async function main() {
  console.log('='.repeat(70));
  console.log('  SACCO DATABASE REPLICA ENGINE (CRASH & DISASTER RECOVERY)');
  console.log('='.repeat(70));

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const pool = createDatabasePool();
  if (!pool) {
    console.error('[ERROR] Unable to create database pool. DATABASE_URL is missing.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    console.log('[PASS] Connected to Primary PostgreSQL Database.');

    // 1. Discover all application tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
    `);

    const tableNames = tablesRes.rows.map(r => r.table_name);
    console.log(`[INFO] Found ${tableNames.length} tables to replicate: ${tableNames.join(', ')}`);

    const replicaManifest = {
      timestamp: new Date().toISOString(),
      primaryHost: new URL(process.env.DATABASE_URL).hostname,
      totalTables: tableNames.length,
      tables: {}
    };

    let sqlDump = `-- SACCO STANDBY REPLICA SQL DUMP\n-- Generated at: ${new Date().toISOString()}\n-- Source: ${replicaManifest.primaryHost}\n\n`;

    // 2. Extract column definitions & dump rows table by table
    for (const table of tableNames) {
      console.log(`\nReplicating table [${table}]...`);

      // Get columns
      const colsRes = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position ASC
      `, [table]);

      const columns = colsRes.rows.map(c => c.column_name);

      // Fetch all rows
      const dataRes = await client.query(`SELECT * FROM "${table}"`);
      const rowCount = dataRes.rowCount || 0;

      replicaManifest.tables[table] = {
        rowCount,
        columnCount: columns.length,
        columns
      };

      console.log(`  -> Extracted ${rowCount.toLocaleString()} rows (${columns.length} columns)`);

      // Write JSON snapshot for table
      const jsonFile = path.join(DATA_DIR, `${table}.json`);
      fs.writeFileSync(jsonFile, JSON.stringify(dataRes.rows, null, 2), 'utf8');

      // Generate SQL CREATE TABLE & INSERT statements
      const colDefs = colsRes.rows.map(c => {
        let type = c.data_type.toUpperCase();
        if (type.includes('USER-DEFINED')) type = 'TEXT';
        if (type.includes('TIMESTAMP')) type = 'TIMESTAMP';
        if (type.includes('CHARACTER VARYING')) type = 'VARCHAR';
        return `"${c.column_name}" ${type}`;
      }).join(',\n  ');

      sqlDump += `\n-- ------------------------------------------------------------\n`;
      sqlDump += `-- Table: ${table}\n`;
      sqlDump += `-- ------------------------------------------------------------\n`;
      sqlDump += `CREATE TABLE IF NOT EXISTS "${table}" (\n  ${colDefs}\n);\n`;

      if (rowCount > 0) {
        // Write batch inserts
        for (let i = 0; i < dataRes.rows.length; i += 200) {
          const slice = dataRes.rows.slice(i, i + 200);
          const valueLines = slice.map(row => {
            const vals = columns.map(col => {
              const val = row[col];
              if (val === null || val === undefined) return 'NULL';
              if (typeof val === 'number') return Number.isFinite(val) ? val : 'NULL';
              if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
              if (val instanceof Date) return `'${val.toISOString()}'`;
              if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
              return `'${String(val).replace(/'/g, "''")}'`;
            });
            return `(${vals.join(', ')})`;
          });

          sqlDump += `INSERT INTO "${table}" ("${columns.join('", "')}") VALUES\n${valueLines.join(',\n')};\n`;
        }
      }
    }

    // Write full replica SQL file
    const sqlFile = path.join(REPLICA_DIR, 'sacco_replica.sql');
    fs.writeFileSync(sqlFile, sqlDump, 'utf8');

    // Write replica manifest
    const manifestFile = path.join(REPLICA_DIR, 'sacco_replica_manifest.json');
    fs.writeFileSync(manifestFile, JSON.stringify(replicaManifest, null, 2), 'utf8');

    console.log('\n' + '='.repeat(70));
    console.log('[SUCCESS] REPLICA CREATION COMPLETE');
    console.log(`  SQL Dump: ${sqlFile} (${(fs.statSync(sqlFile).size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  Manifest: ${manifestFile}`);
    console.log(`  Data Snapshots: ${DATA_DIR} (${tableNames.length} JSON files)`);
    console.log('='.repeat(70));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
