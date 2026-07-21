import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  DriverAssignment,
  Member,
  MemberLoanSummary,
  PaymentRecord,
  Transaction,
  TransactionCategory,
  Vehicle
} from '../types';
import { normalizeTransactionInput, type LedgerInput } from './ledgerPolicy';

const CATEGORY_TO_ACCOUNT: Record<TransactionCategory, string> = {
  'Daily Contribution': 'DailyContribution',
  'Savings Contribution': 'Savings',
  'Registration Fee': 'RegistrationFee',
  'Management Fee': 'ManagementFee',
  'Office Expenses': 'OfficeExpenses',
  'Petty Cash': 'PettyCash',
  Penalty: 'Penalty',
  Utilities: 'Utilities',
  Equipment: 'Equipment'
};

const ACCOUNT_TO_CATEGORY = Object.fromEntries(
  Object.entries(CATEGORY_TO_ACCOUNT).map(([category, account]) => [account, category])
) as Record<string, TransactionCategory>;

const MATCH_TO_DB: Record<PaymentRecord['matchMethod'], string> = {
  'Member ID': 'MemberID',
  'Vehicle Plate': 'VehiclePlate',
  'Phone Number': 'PhoneNumber',
  'Manual Assignment': 'ManualAssignment',
  None: 'None'
};

const DB_TO_MATCH = Object.fromEntries(
  Object.entries(MATCH_TO_DB).map(([match, dbValue]) => [dbValue, match])
) as Record<string, PaymentRecord['matchMethod']>;

export class PersistenceError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

function toNumber(value: unknown): number {
  return Number(value || 0);
}

function transactionMetadata(transaction: Transaction) {
  return {
    memberName: transaction.memberName || '',
    vehiclePlate: transaction.vehiclePlate || '',
    recorderName: transaction.recorderName,
    vehicleClass: transaction.vehicleClass,
    operationAmount: transaction.operationAmount,
    entranceFee: transaction.entranceFee,
    loanRepay: transaction.loanRepay,
    savingsContribution: transaction.savingsContribution,
    sTicket: transaction.sTicket,
    legalFee: transaction.legalFee,
    expenseDeduction: transaction.expenseDeduction,
    grossAmount: transaction.grossAmount,
    reversedAt: transaction.reversedAt,
    reversedBy: transaction.reversedBy
  };
}

function mapMember(row: QueryResultRow): Member {
  return {
    id: String(row.id),
    name: row.full_name,
    email: row.email || undefined,
    membershipNumber: row.member_number || undefined,
    idNumber: row.national_id || '',
    phoneNumber: row.phone || '',
    status: row.status,
    dateRegistered: row.date_registered ? String(row.date_registered).slice(0, 10) : '',
    vehicleAssigned: row.vehicle_assigned || undefined,
    sharesAmount: toNumber(row.shares_amount),
    savingsAmount: toNumber(row.savings_amount),
    initialLoanAmount: toNumber(row.initial_loan_amount),
    loanBalance: toNumber(row.derived_loan_balance)
  };
}

function mapDriverAssignment(row: QueryResultRow): DriverAssignment {
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    vehiclePlate: row.plate_number || undefined,
    driverName: row.driver_name,
    driverPhone: row.driver_phone || undefined,
    startDateTime: new Date(row.start_date_time).toISOString(),
    endDateTime: row.end_date_time ? new Date(row.end_date_time).toISOString() : undefined,
    status: row.status,
    reason: row.reason || undefined
  };
}

function mapVehicle(row: QueryResultRow): Vehicle {
  return {
    id: String(row.id),
    plateNumber: row.plate_number,
    ownerId: row.member_id ? String(row.member_id) : '',
    ownerName: row.owner_name || '',
    driverName: row.driver_name || '',
    driverPhone: row.driver_phone || '',
    route: row.route_name || '',
    status: row.status,
    capacity: Number(row.capacity || 14) as Vehicle['capacity']
  };
}

function mapTransaction(row: QueryResultRow): Transaction {
  const metadata = row.metadata || {};
  return {
    id: String(row.id),
    timestamp: new Date(row.entry_time).toISOString(),
    memberId: row.member_id ? String(row.member_id) : '',
    memberName: metadata.memberName || row.member_name || '',
    vehiclePlate: metadata.vehiclePlate || row.plate_number || '',
    description: row.description,
    refCode: row.reference_code || '',
    type: row.transaction_type,
    category: ACCOUNT_TO_CATEGORY[row.account_type] || 'Daily Contribution',
    amount: toNumber(row.amount),
    recorderName: metadata.recorderName || row.recorder_name || 'SACCO Ledger OS',
    tillNumber: row.till_type,
    vehicleClass: metadata.vehicleClass,
    operationAmount: metadata.operationAmount,
    entranceFee: metadata.entranceFee,
    loanRepay: metadata.loanRepay,
    savingsContribution: metadata.savingsContribution,
    sTicket: metadata.sTicket,
    legalFee: metadata.legalFee,
    expenseDeduction: metadata.expenseDeduction,
    grossAmount: metadata.grossAmount,
    reversalOf: row.reversal_of ? String(row.reversal_of) : undefined,
    reversedAt: metadata.reversedAt,
    reversedBy: metadata.reversedBy
  };
}

