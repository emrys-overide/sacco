import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createDatabasePool } from '../database-config.mjs';

const DATA_DIR = path.resolve('C:/Users/emrys/OneDrive/Desktop/sowe assets/outputs/sacco_2025_import_review_2026-11-06');
const DAYS_CSV = path.join(DATA_DIR, 'daily_reconciliation_preview.csv');
const VEHICLES_CSV = path.join(DATA_DIR, 'vehicle_collection_rows.csv');
const EXPENSES_CSV = path.join(DATA_DIR, 'expense_rows.csv');

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

async function main() {
  console.log('='.repeat(70));
  console.log('  SEEDING ISOLATED 2025 HISTORICAL MANIFEST TABLES');
  console.log('='.repeat(70));

  const pool = createDatabasePool();
  try {
    const client = await pool.connect();
    console.log('[PASS] Connected to PostgreSQL.');

    // 1. Load data
    console.log('Reading source CSVs from sowe assets review output...');
    const dayRows = await parseCsv(DAYS_CSV);
    const vehicleRows = await parseCsv(VEHICLES_CSV);
    const expenseRows = await parseCsv(EXPENSES_CSV);

    console.log(`Loaded ${dayRows.length} day records, ${vehicleRows.length} vehicle rows, ${expenseRows.length} expense rows.`);

    await client.query('BEGIN');

    // Clean existing historical manifest tables for clean reload
    console.log('Truncating historical_manifest_* tables...');
    await client.query(`TRUNCATE TABLE historical_manifest_days CASCADE`);

    // 2. Insert days
    console.log('Inserting 365 historical days...');
    for (const d of dayRows) {
      const gross = Number(d.gross || 0);
      const exp = Number(d.expenses || 0);
      const net = gross - exp;
      await client.query(
        `INSERT INTO historical_manifest_days (
           record_date, nissan_total, sienta_total, gross_total, total_expenses, net_vault_inflow
         ) VALUES ($1::date, $2::numeric, $3::numeric, $4::numeric, $5::numeric, $6::numeric)`,
        [d.date, d.nissan || 0, d.sienta || 0, gross, exp, net]
      );
    }

    // 3. Insert vehicle rows in batches of 250
    console.log('Inserting vehicle manifest entries...');
    const BATCH_SIZE = 250;
    for (let i = 0; i < vehicleRows.length; i += BATCH_SIZE) {
      const batch = vehicleRows.slice(i, i + BATCH_SIZE);
      const valueStrings = [];
      const params = [];
      let pIdx = 1;

      for (const v of batch) {
        valueStrings.push(
          `($${pIdx}::date, $${pIdx+1}, $${pIdx+2}::int, $${pIdx+3}, $${pIdx+4}::numeric, $${pIdx+5}::numeric, $${pIdx+6}::numeric, $${pIdx+7}::numeric, $${pIdx+8}::numeric, $${pIdx+9}::numeric, $${pIdx+10}::numeric)`
        );
        params.push(
          v.date,
          v.fleet,
          Number(v.row_no || 0),
          (v.plate || '').trim(),
          Number(v.operation || 0),
          Number(v.entrance || 0),
          Number(v.loan_repay || 0),
          Number(v.savings || 0),
          Number(v.s_ticket || 0),
          Number(v.legal_fee || 0),
          Number(v.gross_amount || 0)
        );
        pIdx += 11;
      }

      await client.query(
        `INSERT INTO historical_manifest_entries (
           record_date, fleet, row_no, plate_number,
           operation, entrance, loan_repay, savings, s_ticket, legal_fee, total_amount
         ) VALUES ${valueStrings.join(', ')}`,
        params
      );
    }

    // 4. Insert expense rows in batches of 250
    console.log('Inserting expense lines...');
    for (let i = 0; i < expenseRows.length; i += BATCH_SIZE) {
      const batch = expenseRows.slice(i, i + BATCH_SIZE);
      const valueStrings = [];
      const params = [];
      let pIdx = 1;

      for (const e of batch) {
        valueStrings.push(
          `($${pIdx}::date, $${pIdx+1}::int, $${pIdx+2}, $${pIdx+3}::numeric)`
        );
        params.push(
          e.date,
          Number(e.item_no || 0),
          (e.description || '').trim(),
          Number(e.amount || 0)
        );
        pIdx += 4;
      }

      await client.query(
        `INSERT INTO historical_manifest_expenses (
           record_date, item_no, description, amount
         ) VALUES ${valueStrings.join(', ')}`,
        params
      );
    }

    await client.query('COMMIT');
    console.log('[SUCCESS] Historical manifest tables populated and committed.');

    // Verification
    const countDays = await client.query('SELECT count(*)::int as count FROM historical_manifest_days');
    const countEntries = await client.query('SELECT count(*)::int as count FROM historical_manifest_entries');
    const countExpenses = await client.query('SELECT count(*)::int as count FROM historical_manifest_expenses');
    const countLedger = await client.query('SELECT count(*)::int as count FROM ledger_entries');

    console.log('\nAudit Verification:');
    console.log(`  historical_manifest_days    : ${countDays.rows[0].count} days`);
    console.log(`  historical_manifest_entries : ${countEntries.rows[0].count} vehicle rows`);
    console.log(`  historical_manifest_expenses: ${countExpenses.rows[0].count} expense rows`);
    console.log(`  ledger_entries (UNTOUCHED)  : ${countLedger.rows[0].count} records (0% interaction)`);

    client.release();
  } catch (err) {
    console.error('[ERROR]', err);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
