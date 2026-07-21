# SACCO Production Database Schema

This document defines the relational database contract for Sowetamu Sacco. The target database is PostgreSQL or Supabase PostgreSQL.

The executable migrations live in:

```text
database/migrations/001_initial_schema.sql
database/migrations/002_seed_reference_data.sql
database/migrations/008_coop_bank_b2b_ipn.sql
```

## Design Principles

- `ledger_entries` is the financial source of truth.
- Co-op Bank B2B events first land in `coop_bank_ipn_events`; they remain pending review until an authorised officer reconciles them.
- Posted ledger entries are never edited silently. Corrections use reversal entries.
- Money is stored as `NUMERIC(14,2)`, never floating point.
- Raw bank event payloads are retained as `JSONB` for traceability and are never returned to the browser.
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
coop_bank_ipn_events ──0..1 ledger_entries
loans ──< loan_repayments
monthly_closings ──< monthly_closing_lines
```

## Core Tables

`schema_migrations`

Tracks migrations applied outside a framework such as Prisma, Knex, or Supabase CLI. Each SQL file inserts its version when applied.

`sacco_settings`

Stores non-secret tenant settings such as SACCO name, currency, and fiscal year start month.

`users`

Stores officials, staff, and member SACCO profiles. PostgreSQL/Supabase owns the account, role, password hash, status, audit, and ownership link. `users.is_active` is the server-side switch for disabling access. The nullable legacy identity column is retained only so older database imports remain non-destructive; application code no longer uses it for authentication.

`members`

Stores member identity, status, registration date, contact details, and future notes. Member balances are not trusted from this table; balances come from ledger/account tables.

`routes`

Stores route metadata that can be shared across many vehicles.

`vehicles`

Stores plate number, owner/member link, route link, capacity, driver details, and fleet status.

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

`coop_bank_ipn_events`

Stores every authenticated Co-op Bank B2B account event with its raw payload and reconciliation state. `transaction_id` is unique to prevent duplicate receipt. Events are not automatically posted: an authorised officer must explicitly reconcile a reviewed event before it can link to a ledger entry. Credit and debit events are both retained for review.

`mpesa_payments` and `mpesa_tills`

Legacy compatibility tables for prior records only. No live Daraja endpoint writes to them.

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
COOP_BANK_EVENT_RECEIVED
COOP_BANK_EVENT_RECONCILED
MONTH_CLOSED
CONFIG_UPDATED
```

## Views

`v_member_financial_balances`

Computes member shares, savings, credits, and debits from posted ledger rows.

`v_daily_till_summary`

Computes daily totals by till and account type.

`coop_bank_ipn_events` filtered by `status = 'PendingReview'`

Lists bank events awaiting reconciliation review.

## Indexing Strategy

The initial migration indexes:

- Ledger date, member, vehicle, account type, till type, status, reference code.
- Bank event status, transaction ID, account number, event type, and received time.
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
008_coop_bank_b2b_ipn.sql
```

## Production Safety Rules

- Backup before every production migration.
- Run migrations against a restored copy first.
- Add nullable columns before backfilling.
- Backfill in batches for large tables.
- Add `NOT NULL` and stricter constraints only after validation.
- Use reversals for posted money movement.
- Never store Co-op Bank webhook credentials, JWT secrets, or service account JSON in tables.
- Never store passwords or session tokens in tables outside approved password hashes.
- Keep `.env`, deployment secrets, and CI secrets outside git.
