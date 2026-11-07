/**
 * SACCO 2025 Daily Collections Database Importer
 *
 * Imports 2025 manifest collections and daily expenses into the live
 * SACCO PostgreSQL database (`ledger_entries`) so they are immediately visible
 * in the Daily Collections view on branch `agent/coop-bank-b2b-ipn`.
 *
 * Usage:
 *   node scripts/import-2025-daily-collections.mjs --dry-run
 *   node scripts/import-2025-daily-collections.mjs --execute
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createDatabasePool, databaseUrl as configuredDatabaseUrl } from '../database-config.mjs';

const DESKTOP_DATA_DIR = path.resolve('C:/Users/emrys/OneDrive/Desktop/sowe assets/outputs/sacco_2025_import_review_2026-11-06');
const INPUT_CSV = path.join(DESKTOP_DATA_DIR, 'ledger_import_preview_monthly_table_expenses.csv');

const isExecute = process.argv.includes('--execute');
const isDryRun = !isExecute;

async function parseCsv(filePath) {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers = null;
  const rows = [];

  for await (let line of rl) {
    if (!line.trim()) continue;
    line = line.replace(/^\uFEFF/, '');
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    const values = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function normPlate(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function main() {
  console.log('='.repeat(70));
  console.log('  SOWETAMU SACCO 2025 DAILY COLLECTIONS DATABASE IMPORTER');
  console.log('='.repeat(70));
  console.log(`Mode: ${isExecute ? 'EXECUTE (LIVE WRITE)' : 'DRY RUN (READ-ONLY PREFLIGHT)'}`);

  const dbUrl = configuredDatabaseUrl();
  if (!dbUrl) {
    console.error('\n[ERROR] DATABASE_URL is not set in .env or environment.');
    process.exit(1);
  }

  if (!fs.existsSync(INPUT_CSV)) {
    console.error(`\n[ERROR] Input payload not found at: ${INPUT_CSV}`);
    process.exit(1);
  }

  console.log(`Loading payload from: ${INPUT_CSV}`);
  const rows = await parseCsv(INPUT_CSV);
  if (!rows[0]?.entry_date) {
    throw new Error('CSV parsing error: entry_date column missing. Found keys: ' + Object.keys(rows[0] || {}).join(', '));
  }
  console.log(`Loaded ${rows.length.toLocaleString()} total transaction rows (Sample date: ${rows[0].entry_date}).`);

  const creditRows = rows.filter(r => r.transaction_type === 'Credit');
  const debitRows = rows.filter(r => r.transaction_type === 'Debit');
  const totalCreditAmount = creditRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const totalDebitAmount = debitRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  console.log(`  - Credits (Daily Vehicle Collections): ${creditRows.length.toLocaleString()} rows | KES ${totalCreditAmount.toLocaleString()}`);
  console.log(`  - Debits (Daily Route Expenses)      : ${debitRows.length.toLocaleString()} rows | KES ${totalDebitAmount.toLocaleString()}`);

  const pool = createDatabasePool();
  try {
    const client = await pool.connect();
    console.log('\n[PASS] Successfully connected to PostgreSQL database.');

    // 1. Fetch all vehicles and members for foreign key mapping
    const vehicleRes = await client.query(`
      SELECT v.id as vehicle_id, v.plate_number, v.member_id, m.full_name as member_name
      FROM vehicles v
      LEFT JOIN members m ON m.id = v.member_id
    `);
    const vehicleMap = new Map();
    for (const v of vehicleRes.rows) {
      vehicleMap.set(normPlate(v.plate_number), v);
    }
    console.log(`Loaded ${vehicleMap.size} existing registered vehicles for plate linking.`);

    // 2. Preflight: Check existing 2025 records
    const existingCheck = await client.query(
      `SELECT count(*)::int AS total,
              count(CASE WHEN transaction_type = 'Credit' THEN 1 END)::int AS credits,
              count(CASE WHEN transaction_type = 'Debit' THEN 1 END)::int AS debits
       FROM ledger_entries
       WHERE entry_date BETWEEN '2025-01-01' AND '2025-12-31'
         AND reference_code LIKE 'SWT-IMP25-%'`
    );
    const existingCount = existingCheck.rows[0].total;
    console.log(`Preflight: Existing 2025 SWT-IMP25 ledger entries found: ${existingCount}`);

    if (isDryRun) {
      console.log('\n[DRY RUN SUMMARY]');
      console.log(`  Database connection: Verified (Healthy)`);
      console.log(`  Transactions ready to insert: ${rows.length.toLocaleString()}`);
      console.log(`  Total Inflow to be recorded : KES ${totalCreditAmount.toLocaleString()}`);
      console.log(`  Total Expenses to be recorded: KES ${totalDebitAmount.toLocaleString()}`);
      console.log('\nTo execute live insertion, run:');
      console.log('  node scripts/import-2025-daily-collections.mjs --execute\n');
      client.release();
      return;
    }

    // Live Execution
    console.log('\nStarting database transaction insertion...');
    await client.query('BEGIN');

    if (existingCount > 0) {
      console.log(`Removing ${existingCount} previous import records for clean replacement...`);
      await client.query(
        `DELETE FROM ledger_entries
         WHERE entry_date BETWEEN '2025-01-01' AND '2025-12-31'
           AND reference_code LIKE 'SWT-IMP25-%'`
      );
    }

    const BATCH_SIZE = 250;
    let inserted = 0;
    const startTime = Date.now();

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const valueStrings = [];
      const params = [];
      let paramIdx = 1;

      for (const r of batch) {
        const metadata = JSON.parse(r.metadata_json || '{}');
        const plate = (r.vehicle_plate_label || '').trim();
        const norm = normPlate(plate);
        const match = vehicleMap.get(norm);

        const vehicleId = match ? match.vehicle_id : null;
        // Member ID is strictly NULL so historical 2025 records do not mutate live member financial balances
        const memberId = null;

        if (match && match.member_name && !metadata.memberName) {
          metadata.memberName = match.member_name;
        }

        metadata.entryDate = r.entry_date;
        metadata.isHistorical = true;

        valueStrings.push(
          `($${paramIdx}::date, ($${paramIdx} || ' 12:00:00+03')::timestamptz, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}::numeric, $${paramIdx+5}::uuid, $${paramIdx+6}::uuid, $${paramIdx+7}, $${paramIdx+8}, 'Manual', 'Posted', $${paramIdx+9}::jsonb)`
        );

        params.push(
          r.entry_date,
          r.transaction_type,
          r.account_type,
          r.till_type,
          r.amount,
          memberId,
          vehicleId,
          r.reference_code,
          r.description,
          JSON.stringify(metadata)
        );

        paramIdx += 10;
      }

      const queryText = `
        INSERT INTO ledger_entries (
          entry_date, entry_time, transaction_type, account_type, till_type,
          amount, member_id, vehicle_id, reference_code, description, source, status, metadata
        ) VALUES ${valueStrings.join(', ')}
      `;

      await client.query(queryText, params);
      inserted += batch.length;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\rInserted ${inserted.toLocaleString()} / ${rows.length.toLocaleString()} rows (${elapsed}s)...`);
    }

    await client.query('COMMIT');
    console.log('\n\n[SUCCESS] Transaction committed. All 2025 records successfully imported!');

    // Post-import verification
    const verifyCheck = await client.query(
      `SELECT count(*)::int AS total,
              count(CASE WHEN transaction_type = 'Credit' THEN 1 END)::int AS credits,
              sum(CASE WHEN transaction_type = 'Credit' THEN amount ELSE 0 END)::numeric AS credit_sum,
              count(CASE WHEN transaction_type = 'Debit' THEN 1 END)::int AS debits,
              sum(CASE WHEN transaction_type = 'Debit' THEN amount ELSE 0 END)::numeric AS debit_sum,
              min(entry_date) AS min_date,
              max(entry_date) AS max_date
       FROM ledger_entries
       WHERE entry_date BETWEEN '2025-01-01' AND '2025-12-31'
         AND reference_code LIKE 'SWT-IMP25-%'`
    );
    console.log('\nPost-import Database Audit Verification:');
    console.log(verifyCheck.rows[0]);

    client.release();
  } catch (err) {
    console.error('\n[ERROR] Migration failed:', err);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