function mapPayment(row: QueryResultRow): PaymentRecord {
  const metadata = row.metadata || {};
  return {
    id: String(row.id),
    timestamp: new Date(row.transaction_time).toISOString(),
    // Historical webhook rows are exposed generically; new bank events use
    // coop_bank_ipn_events and never pass through this legacy table.
    source: row.source === 'Manual' ? 'Manual' : 'Webhook',
    status: row.status,
    refCode: row.trans_id,
    amount: toNumber(row.amount),
    tillNumber: row.till_type,
    category: ACCOUNT_TO_CATEGORY[metadata.accountType] || metadata.category || 'Daily Contribution',
    accountReference: row.bill_ref_number || '',
    destinationAccount: row.destination_account_number || metadata.destinationAccount,
    payerName: row.payer_name || '',
    payerPhone: row.msisdn || '',
    memberId: row.matched_member_id ? String(row.matched_member_id) : undefined,
    memberName: row.member_name || metadata.memberName,
    vehiclePlate: row.plate_number || metadata.vehiclePlate,
    matchMethod: DB_TO_MATCH[row.match_method] || 'None',
    transactionId: row.ledger_entry_id ? String(row.ledger_entry_id) : undefined,
    note: metadata.note,
    rawPayload: row.raw_payload
  };
}

function translatePgError(error: any): never {
  if (error instanceof PersistenceError) throw error;
  if (error?.code === '23505') {
    throw new PersistenceError(409, 'That reference or unique identifier already exists.', 'DUPLICATE_RECORD');
  }
  if (error?.code === '23503') {
    throw new PersistenceError(400, 'A linked member, vehicle, or ledger record does not exist.', 'INVALID_REFERENCE');
  }
  throw error;
}

export async function listPostgresUsers(pool: Pool) {
  const result = await pool.query(
    `SELECT id, full_name AS name, email, role, COALESCE(phone, '') AS phone
     FROM users WHERE is_active = TRUE ORDER BY full_name`
  );
  return result.rows;
}

export async function listPostgresMembers(pool: Pool): Promise<Member[]> {
  const result = await pool.query(
    `SELECT m.*,
       assigned_vehicle.plate_number AS vehicle_assigned,
       COALESCE(fin.shares_amount, 0) AS shares_amount,
       COALESCE(fin.savings_amount, 0) AS savings_amount,
       GREATEST(0, m.initial_loan_amount - COALESCE(fin.loan_repaid, 0) + COALESCE((
         SELECT SUM(GREATEST(0, l.principal_amount * (1 + l.interest_rate / 100) - COALESCE(repaid.amount, 0)))
         FROM loans l
         LEFT JOIN LATERAL (SELECT SUM(lr.amount) AS amount FROM loan_repayments lr WHERE lr.loan_id = l.id) repaid ON TRUE
         WHERE l.member_id = m.id AND l.status IN ('Approved', 'Active', 'Defaulted')
       ), 0)) AS derived_loan_balance
     FROM members m
     LEFT JOIN LATERAL (
       SELECT v.plate_number FROM vehicles v
       WHERE v.member_id = m.id ORDER BY v.created_at LIMIT 1
     ) assigned_vehicle ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         SUM(CASE WHEN le.account_type = 'DailyContribution' THEN
           (CASE WHEN le.transaction_type = 'Credit' THEN 1 ELSE -1 END) *
           (CASE WHEN le.metadata ? 'savingsContribution' THEN 0 ELSE le.amount * 0.30 END)
           ELSE 0 END) AS shares_amount,
         SUM(CASE
           WHEN le.account_type = 'Savings' THEN
             (CASE WHEN le.transaction_type = 'Credit' THEN 1 ELSE -1 END) * le.amount
           WHEN le.account_type = 'DailyContribution' THEN
             (CASE WHEN le.transaction_type = 'Credit' THEN 1 ELSE -1 END) *
             (CASE WHEN le.metadata ? 'savingsContribution'
               THEN COALESCE((le.metadata->>'savingsContribution')::numeric, 0)
               ELSE le.amount * 0.70 END)
           ELSE 0 END) AS savings_amount,
         SUM((CASE WHEN le.transaction_type = 'Credit' THEN 1 ELSE -1 END) *
           COALESCE((le.metadata->>'loanRepay')::numeric, 0)) AS loan_repaid
       FROM ledger_entries le
       WHERE le.member_id = m.id AND le.status IN ('Posted', 'Reversed')
     ) fin ON TRUE
     ORDER BY m.created_at DESC`
  );
  return result.rows.map(mapMember);
}

