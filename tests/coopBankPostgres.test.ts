import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PersistenceError, reconcilePostgresCoopBankEvent } from '../src/server/postgresStore';

const enabled = process.env.RUN_POSTGRES_INTEGRATION === 'true' && Boolean(process.env.DATABASE_URL);

test('atomically reconciles one PostgreSQL bank event and rejects a second posting', { skip: !enabled }, async t => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const memberId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let eventId: string = crypto.randomUUID();
  const transactionId = `TEST-COOP-${crypto.randomUUID()}`;
  const correlationId = crypto.randomUUID();
  t.after(async () => {
    await pool.query('DELETE FROM coop_bank_ipn_events WHERE transaction_id = $1', [transactionId]);
    await pool.query('DELETE FROM ledger_entries WHERE reference_code = $1', [transactionId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM members WHERE id = $1', [memberId]);
    await pool.end();
  });

  await pool.query(
    `INSERT INTO members (id, full_name, member_number, national_id, phone, email, status)
     VALUES ($1, 'Integration Member', $2, $3, '0712340000', $4, 'Active')`,
    [memberId, `IT-${memberId.slice(0, 8)}`, memberId.replace(/-/g, '').slice(0, 12), `${memberId}@example.test`]
  );
  await pool.query(
    `INSERT INTO users (id, full_name, email, role, is_active, account_status)
     VALUES ($1, 'Integration Chairman', $2, 'Chairman', TRUE, 'Active')`,
    [userId, `${userId}@example.test`]
  );

  const insertion = (candidateId: string) => pool.query(
    `INSERT INTO coop_bank_ipn_events (
       id, provider, transaction_id, idempotency_key, account_number, amount,
       currency, event_type, narration, status, authentication_mode,
       processing_status, reconciliation_status, raw_payload, transaction_date
     ) VALUES ($1, 'COOP_BANK', $2, $3, '01134248358600', 1250.00,
       'KES', 'CREDIT', 'Integration test', 'PendingReview', 'TOKEN',
       'PROCESSED', 'PENDING_ALLOCATION', $4::jsonb, '2026-07-17+03:00')
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [candidateId, transactionId, `COOP_BANK:${transactionId}`, JSON.stringify({ TransactionId: transactionId, Amount: '1250.00' })]
  );
  const concurrent = await Promise.all([insertion(eventId), insertion(crypto.randomUUID())]);
  assert.equal(concurrent.reduce((sum, result) => sum + Number(result.rowCount), 0), 1);
  eventId = String(concurrent.find(result => result.rowCount)?.rows[0].id);

  const posted = await reconcilePostgresCoopBankEvent(pool, {
    eventId, memberId, category: 'Daily Contribution', tillNumber: 'VehicleTill',
    actorId: userId, actorName: 'Integration Chairman', correlationId, note: 'Controlled integration test'
  });
  assert.match(posted.ledgerEntryId, /^[0-9a-f-]{36}$/i);
  const state = await pool.query(
    `SELECT e.reconciliation_status, e.ledger_entry_id, l.source, l.amount
     FROM coop_bank_ipn_events e JOIN ledger_entries l ON l.id = e.ledger_entry_id WHERE e.id = $1`,
    [eventId]
  );
  assert.deepEqual(
    { status: state.rows[0].reconciliation_status, source: state.rows[0].source, amount: String(state.rows[0].amount) },
    { status: 'MANUALLY_RECONCILED', source: 'COOP_BANK_IPN', amount: '1250.00' }
  );
  await assert.rejects(
    reconcilePostgresCoopBankEvent(pool, {
      eventId, memberId, category: 'Daily Contribution', tillNumber: 'VehicleTill',
      actorId: userId, actorName: 'Integration Chairman', correlationId: crypto.randomUUID()
    }),
    (error: any) => error instanceof PersistenceError && error.code === 'COOP_EVENT_ALREADY_RECONCILED'
  );
  await assert.rejects(pool.query(`UPDATE coop_bank_ipn_events SET raw_payload = '{}'::jsonb WHERE id = $1`, [eventId]));
  const audits = await pool.query(`SELECT action FROM coop_bank_event_audit WHERE bank_event_id = $1`, [eventId]);
  assert.equal(audits.rows.some(row => row.action === 'MANUAL_RECONCILIATION_POSTED'), true);
});
