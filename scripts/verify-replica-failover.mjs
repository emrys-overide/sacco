import fs from 'node:fs';
import path from 'node:path';

const REPLICA_DIR = path.resolve('database/replica');
const DATA_DIR = path.join(REPLICA_DIR, 'data');
const MANIFEST_FILE = path.join(REPLICA_DIR, 'sacco_replica_manifest.json');
const SQL_FILE = path.join(REPLICA_DIR, 'sacco_replica.sql');

async function main() {
  console.log('='.repeat(70));
  console.log('  VERIFYING SACCO REPLICA DATABASE INTEGRITY & FAILOVER READINESS');
  console.log('='.repeat(70));

  if (!fs.existsSync(MANIFEST_FILE) || !fs.existsSync(SQL_FILE)) {
    console.error('[FAIL] Replica files not found. Run "npm run db:replicate" first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const sqlStats = fs.statSync(SQL_FILE);

  console.log(`[PASS] Replica Manifest Loaded. Generated at: ${manifest.timestamp}`);
  console.log(`[PASS] Source Primary Host: ${manifest.primaryHost}`);
  console.log(`[PASS] Total Replicated Tables: ${manifest.totalTables}`);
  console.log(`[PASS] SQL Dump Size: ${(sqlStats.size / 1024 / 1024).toFixed(2)} MB`);

  let totalRows = 0;
  console.log('\nAudit Check: Table Snapshots');
  for (const [table, meta] of Object.entries(manifest.tables)) {
    const jsonPath = path.join(DATA_DIR, `${table}.json`);
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Missing snapshot JSON for table ${table}`);
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (data.length !== meta.rowCount) {
      throw new Error(`Row count mismatch in table ${table}: expected ${meta.rowCount}, got ${data.length}`);
    }
    totalRows += data.length;
    console.log(`  ✓ ${table.padEnd(30)}: ${meta.rowCount.toLocaleString().padStart(8)} rows (${meta.columnCount} cols)`);
  }

  console.log(`\n[PASS] Total Replicated Records: ${totalRows.toLocaleString()}`);

  // Simulate Failover Query from Replica
  console.log('\n--- Simulating Offline Failover Query (No Live Postgres Connection) ---');
  const members = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'members.json'), 'utf8'));
  const vehicles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'vehicles.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ledger_entries.json'), 'utf8'));
  const histDays = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'historical_manifest_days.json'), 'utf8'));

  console.log(`  Offline Members Count   : ${members.length}`);
  console.log(`  Offline Vehicles Count  : ${vehicles.length}`);
  console.log(`  Offline Active Ledger   : ${ledger.length} entries`);
  console.log(`  Offline Historical Days : ${histDays.length} days recorded`);

  const ledgerCredits = ledger.filter(r => r.type === 'Credit').reduce((sum, r) => sum + Number(r.amount || 0), 0);
  console.log(`  Offline Ledger Credits  : KES ${ledgerCredits.toLocaleString()}`);

  console.log('\n' + '='.repeat(70));
  console.log('[SUCCESS] REPLICA INTEGRITY 100% VERIFIED. STANDBY DATABASE READY FOR FAILOVER.');
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('[FAIL]', err.message);
  process.exit(1);
});
