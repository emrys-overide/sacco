
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const payloadPath = "C:\\Users\\emrys\\OneDrive\\Desktop\\sowe assets\\outputs\\supabase_sync_payload.json";
const daysData = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('Connecting to Supabase PostgreSQL...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const dates = Object.keys(daysData).sort();
    console.log(`Synchronizing ${dates.length} days (from ${dates[0]} to ${dates[dates.length - 1]})...`);
    
    // Batch upsert days
    for (const [dateStr, day] of Object.entries(daysData)) {
      const nTotal = day.nissan_total || 0;
      const sTotal = day.sienta_total || 0;
      const gross = nTotal + sTotal;
      const expTotal = (day.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);
      const netVault = gross - expTotal;
      
      await client.query(`
        INSERT INTO historical_manifest_days (
          record_date, nissan_total, sienta_total, gross_total, total_expenses, net_vault_inflow
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (record_date) DO UPDATE SET
          nissan_total = EXCLUDED.nissan_total,
          sienta_total = EXCLUDED.sienta_total,
          gross_total = EXCLUDED.gross_total,
          total_expenses = EXCLUDED.total_expenses,
          net_vault_inflow = EXCLUDED.net_vault_inflow
      `, [dateStr, nTotal, sTotal, gross, expTotal, netVault]);
    }
    
    // Delete existing entries for these dates
    await client.query(`DELETE FROM historical_manifest_entries WHERE record_date >= $1 AND record_date <= $2`, [dates[0], dates[dates.length - 1]]);
    await client.query(`DELETE FROM historical_manifest_expenses WHERE record_date >= $1 AND record_date <= $2`, [dates[0], dates[dates.length - 1]]);
    
    // Flatten entries and expenses for multi-row chunks
    const allEntries = [];
    const allExpenses = [];
    
    for (const [dateStr, day] of Object.entries(daysData)) {
      for (const r of (day.nissan || [])) {
        allEntries.push([dateStr, 'Nissan', r.row_no, r.plate || 'UNKNOWN', r.operation || 0, r.entrance || 0, r.loan || 0, r.savings || 0, r.s_ticket || 0, r.legal || 0, r.total_declared || 0]);
      }
      for (const r of (day.sienta || [])) {
        allEntries.push([dateStr, 'Sienta', r.row_no, r.plate || 'UNKNOWN', r.operation || 0, r.entrance || 0, r.loan || 0, r.savings || 0, r.s_ticket || 0, r.legal || 0, r.total_declared || 0]);
      }
      for (const exp of (day.expenses || [])) {
        allExpenses.push([dateStr, exp.item_no || 1, exp.description || 'General Expense', exp.amount || 0]);
      }
    }
    
    console.log(`Inserting ${allEntries.length} entries in chunks...`);
    const CHUNK_SIZE = 400;
    for (let i = 0; i < allEntries.length; i += CHUNK_SIZE) {
      const chunk = allEntries.slice(i, i + CHUNK_SIZE);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;
      
      for (const row of chunk) {
        placeholders.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9}, $${paramIdx+10})`);
        values.push(...row);
        paramIdx += 11;
      }
      
      const query = `
        INSERT INTO historical_manifest_entries (
          record_date, fleet, row_no, plate_number, operation, entrance,
          loan_repay, savings, s_ticket, legal_fee, total_amount
        ) VALUES ${placeholders.join(', ')}
      `;
      await client.query(query, values);
    }
    
    console.log(`Inserting ${allExpenses.length} expense items in chunks...`);
    for (let i = 0; i < allExpenses.length; i += CHUNK_SIZE) {
      const chunk = allExpenses.slice(i, i + CHUNK_SIZE);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;
      
      for (const row of chunk) {
        placeholders.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3})`);
        values.push(...row);
        paramIdx += 4;
      }
      
      const query = `
        INSERT INTO historical_manifest_expenses (
          record_date, item_no, description, amount
        ) VALUES ${placeholders.join(', ')}
      `;
      await client.query(query, values);
    }
    
    await client.query('COMMIT');
    console.log(`Supabase batch sync SUCCESS: ${dates.length} days, ${allEntries.length} entries, ${allExpenses.length} expenses.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Batch sync failed, rolled back:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