export async function getPostgresMember(pool: Pool, memberId: string): Promise<Member | null> {
  const result = await pool.query(
    `SELECT m.*,
       assigned_vehicle.plate_number AS vehicle_assigned,
       COALESCE(fin.shares_amount, 0) AS shares_amount,
       COALESCE(fin.savings_amount, 0) AS savings_amount,
       GREATEST(0, m.initial_loan_amount - COALESCE(fin.loan_repaid, 0) + COALESCE((
         SELECT SUM(GREATEST(0, l.principal_amount * (1 + l.interest_rate / 100) - COALESCE(repaid.amount, 0)))
         FROM loans l
         LEFT JOIN LATERAL (SELECT SUM(lr.amount) AS amount FROM loan_repayments lr WHERE lr.loan_id = l.id) repaid ON TRUE
         WHERE l.member_id = m.id AND l.status IN ('Approved', 'Active', 'Defaulted')
       ), 0)) AS derived_loan_balance
     FROM members m
     LEFT JOIN LATERAL (
       SELECT v.plate_number FROM vehicles v
       WHERE v.member_id = m.id ORDER BY v.created_at LIMIT 1
     ) assigned_vehicle ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         SUM(CASE WHEN le.account_type = 'DailyContribution' THEN
           (CASE WHEN le.transaction_type = 'Credit' THEN 1 ELSE -1 END) *
           (CASE WHEN le.metadata ? 'savingsContribution' THEN 0 ELSE le.amount * 0.30 END)
           ELSE 0 END) AS shares_amount,
         SUM(CASE
           WHEN le.account_type = 'Savings' THEN
             (CASE WHEN le.transaction_type = 'Credit' THEN 1 ELSE -1 END) * le.amount
           WHEN le.account_type = 'DailyContribution' THEN
             (CASE WHEN le.transaction_type = 'Credit' THEN 1 ELSE -1 END) *
             (CASE WHEN le.metadata ? 'savingsContribution'
               THEN COALESCE((le.metadata->>'savingsContribution')::numeric, 0)
               ELSE le.amount * 0.70 END)
           ELSE 0 END) AS savings_amount,
         SUM((CASE WHEN le.transaction_type = 'Credit' THEN 1 ELSE -1 END) *
           COALESCE((le.metadata->>'loanRepay')::numeric, 0)) AS loan_repaid
       FROM ledger_entries le
       WHERE le.member_id = m.id AND le.status IN ('Posted', 'Reversed')
     ) fin ON TRUE
     WHERE m.id = $1
     LIMIT 1`,
    [memberId]
  );
  return result.rowCount ? mapMember(result.rows[0]) : null;
}

export async function createPostgresMember(pool: Pool, member: Omit<Member, 'id'>): Promise<Member> {
  try {
    const result = await pool.query(
      `INSERT INTO members (full_name, national_id, phone, email, status, date_registered, initial_loan_amount, loan_balance)
       VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $7)
       RETURNING *`,
      [member.name, member.idNumber, member.phoneNumber, member.email || '', member.status, member.dateRegistered, member.initialLoanAmount || 0]
    );
    return mapMember({ ...result.rows[0], shares_amount: 0, savings_amount: 0, derived_loan_balance: member.initialLoanAmount || 0 });
  } catch (error) {
    return translatePgError(error);
  }
}

export async function listPostgresVehicles(pool: Pool): Promise<Vehicle[]> {
  const result = await pool.query(
    `SELECT v.*, m.full_name AS owner_name, r.route_name
     FROM vehicles v
     LEFT JOIN members m ON m.id = v.member_id
     LEFT JOIN routes r ON r.id = v.route_id
     ORDER BY v.created_at DESC`
  );
  return result.rows.map(mapVehicle);
}

export async function listPostgresVehiclesByOwner(pool: Pool, memberId: string): Promise<Vehicle[]> {
  const result = await pool.query(
    `SELECT v.*, m.full_name AS owner_name, r.route_name
     FROM vehicles v
     JOIN members m ON m.id = v.member_id
     LEFT JOIN routes r ON r.id = v.route_id
     WHERE v.member_id = $1
     ORDER BY v.created_at DESC`,
    [memberId]
  );
  return result.rows.map(mapVehicle);
}

