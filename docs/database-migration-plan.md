# Database Migration Plan

This runbook moves the app from local mock data to the production PostgreSQL schema hosted by Supabase.

## Current Data Sources

The app currently has three possible data sources:

- In-memory fallback data seeded from `server.ts`.
- Browser/local development state.
- Disposable in-memory data when explicitly enabled for local tests.

The production target is PostgreSQL/Supabase using SQL migrations under `database/migrations`.

## Target Cutover Strategy

Use a phased migration, not a big-bang rewrite:

1. Create schema in PostgreSQL.
2. Backfill existing members, vehicles, transactions, and payments.
3. Run dual-read validation reports.
4. Switch writes module by module.
5. Keep old data read-only until reconciliation is complete.
6. Remove fallback storage only after one successful reporting cycle.

## Phase 0: Pre-Migration Preparation

Tasks:

- Choose the production database host.
- Create staging and production databases.
- Configure backups and point-in-time recovery.
- Create a read-only reporting user.
- Create an app user with least-privilege write access.
- Confirm `.env` contains database connection settings only locally or in deployment secrets.

Exit checks:

- Fresh database can run `001_initial_schema.sql`.
- Fresh database can run `002_seed_reference_data.sql`.
- Backup and restore have been tested once.

## Phase 1: Foundation Schema

Run:

```bash
psql "$DATABASE_URL" -f database/migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f database/migrations/002_seed_reference_data.sql
```

Validation:

```sql
SELECT version, name, applied_at FROM schema_migrations ORDER BY version;
SELECT till_type, business_short_code, default_account_type FROM mpesa_tills;
SELECT COUNT(*) FROM sacco_settings;
```

Expected:

- Versions `001` and `002` exist.
- Two tills exist: `VehicleTill` and `UtilityTill`.
- One default SACCO settings row exists.
- No users are seeded by SQL. The first Chairman profile is created through app onboarding.

Rollback:

- Before production data exists, drop the database and recreate it.
- After production data exists, do not drop tables. Create corrective migrations.

## Phase 2: User And Role Migration

For a new install, use the app's first-admin onboarding screen instead of a seed migration. It creates the first Chairman profile only when the `users` table is empty.

For an existing installation, map current officials into `users`.

Source fields:

```text
Legacy user id     -> external legacy reference only, not UUID primary key
Legacy identity id -> users.firebase_uid (historical import field only; unused by runtime authentication)
Official name      -> users.full_name
Official email     -> users.email
Official phone     -> users.phone
Official role      -> users.role
```

Rules:

- PostgreSQL/Supabase is the active data store and the application issues its own signed sessions.
- PostgreSQL `users` stores SACCO role, status, password hash, phone, and audit relationships.
- Preserve any imported `users.firebase_uid` values for audit/history only. New and existing sessions use server-issued JWTs backed by the `users` table.
- Never store role security keys or JWT secrets in the database.
- Never store passwords or session tokens in the database outside the approved password hash.

Validation:

```sql
SELECT role, COUNT(*) FROM users GROUP BY role ORDER BY role;
SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1;
SELECT firebase_uid, COUNT(*) FROM users WHERE firebase_uid IS NOT NULL GROUP BY firebase_uid HAVING COUNT(*) > 1;
```

## Phase 3: Member And Vehicle Backfill

Map members:

```text
Member.name            -> members.full_name
Member.idNumber        -> members.national_id
Member.phoneNumber     -> members.phone
Member.status          -> members.status
Member.dateRegistered  -> members.date_registered
```

Map vehicles:

```text
Vehicle.plateNumber  -> vehicles.plate_number
Vehicle.ownerId      -> vehicles.member_id after member lookup
Vehicle.driverName   -> vehicles.driver_name
Vehicle.driverPhone  -> vehicles.driver_phone
Vehicle.route        -> routes.route_name, vehicles.route_id
Vehicle.status       -> vehicles.status
Vehicle.capacity     -> vehicles.capacity
```

Backfill order:

1. Insert routes from distinct vehicle route names.
2. Insert members.
3. Insert vehicles after resolving owner/member IDs.
4. Insert one `savings_accounts` and one `share_accounts` row per member.

Validation:

```sql
SELECT COUNT(*) FROM members;
SELECT COUNT(*) FROM vehicles;
SELECT COUNT(*) FROM vehicles WHERE member_id IS NULL;
SELECT COUNT(*) FROM savings_accounts;
SELECT COUNT(*) FROM share_accounts;
```

## Phase 4: Ledger Backfill

Map current `Transaction` rows to `ledger_entries`.

```text
Transaction.timestamp     -> ledger_entries.entry_time, entry_date
Transaction.type          -> ledger_entries.transaction_type
Transaction.category      -> ledger_entries.account_type
Transaction.amount        -> ledger_entries.amount
Transaction.memberId      -> ledger_entries.member_id
Transaction.vehiclePlate  -> vehicles.plate_number lookup -> ledger_entries.vehicle_id
Transaction.refCode       -> ledger_entries.reference_code
Transaction.description   -> ledger_entries.description
Transaction.tillNumber    -> ledger_entries.till_type
Transaction.reversalOf    -> ledger_entries.reversal_of after lookup
```

Category mapping:

```text
Daily Contribution -> DailyContribution
Registration Fee   -> RegistrationFee
Management Fee     -> ManagementFee
Office Expenses    -> OfficeExpenses
Petty Cash         -> PettyCash
Penalty            -> Penalty
Utilities          -> Utilities
Equipment          -> Equipment
```

Validation:

```sql
SELECT COUNT(*) FROM ledger_entries;
SELECT reference_code, COUNT(*)
FROM ledger_entries
WHERE reference_code IS NOT NULL AND reference_code <> ''
GROUP BY reference_code
HAVING COUNT(*) > 1;

SELECT
  SUM(CASE WHEN transaction_type = 'Credit' THEN amount ELSE 0 END) AS total_credit,
  SUM(CASE WHEN transaction_type = 'Debit' THEN amount ELSE 0 END) AS total_debit
FROM ledger_entries
WHERE status = 'Posted';
```

## Phase 5: Legacy Payment Compatibility Backfill

This phase is only for preserving records received before the Co-op Bank B2B cutover. It does not enable a Daraja integration.

Map current `PaymentRecord` rows to `mpesa_payments`.

```text
PaymentRecord.refCode          -> mpesa_payments.trans_id
PaymentRecord.accountReference -> mpesa_payments.bill_ref_number
PaymentRecord.amount           -> mpesa_payments.amount
PaymentRecord.tillNumber       -> mpesa_payments.till_type
PaymentRecord.status           -> mpesa_payments.status
PaymentRecord.matchMethod      -> mpesa_payments.match_method
PaymentRecord.memberId         -> mpesa_payments.matched_member_id
PaymentRecord.vehiclePlate     -> vehicles.plate_number lookup
PaymentRecord.transactionId    -> mpesa_payments.ledger_entry_id after lookup
PaymentRecord.rawPayload       -> mpesa_payments.raw_payload
```

Rules:

- `trans_id` must be unique.
- Unknown callback payloads should still be stored.
- Reconciled payments must have either a linked ledger entry or a documented exception.

Validation:

```sql
SELECT status, COUNT(*) FROM mpesa_payments GROUP BY status;
SELECT trans_id, COUNT(*) FROM mpesa_payments GROUP BY trans_id HAVING COUNT(*) > 1;
SELECT COUNT(*) FROM mpesa_payments WHERE status = 'Reconciled' AND ledger_entry_id IS NULL;
```

## Phase 6: Co-op Bank B2B Event Inbox

Apply `008_coop_bank_b2b_ipn.sql` before registering the production HTTPS receiver with Co-op Bank.

```text
Co-op event TransactionId -> coop_bank_ipn_events.transaction_id
Co-op event AcctNo        -> coop_bank_ipn_events.account_number
Co-op event EventType     -> coop_bank_ipn_events.event_type
Co-op event amount        -> coop_bank_ipn_events.amount
Co-op event raw body      -> coop_bank_ipn_events.raw_payload
```

Rules:

- Authenticate each bank request with the agreed Bearer token or Basic credentials.
- Accept only events for `COOP_B2B_ALLOWED_ACCOUNT_NUMBERS` and the expected currency.
- Insert `TransactionId` idempotently before returning HTTP `200` or `201`.
- Keep all events as `PendingReview`; never automatically post a credit or debit to the member ledger.

Validation:

```sql
SELECT transaction_id, COUNT(*)
FROM coop_bank_ipn_events
GROUP BY transaction_id
HAVING COUNT(*) > 1;
SELECT event_type, status, COUNT(*) FROM coop_bank_ipn_events GROUP BY event_type, status;
```

## Phase 7: Module Write Cutover

Cut over writes in this order:

1. Authentication profile reads: `users`.
2. Members module: `members`.
3. Fleet module: `routes`, `vehicles`.
4. Ledger module: `ledger_entries`.
5. Co-op Bank event inbox: `coop_bank_ipn_events`.
6. Reports module: reporting views and `monthly_closings`.
7. Reports module polish: close-month workflow, exports, and audit review.

For each module:

- Write to PostgreSQL.
- Read back from PostgreSQL.
- Compare counts and totals against old storage.
- Keep rollback path to previous storage until validation passes.

## Phase 8: Reporting And Closing

Create first month-end closing only after:

- Ledger totals match historical report totals.
- Reviewed Co-op Bank events match the bank statement and each reconciled event links to at most one ledger entry.
- Member balances from `v_member_financial_balances` match expected balances.

Closing validation:

```sql
SELECT * FROM v_daily_till_summary ORDER BY entry_date DESC LIMIT 30;
SELECT * FROM v_member_financial_balances ORDER BY full_name;
```

## Phase 9: Security And Audit Hardening

Add follow-up migrations for:

- Row-level security policies if using Supabase.
- Audit triggers for sensitive tables.
- Database roles for app, admin, and read-only reporting.
- Optional encryption for especially sensitive identity fields.

Minimum production roles:

```text
sacco_app_rw       -> app read/write tables needed by API
sacco_report_ro    -> read reporting views only
sacco_migration    -> migration owner, not used by the app runtime
```

## Rollback Rules

- Roll back code separately from database schema.
- Prefer forward corrective migrations once production data exists.
- Never drop production columns with data in an emergency rollback.
- Keep old storage read-only until at least one full financial month closes successfully.
- Keep migration exports and checksums with deployment artifacts.

## Data Quality Checklist

Before go-live:

- No duplicate member national IDs.
- No duplicate vehicle plates.
- No duplicate ledger reference codes.
- No duplicate Co-op Bank transaction IDs.
- Every active vehicle has a member owner or documented exception.
- Every reconciled Co-op Bank event links to at most one ledger entry.
- Credit/debit totals match the previous system.
- Reversal entries point to valid originals.
- Closed month totals match generated reports.

## Go-Live Checklist

- Database backup completed.
- Migrations applied to production.
- App env points to production database.
- Co-op Bank B2B endpoint is HTTPS and its authentication secrets are configured in the host secret manager.
- Full authorised Co-op account numbers are set in `COOP_B2B_ALLOWED_ACCOUNT_NUMBERS`.
- Dev auth fallback is disabled.
- First admin users created.
- Smoke tests pass for login, member creation, ledger posting, reversal, Co-op Bank B2B receipt, reconciliation, and reports.
- Monitoring and error logs are active.
