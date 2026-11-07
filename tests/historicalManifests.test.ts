import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('historical manifests and replica verification', async (t) => {
  const manifestPath = path.resolve('database/replica/sacco_replica_manifest.json');
  const replicaExists = fs.existsSync(manifestPath);

  await t.test('replica manifest exists with all 34 replicated tables', { skip: !replicaExists }, () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.equal(manifest.totalTables, 34);
    assert.ok(manifest.tables.historical_manifest_days, 'Must include historical_manifest_days');
    assert.ok(manifest.tables.historical_manifest_entries, 'Must include historical_manifest_entries');
    assert.ok(manifest.tables.historical_manifest_expenses, 'Must include historical_manifest_expenses');
    assert.ok(manifest.tables.ledger_entries, 'Must include ledger_entries');

    assert.equal(manifest.tables.historical_manifest_days.rowCount, 365);
    assert.equal(manifest.tables.historical_manifest_entries.rowCount, 26087);
    assert.equal(manifest.tables.historical_manifest_expenses.rowCount, 1538);
    assert.equal(manifest.tables.ledger_entries.rowCount, 3421);
  });

  await t.test('live ledger entries remain 100% isolated (0 historical records in active ledger)', { skip: !replicaExists }, () => {
    const ledgerData = JSON.parse(fs.readFileSync(path.resolve('database/replica/data/ledger_entries.json'), 'utf8'));
    assert.equal(ledgerData.length, 3421, 'Active operational ledger must stay at exactly 3,421 entries');

    const historicalInLedger = ledgerData.filter((r: any) => 
      (r.reference_number && r.reference_number.startsWith('SWT-IMP25-')) ||
      (r.reference && r.reference.startsWith('SWT-IMP25-'))
    );
    assert.equal(historicalInLedger.length, 0, 'Zero 2025 records inside ledger_entries');
  });

  await t.test('historical manifest day records have valid totals and net vault inflow', { skip: !replicaExists }, () => {
    const daysData = JSON.parse(fs.readFileSync(path.resolve('database/replica/data/historical_manifest_days.json'), 'utf8'));
    assert.equal(daysData.length, 365);

    for (const day of daysData.slice(0, 10)) {
      const gross = Number(day.gross_total);
      const exp = Number(day.total_expenses);
      const net = Number(day.net_vault_inflow);
      assert.equal(net, gross - exp, `Net vault inflow must equal gross minus expenses for ${day.record_date}`);
    }
  });

  await t.test('historical manifest vehicle entries sum correctly', { skip: !replicaExists }, () => {
    const entriesData = JSON.parse(fs.readFileSync(path.resolve('database/replica/data/historical_manifest_entries.json'), 'utf8'));
    assert.equal(entriesData.length, 26087);

    for (const r of entriesData.slice(0, 50)) {
      const computedTotal = Number(r.operation || 0) +
        Number(r.entrance || 0) +
        Number(r.loan_repay || 0) +
        Number(r.savings || 0) +
        Number(r.s_ticket || 0) +
        Number(r.legal_fee || 0);
      assert.equal(Number(r.total_amount), computedTotal, `Total must match sum of individual line fees for row ${r.id}`);
    }
  });
});