export async function createPostgresVehicle(
  pool: Pool,
  vehicle: Omit<Vehicle, 'id'>,
  assignedByUserId?: string
): Promise<Vehicle> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const routeResult = await client.query(
      `INSERT INTO routes (route_name) VALUES ($1)
       ON CONFLICT (route_name) DO UPDATE SET route_name = EXCLUDED.route_name
       RETURNING id`,
      [vehicle.route]
    );
    const result = await client.query(
      `INSERT INTO vehicles (plate_number, member_id, route_id, capacity, driver_name, driver_phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [vehicle.plateNumber, vehicle.ownerId, routeResult.rows[0].id, vehicle.capacity, vehicle.driverName, vehicle.driverPhone, vehicle.status]
    );
    const driverResult = await client.query(
      `SELECT id FROM drivers
       WHERE ($1 <> '' AND phone = $1) OR ($1 = '' AND full_name = $2)
       ORDER BY created_at
       LIMIT 1`,
      [vehicle.driverPhone || '', vehicle.driverName]
    );
    const driverId = driverResult.rowCount
      ? driverResult.rows[0].id
      : (await client.query(
          `INSERT INTO drivers (full_name, phone)
           VALUES ($1, NULLIF($2, ''))
           RETURNING id`,
          [vehicle.driverName, vehicle.driverPhone || '']
        )).rows[0].id;
    await client.query(
      `INSERT INTO driver_assignments (
         vehicle_id, driver_id, owner_member_id, start_date_time, status, assigned_by, reason
       ) VALUES ($1, $2, $3, now(), 'Active', $4, 'Initial vehicle onboarding')`,
      [result.rows[0].id, driverId, vehicle.ownerId, assignedByUserId || null]
    );
    await client.query('COMMIT');
    return mapVehicle({ ...result.rows[0], owner_name: vehicle.ownerName, route_name: vehicle.route });
  } catch (error) {
    await client.query('ROLLBACK');
    return translatePgError(error);
  } finally {
    client.release();
  }
}

export async function assignPostgresDriver(
  pool: Pool,
  vehicleId: string,
  input: { driverName: string; driverPhone: string; reason?: string },
  assignedByUserId?: string
): Promise<DriverAssignment> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vehicleResult = await client.query(
      'SELECT id, member_id, plate_number FROM vehicles WHERE id = $1 FOR UPDATE',
      [vehicleId]
    );
    if (!vehicleResult.rowCount || !vehicleResult.rows[0].member_id) {
      throw new PersistenceError(404, 'Vehicle to assign a driver was not found.', 'VEHICLE_NOT_FOUND');
    }

    const vehicle = vehicleResult.rows[0];
    await client.query(
      `UPDATE driver_assignments
       SET status = 'Closed', end_date_time = now(), reason = COALESCE(NULLIF($2, ''), reason)
       WHERE vehicle_id = $1 AND status = 'Active'`,
      [vehicleId, input.reason || 'Driver reassigned']
    );
    const existingDriver = await client.query(
      `SELECT id FROM drivers
       WHERE ($1 <> '' AND phone = $1) OR ($1 = '' AND full_name = $2)
       ORDER BY created_at
       LIMIT 1`,
      [input.driverPhone || '', input.driverName]
    );
    const driverId = existingDriver.rowCount
      ? existingDriver.rows[0].id
      : (await client.query(
          `INSERT INTO drivers (full_name, phone)
           VALUES ($1, NULLIF($2, ''))
           RETURNING id`,
          [input.driverName, input.driverPhone || '']
        )).rows[0].id;
    const assignment = await client.query(
      `INSERT INTO driver_assignments (
         vehicle_id, driver_id, owner_member_id, start_date_time, status, assigned_by, reason
       ) VALUES ($1, $2, $3, now(), 'Active', $4, $5)
       RETURNING *`,
      [vehicle.id, driverId, vehicle.member_id, assignedByUserId || null, input.reason || null]
    );
    await client.query(
      `UPDATE vehicles
       SET driver_name = $2, driver_phone = $3
       WHERE id = $1`,
      [vehicle.id, input.driverName, input.driverPhone || null]
    );
    await client.query('COMMIT');
    return mapDriverAssignment({
      ...assignment.rows[0],
      plate_number: vehicle.plate_number,
      driver_name: input.driverName,
      driver_phone: input.driverPhone
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof PersistenceError) throw error;
    return translatePgError(error);
  } finally {
    client.release();
  }
}

export async function listPostgresDriverAssignmentsByOwner(pool: Pool, memberId: string): Promise<DriverAssignment[]> {
  const result = await pool.query(
    `SELECT da.*, v.plate_number, d.full_name AS driver_name, d.phone AS driver_phone
     FROM driver_assignments da
     JOIN vehicles v ON v.id = da.vehicle_id
     JOIN drivers d ON d.id = da.driver_id
     WHERE da.owner_member_id = $1
     ORDER BY da.start_date_time DESC`,
    [memberId]
  );
  return result.rows.map(mapDriverAssignment);
}

const TRANSACTION_SELECT = `
  SELECT le.*, m.full_name AS member_name, v.plate_number, u.full_name AS recorder_name
  FROM ledger_entries le
  LEFT JOIN members m ON m.id = le.member_id
  LEFT JOIN vehicles v ON v.id = le.vehicle_id
  LEFT JOIN users u ON u.id = le.recorded_by`;

export async function listPostgresTransactions(pool: Pool): Promise<Transaction[]> {
  const result = await pool.query(`${TRANSACTION_SELECT} ORDER BY le.entry_time DESC`);
  return result.rows.map(mapTransaction);
}

export async function listPostgresTransactionsByMember(pool: Pool, memberId: string): Promise<Transaction[]> {
  const result = await pool.query(
    `${TRANSACTION_SELECT}
     WHERE le.member_id = $1
        OR EXISTS (
          SELECT 1 FROM vehicles owned_vehicle
          WHERE owned_vehicle.id = le.vehicle_id AND owned_vehicle.member_id = $1
        )
     ORDER BY le.entry_time DESC`,
    [memberId]
  );
  return result.rows.map(mapTransaction);
}

async function insertTransaction(client: Pool | PoolClient, transaction: Transaction): Promise<Transaction> {
  try {
    const result = await client.query(
      `INSERT INTO ledger_entries (
         entry_date, entry_time, transaction_type, account_type, till_type, amount,
         member_id, vehicle_id, reference_code, description, source, status,
         reversal_of, metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, (SELECT id FROM vehicles WHERE upper(replace(plate_number, ' ', '')) = upper(replace($8, ' ', '')) LIMIT 1),
         $9, $10, $11, 'Posted', $12, $13::jsonb
       )
       RETURNING *`,
      [
        transaction.timestamp.slice(0, 10), transaction.timestamp, transaction.type,
        CATEGORY_TO_ACCOUNT[transaction.category], transaction.tillNumber, transaction.amount,
        transaction.memberId || null, transaction.vehiclePlate || '', transaction.refCode,
        transaction.description, 'Manual',
        transaction.reversalOf || null, JSON.stringify(transactionMetadata(transaction))
      ]
    );
    return mapTransaction(result.rows[0]);
  } catch (error) {
    return translatePgError(error);
  }
}

export async function createPostgresTransaction(pool: Pool, transaction: Transaction): Promise<Transaction> {
  return insertTransaction(pool, transaction);
}

export async function reconcilePostgresCoopBankEvent(
  pool: Pool,
  input: {
    eventId: string;
    memberId: string;
    vehicleId?: string;
    category: TransactionCategory;
    tillNumber: Transaction['tillNumber'];
    note?: string;
    actorId: string;
    actorName: string;
    correlationId: string;
  }
): Promise<{ ledgerEntryId: string }> {
  const accountType = CATEGORY_TO_ACCOUNT[input.category];
  if (!accountType) throw new PersistenceError(400, 'Choose a supported allocation category.', 'COOP_ALLOCATION_INVALID');
  if ((input.category === 'Savings Contribution') !== (input.tillNumber === 'UtilityTill')) {
    throw new PersistenceError(400, 'Savings allocations use the utility account; all other allocations use the vehicle account.', 'COOP_ALLOCATION_TILL_INVALID');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query(
      `SELECT * FROM coop_bank_ipn_events WHERE id = $1 FOR UPDATE`,
      [input.eventId]
    );
    const event = eventResult.rows[0];
    if (!event) throw new PersistenceError(404, 'Bank event was not found.', 'COOP_EVENT_NOT_FOUND');
    if (event.event_type !== 'CREDIT') throw new PersistenceError(409, 'Only CREDIT events can be allocated to the member ledger.', 'COOP_EVENT_NOT_CREDIT');
    if (event.ledger_entry_id || ['POSTED', 'MANUALLY_RECONCILED'].includes(event.reconciliation_status)) {
      throw new PersistenceError(409, 'This bank event has already been reconciled.', 'COOP_EVENT_ALREADY_RECONCILED');
    }
    const member = await client.query(`SELECT id, full_name FROM members WHERE id = $1 AND status = 'Active'`, [input.memberId]);
    if (!member.rowCount) throw new PersistenceError(400, 'Choose an active SACCO member.', 'COOP_MEMBER_INVALID');
    if (input.vehicleId) {
      const vehicle = await client.query(`SELECT id FROM vehicles WHERE id = $1 AND member_id = $2`, [input.vehicleId, input.memberId]);
      if (!vehicle.rowCount) throw new PersistenceError(400, 'The selected vehicle does not belong to this member.', 'COOP_VEHICLE_INVALID');
    }

    const metadata = {
      recorderName: input.actorName,
      memberName: member.rows[0].full_name,
      bankEventId: String(event.id),
      externalTransactionId: event.transaction_id,
      paymentReference: event.payment_ref || null,
      reconciliationNote: input.note || ''
    };
    const ledger = await client.query(
      `INSERT INTO ledger_entries (
         entry_date, entry_time, transaction_type, account_type, till_type, amount,
         member_id, vehicle_id, reference_code, description, recorded_by, source,
         status, metadata
       ) VALUES (
         COALESCE(NULLIF(left(COALESCE($1, $2), 10), '')::date, current_date), now(),
         'Credit', $3, $4, $5, $6, $7, $8, $9, $10, 'COOP_BANK_IPN',
         'Posted', $11::jsonb
       ) RETURNING id`,
      [event.transaction_date, event.posting_date, accountType, input.tillNumber, event.amount,
        input.memberId, input.vehicleId || null, event.transaction_id,
        `Co-op Bank ${input.category}${input.note ? `: ${input.note}` : ''}`,
        input.actorId, JSON.stringify(metadata)]
    );
    const ledgerEntryId = String(ledger.rows[0].id);
    const updated = await client.query(
      `UPDATE coop_bank_ipn_events
       SET status = 'Reconciled', processing_status = 'PROCESSED',
           reconciliation_status = 'MANUALLY_RECONCILED', matched_member_id = $2,
           matched_vehicle_id = $3, ledger_entry_id = $4, match_method = 'MANUAL_ASSIGNMENT',
           match_confidence = 1, manual_review_reason = NULL, reconciled_at = now(),
           reconciled_by = $5, posted_at = now(), processed_at = COALESCE(processed_at, now())
       WHERE id = $1 AND ledger_entry_id IS NULL
       RETURNING id`,
      [input.eventId, input.memberId, input.vehicleId || null, ledgerEntryId, input.actorId]
    );
    if (!updated.rowCount) throw new PersistenceError(409, 'This bank event was completed by another request.', 'COOP_EVENT_STALE');
    await client.query(
      `INSERT INTO coop_bank_event_audit (
         bank_event_id, action, actor_type, actor_user_id, previous_status,
         new_status, reason, correlation_id, metadata
       ) VALUES ($1, 'MANUAL_RECONCILIATION_POSTED', 'USER', $2, $3,
                 'MANUALLY_RECONCILED', $4, $5, $6::jsonb)`,
      [input.eventId, input.actorId, event.reconciliation_status, input.note || null,
        input.correlationId, JSON.stringify({ ledgerEntryId, memberId: input.memberId, vehicleId: input.vehicleId || null, category: input.category })]
    );
    await client.query('COMMIT');
    return { ledgerEntryId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function reversePostgresTransaction(pool: Pool, transactionId: string, recorderName: string): Promise<Transaction> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const originalResult = await client.query(`${TRANSACTION_SELECT} WHERE le.id = $1 FOR UPDATE OF le`, [transactionId]);
    if (!originalResult.rowCount) {
      throw new PersistenceError(404, 'Transaction to reverse was not found.', 'TRANSACTION_NOT_FOUND');
    }
    const original = mapTransaction(originalResult.rows[0]);
    const existing = await client.query('SELECT 1 FROM ledger_entries WHERE reversal_of = $1 LIMIT 1', [transactionId]);
    if (existing.rowCount) {
      throw new PersistenceError(409, `Transaction ${original.refCode} has already been reversed.`, 'ALREADY_REVERSED');
    }
    const reversedAt = new Date().toISOString();
    const reversal = await insertTransaction(client, {
      ...original,
      id: '',
      timestamp: reversedAt,
      type: original.type === 'Credit' ? 'Debit' : 'Credit',
      description: `Reversal of ${original.refCode}: ${original.description}`,
      refCode: `REV-${original.refCode}-${Date.now().toString().slice(-6)}`,
      recorderName,
      reversalOf: original.id,
      reversedAt,
      reversedBy: recorderName
    });
    await client.query(
      `UPDATE ledger_entries
       SET status = 'Reversed', is_reversed = TRUE,
           metadata = metadata || $2::jsonb
       WHERE id = $1`,
      [transactionId, JSON.stringify({ reversedAt, reversedBy: recorderName })]
    );
    await client.query('COMMIT');
    return reversal;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof PersistenceError) throw error;
    return translatePgError(error);
  } finally {
    client.release();
  }
}

export async function correctPostgresTransaction(
  pool: Pool,
  transactionId: string,
  changes: LedgerInput
): Promise<Transaction> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const originalResult = await client.query(`${TRANSACTION_SELECT} WHERE le.id = $1 FOR UPDATE OF le`, [transactionId]);
    if (!originalResult.rowCount) {
      throw new PersistenceError(404, 'Transaction to correct was not found.', 'TRANSACTION_NOT_FOUND');
    }
    const original = mapTransaction(originalResult.rows[0]);
    const existing = await client.query('SELECT 1 FROM ledger_entries WHERE reversal_of = $1 LIMIT 1', [transactionId]);
    if (existing.rowCount) {
      throw new PersistenceError(409, `Transaction ${original.refCode} has already been reversed or corrected.`, 'ALREADY_REVERSED');
    }

    const correctedAt = new Date().toISOString();
    const recorderName = changes.recorderName || original.recorderName;
    await insertTransaction(client, {
      ...original,
      id: '',
      timestamp: correctedAt,
      type: original.type === 'Credit' ? 'Debit' : 'Credit',
      description: `Correction reversal of ${original.refCode}: ${original.description}`,
      refCode: `REV-${original.refCode}-${Date.now().toString().slice(-6)}`,
      recorderName,
      reversalOf: original.id,
      reversedAt: correctedAt,
      reversedBy: recorderName
    });
    await client.query(
      `UPDATE ledger_entries
       SET status = 'Reversed', is_reversed = TRUE,
           metadata = metadata || $2::jsonb
       WHERE id = $1`,
      [transactionId, JSON.stringify({ reversedAt: correctedAt, reversedBy: recorderName })]
    );

    const corrected = normalizeTransactionInput({
      ...original,
      ...changes,
      id: undefined,
      timestamp: correctedAt,
      refCode: `COR-${original.refCode}-${Date.now().toString().slice(-6)}`,
      recorderName,
      reversalOf: undefined,
      reversedAt: undefined,
      reversedBy: undefined
    });
    const result = await insertTransaction(client, corrected);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    return translatePgError(error);
  } finally {
    client.release();
  }
}

const PAYMENT_SELECT = `
  SELECT p.*, m.full_name AS member_name, v.plate_number
  FROM mpesa_payments p
  LEFT JOIN members m ON m.id = p.matched_member_id
  LEFT JOIN vehicles v ON v.id = p.matched_vehicle_id`;

export async function listPostgresPayments(pool: Pool): Promise<PaymentRecord[]> {
  const result = await pool.query(`${PAYMENT_SELECT} ORDER BY p.transaction_time DESC`);
  return result.rows.map(mapPayment);
}

export async function listPostgresPaymentsByMember(pool: Pool, memberId: string): Promise<PaymentRecord[]> {
  const result = await pool.query(
    `${PAYMENT_SELECT}
     WHERE p.matched_member_id = $1
        OR EXISTS (
          SELECT 1 FROM vehicles owned_vehicle
          WHERE owned_vehicle.id = p.matched_vehicle_id AND owned_vehicle.member_id = $1
        )
     ORDER BY p.transaction_time DESC`,
    [memberId]
  );
  return result.rows.map(mapPayment);
}

export async function listPostgresLoansByMember(pool: Pool, memberId: string): Promise<MemberLoanSummary[]> {
  const result = await pool.query(
    `SELECT l.id, l.principal_amount, l.interest_rate, l.issue_date, l.due_date, l.status, l.notes,
       l.loan_type, l.repayment_period_months, l.repayment_method, l.income_source, l.monthly_income,
       l.guarantor_details, l.collateral_details,
       l.rejection_reason, l.rejected_at,
       COALESCE(SUM(lr.amount), 0) AS repaid_amount,
       COALESCE(
         json_agg(
           json_build_object('id', lr.id, 'repaymentDate', lr.repayment_date, 'amount', lr.amount)
           ORDER BY lr.repayment_date DESC
         ) FILTER (WHERE lr.id IS NOT NULL),
         '[]'::json
       ) AS repayments
     FROM loans l
     LEFT JOIN loan_repayments lr ON lr.loan_id = l.id
     WHERE l.member_id = $1
     GROUP BY l.id
     ORDER BY l.issue_date DESC`,
    [memberId]
  );
  return result.rows.map(row => ({
    id: String(row.id),
    principalAmount: toNumber(row.principal_amount),
    outstandingBalance: Math.max(0, toNumber(row.principal_amount) * (1 + toNumber(row.interest_rate) / 100) - toNumber(row.repaid_amount)),
    amountPaid: toNumber(row.repaid_amount),
    issueDate: String(row.issue_date).slice(0, 10),
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : undefined,
    status: row.status,
    interestRate: toNumber(row.interest_rate),
    totalPayable: toNumber(row.principal_amount) * (1 + toNumber(row.interest_rate) / 100),
    loanType: row.loan_type || undefined,
    repaymentPeriodMonths: row.repayment_period_months == null ? undefined : Number(row.repayment_period_months),
    repaymentMethod: row.repayment_method || undefined,
    incomeSource: row.income_source || undefined,
    monthlyIncome: row.monthly_income == null ? undefined : toNumber(row.monthly_income),
    guarantorDetails: row.guarantor_details || undefined,
    collateralDetails: row.collateral_details || undefined,
    notes: row.notes || undefined,
    rejectionReason: row.rejection_reason || undefined,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at).toISOString() : undefined,
    repayments: row.repayments.map((repayment: any) => ({
      id: String(repayment.id),
      repaymentDate: String(repayment.repaymentDate).slice(0, 10),
      amount: toNumber(repayment.amount)
    }))
  }));
}

export async function findPostgresPaymentByRef(pool: Pool, refCode: string): Promise<PaymentRecord | null> {
  const result = await pool.query(
    `SELECT p.*, m.full_name AS member_name, v.plate_number
     FROM mpesa_payments p
     LEFT JOIN members m ON m.id = p.matched_member_id
     LEFT JOIN vehicles v ON v.id = p.matched_vehicle_id
     WHERE p.trans_id = $1 LIMIT 1`,
    [refCode]
  );
  return result.rowCount ? mapPayment(result.rows[0]) : null;
}

export async function savePostgresPayment(pool: Pool | PoolClient, payment: PaymentRecord): Promise<PaymentRecord> {
  const metadata = {
    category: payment.category,
    accountType: CATEGORY_TO_ACCOUNT[payment.category],
    memberName: payment.memberName,
    vehiclePlate: payment.vehiclePlate,
    note: payment.note,
    destinationAccount: payment.destinationAccount
  };
  try {
    const result = await pool.query(
      `INSERT INTO mpesa_payments (
         trans_id, bill_ref_number, business_short_code, msisdn, payer_name, till_type,
         amount, transaction_time, status, match_method, matched_member_id, destination_account_number,
         matched_vehicle_id, ledger_entry_id, raw_payload, source, metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         (SELECT id FROM vehicles WHERE upper(replace(plate_number, ' ', '')) = upper(replace($13, ' ', '')) LIMIT 1),
         $14, $15::jsonb, $16, $17::jsonb
       )
       ON CONFLICT (trans_id) DO UPDATE SET
         status = EXCLUDED.status, match_method = EXCLUDED.match_method,
         matched_member_id = EXCLUDED.matched_member_id,
         destination_account_number = EXCLUDED.destination_account_number,
         matched_vehicle_id = EXCLUDED.matched_vehicle_id,
         ledger_entry_id = EXCLUDED.ledger_entry_id,
         metadata = EXCLUDED.metadata,
         reconciled_at = CASE WHEN EXCLUDED.status = 'Reconciled' THEN now() ELSE mpesa_payments.reconciled_at END
       RETURNING *`,
      [
        payment.refCode, payment.accountReference, '400200',
        payment.payerPhone, payment.payerName, payment.tillNumber, payment.amount, payment.timestamp,
        payment.status, MATCH_TO_DB[payment.matchMethod], payment.memberId || null, payment.destinationAccount || null, payment.vehiclePlate || '',
        payment.transactionId || null, JSON.stringify(payment.rawPayload || {}),
        'Manual', JSON.stringify(metadata)
      ]
    );
    return mapPayment(result.rows[0]);
  } catch (error) {
    return translatePgError(error);
  }
}

export async function reconcilePostgresPayment(
  pool: Pool,
  payment: PaymentRecord,
  transaction: Transaction
): Promise<PaymentRecord> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT status FROM mpesa_payments WHERE trans_id = $1 FOR UPDATE',
      [payment.refCode]
    );
    if (existing.rows[0]?.status === 'Reconciled') {
      throw new PersistenceError(409, `Payment ${payment.refCode} has already been reconciled.`, 'PAYMENT_ALREADY_RECONCILED');
    }

    const ledgerEntry = await insertTransaction(client, transaction);
    const reconciled = await savePostgresPayment(client, {
      ...payment,
      status: 'Reconciled',
      transactionId: ledgerEntry.id
    });
    await client.query('COMMIT');
    return reconciled;
  } catch (error) {
    await client.query('ROLLBACK');
    return translatePgError(error);
  } finally {
    client.release();
  }
}
