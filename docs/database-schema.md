# SACCO Production Database Schema

This document defines the relational database contract for the Matatu SACCO management system. The target database is PostgreSQL or Supabase PostgreSQL.

The executable migrations live in:

```text
database/migrations/001_initial_schema.sql
database/migrations/002_seed_reference_data.sql
```

## Design Principles

- `ledger_entries` is the financial source of truth.
- M-Pesa callbacks first land in `mpesa_payments`; they become ledger entries only after validation or reconciliation.
- Posted ledger entries are never edited silently. Corrections use reversal entries.
- Money is stored as `NUMERIC(14,2)`, never floating point.
- Raw Daraja payloads are retained as `JSONB` for traceability.
- Summary tables and views are derived from ledger history or locked month-end snapshots.
- Production secrets stay outside the database and codebase.

## Entity Relationship Summary

```text
users ──< audit_logs
users ──< ledger_entries
members ──< vehicles
members ──< ledger_entries
members ──< loans
members ──1 savings_accounts
members ──1 share_accounts
routes ──< vehicles
vehicles ──< ledger_entries
vehicles ──< daily_vehicle_records
mpesa_tills ──< mpesa_payments
mpesa_payments ──0..1 ledger_entries
loans ──< loan_repayments
monthly_closings ──< monthly_closing_lines
```

## Core Tables

`schema_migrations`

Tracks migrations applied outside a framework such as Prisma, Knex, or Supabase CLI. Each SQL file inserts its version when applied.

`sacco_settings`

Stores non-secret tenant settings such as SACCO name, currency, and fiscal year start month.

`users`

Stores officials and staff SACCO profiles. Firebase Auth owns the login identity; `users.firebase_uid` links that Firebase account to local role, status, audit, and ownership records. `users.is_active` is the server-side account switch for disabling a SACCO profile without deleting the Firebase user.

`members`

Stores member identity, status, registration date, contact details, and future notes. Member balances are not trusted from this table; balances come from ledger/account tables.

`routes`

Stores route metadata that can be shared across many vehicles.

`vehicles`

Stores plate number, owner/member link, route link, capacity, driver details, and fleet status.

`mpesa_tills`

Defines known tills and their default accounting treatment:

```text
VehicleTill  -> 8249102 -> DailyContribution
UtilityTill  -> 4810294 -> ManagementFee
```

Daraja sandbox shortcode `600000` is test-only runtime config, not production reference data.

## Ledger And Payments

`ledger_entries`

The source table for all official financial movement. Important controls:

- `transaction_type`: `Credit` or `Debit`.
- `account_type`: accounting category.
- `till_type`: `VehicleTill`, `UtilityTill`, or `None`.
- `amount`: positive `NUMERIC(14,2)`.
- `reference_code`: unique when present.
- `status`: `Posted`, `Reversed`, `Void`, or `PendingReview`.
- `reversal_of`: points to the original entry when correcting a posted transaction.

`mpesa_payments`

Stores every Daraja C2B payment callback with raw payload and reconciliation state. `trans_id` is unique to prevent duplicate posting. A payment can link to one ledger entry once reconciled.

`daily_vehicle_records`

Keeps operational daily summaries per vehicle. This should be generated or reconciled from ledger entries rather than treated as the first source of financial truth.

## Member Accounts

`savings_accounts`

Cached member savings balances. Rebuild from ledger history when auditing.

`share_accounts`

Cached member share balances. Rebuild from ledger history when auditing.

`loans`

Loan principal, interest rate, due date, status, approval, and notes.

`loan_repayments`

Repayment records linked back to both a loan and a ledger entry.

## Expenses

`expenses`

Structured expense records linked to debit ledger entries. This gives reporting better expense categories while preserving ledger-first accounting.

## Reporting And Closing

`monthly_closings`

Locked month-end financial snapshots. Closed months should not be rewritten by normal entry screens.

`monthly_closing_lines`

Totals by account type for a closed month.

## Audit

`audit_logs`

Append-only activity log for create, update, reversal, reconciliation, login, import, approval, and closing events.

Recommended action names:

```text
USER_LOGIN
MEMBER_CREATED
VEHICLE_CREATED
LEDGER_ENTRY_POSTED
LEDGER_ENTRY_REVERSED
MPESA_CALLBACK_RECEIVED
MPESA_PAYMENT_RECONCILED
MONTH_CLOSED
CONFIG_UPDATED
```

## Views

`v_member_financial_balances`

Computes member shares, savings, credits, and debits from posted ledger rows.

`v_daily_till_summary`

Computes daily totals by till and account type.

`v_unreconciled_mpesa_payments`

Lists pending and unmatched M-Pesa payments for the reconciliation queue.

## Indexing Strategy

The initial migration indexes:

- Ledger date, member, vehicle, account type, till type, status, reference code.
- M-Pesa status, bill reference, transaction time, till type.
- Daily vehicle date.
- Loans by member.
- Audit logs by actor and entity.

Add more indexes only after slow-query evidence.

## Recommended Migration Order

```text
001_initial_schema.sql
002_seed_reference_data.sql
003_add_row_level_security.sql
004_add_reporting_functions.sql
005_backfill_legacy_data.sql
006_enforce_not_null_after_backfill.sql
```

## Production Safety Rules

- Backup before every production migration.
- Run migrations against a restored copy first.
- Add nullable columns before backfilling.
- Backfill in batches for large tables.
- Add `NOT NULL` and stricter constraints only after validation.
- Use reversals for posted money movement.
- Never store Daraja consumer secrets, JWT secrets, or service account JSON in tables.
- Never store Firebase passwords or refresh tokens in tables.
- Keep `.env`, deployment secrets, and CI secrets outside git.
