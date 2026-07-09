# SACCO Production Database Schema Plan

This document defines a production-ready relational database schema for the Matatu SACCO management system. It is designed for PostgreSQL/Supabase or any SQL database with minor syntax adjustments.

## 1. Design Goals

The database must support:

- Member, vehicle, and route management
- Role-based users: Chairman, Secretary, Treasurer, Auditor, Accountant, Member
- Daily ledger transactions
- M-Pesa/Daraja C2B payment callbacks
- Manual cash/voucher entries
- Payment reconciliation
- Loans, savings, shares, penalties, and expenses
- OCR-imported historical book records
- Monthly and yearly reports
- Audit trail for accountability
- Safe future migrations without data loss

## 2. Core Entity Relationship Summary

```text
users ──< audit_logs
users ──< ledger_entries
members ──< vehicles
members ──< loans
members ──< savings_accounts
members ──< share_accounts
members ──< ledger_entries
vehicles ──< ledger_entries
vehicles ──< daily_vehicle_records
mpesa_payments ──0..1── ledger_entries
loans ──< loan_repayments
ocr_import_batches ──< ocr_import_rows
monthly_closings ──< monthly_closing_lines
```

## 3. Production Schema

The implementation SQL is stored in:

```text
database/migrations/001_initial_schema.sql
```

## 4. Migration Plan

### Phase 1: Foundation

1. Create database extensions.
2. Create enum types.
3. Create `users`, `members`, `routes`, and `vehicles`.
4. Seed official SACCO roles/admins separately from production migrations.
5. Keep mock/demo data out of production.

### Phase 2: Ledger Core

1. Create `ledger_entries`.
2. Create `daily_vehicle_records`.
3. Add indexes for date, member, vehicle, reference code, and account type.
4. Move manual ledger forms to write to `ledger_entries` first.
5. Generate daily vehicle totals from ledger entries, not the other way around.

### Phase 3: Daraja/M-Pesa

1. Create `mpesa_payments`.
2. Store every Daraja callback raw payload.
3. Deduplicate by `trans_id`.
4. Reconcile payment to member or vehicle using account reference, phone, or manual assignment.
5. Create a linked `ledger_entries` row only after validation.

### Phase 4: Loans, Savings, Shares

1. Create `loans`, `loan_repayments`, `savings_accounts`, and `share_accounts`.
2. Link repayments to ledger entries.
3. Recalculate member balances from ledger history periodically.
4. Keep account balances as cached summaries, not the sole source of truth.

### Phase 5: OCR Historical Records

1. Create `ocr_import_batches` and `ocr_import_rows`.
2. Store raw OCR JSON for traceability.
3. Require review before OCR rows become official ledger entries.
4. Keep confidence score and reviewer notes.

### Phase 6: Reporting and Closing

1. Create `monthly_closings` and `monthly_closing_lines`.
2. Lock months after approval.
3. Generate monthly/yearly PDF and Excel reports from closing records.
4. Add reversal entries instead of editing closed months directly.

### Phase 7: Audit and Security

1. Create `audit_logs`.
2. Log create/update/delete/reversal/reconciliation events.
3. Remove hard-coded role security keys.
4. Move secrets to environment variables.
5. Add row-level security if using Supabase.

## 5. Rules for Safe Migrations

- Never delete columns immediately. Deprecate first, migrate data, then remove later.
- Never use floating point for money. Use `NUMERIC(14,2)`.
- Never overwrite Daraja callback payloads. Store raw JSON permanently.
- Never edit posted ledger entries silently. Use reversal entries.
- Always test migrations on a copy of production data.
- Always backup before production migrations.

## 6. Recommended Migration File Order

```text
001_initial_schema.sql
002_seed_initial_roles.sql
003_add_row_level_security.sql
004_add_reporting_views.sql
005_add_ledger_balance_functions.sql
```

## 7. Key Architectural Decision

`ledger_entries` is the source of truth for financial movement. Summary tables such as `daily_vehicle_records`, savings balances, share balances, and monthly closings are derived or locked snapshots.

Daraja callbacks first land in `mpesa_payments`. They become official ledger entries only after reconciliation.

OCR output first lands in `ocr_import_batches` and `ocr_import_rows`. It becomes official financial data only after human review.
