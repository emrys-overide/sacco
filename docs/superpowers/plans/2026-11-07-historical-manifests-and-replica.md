# Implementation Plan: Isolated & Editable 2025 Historical Manifest Archive + Automated Database Replica

## 1. Problem Statement & User Requirements
1. **Isolated & Dedicated Feature**:
   - The user requested an isolated feature for 2025 daily collections.
   - It must **not** interact with the active operational system or alter current totals, balances, or KPIs on the dashboard.
   - The sheets must be **editable** (allow editing plates, fee breakdowns, expenses, adding/deleting rows, and persisting changes).
2. **Crash-Proof Database Replica**:
   - Provide an automated replica database in case the primary Supabase / Render database crashes or goes offline.
   - Replicate both active tables and historical archives to a standalone local/standby database with one-click failover verification.

---

## 2. Proposed Architecture & Component Design

### A. Dedicated Historical Schema (Migration `031_historical_manifests.sql`)
- `historical_manifest_days`: Date, nissan_total, sienta_total, gross_total, total_expenses, net_vault_inflow, notes.
- `historical_manifest_entries`: id, record_date, fleet ('Nissan'/'Sienta'), row_no, plate_number, operation, entrance, loan_repay, savings, s_ticket, legal_fee, total_amount.
- `historical_manifest_expenses`: id, record_date, item_no, description, amount.
- **Zero interaction** with `ledger_entries`, `members`, or `vehicles`.

### B. Backend API Endpoints (`server.ts`)
- `GET /api/historical-manifests/dates`: Lists all 365 available dates with daily summary metrics.
- `GET /api/historical-manifests/day/:date`: Returns `{ day, nissanRows, sientaRows, expenses }`.
- `PUT /api/historical-manifests/day/:date`: Transactionally updates row entries and expenses, recalculating day totals.
- `POST /api/historical-manifests/seed`: Ingests the 2025 manifest dataset into the dedicated tables.

### C. Frontend Interface (`HistoricalManifestView.tsx`)
- Integrated into `src/components/Sidebar.tsx` as **"Historical Archives"**.
- Date picker / quick jump across all 365 operating days of 2025.
- Editable dual-grid tables:
  - Nissan Grid (Operation, Entrance, Loan, Savings, ST Ticket, Legal, Total).
  - Sienta Grid (Operation, Entrance, Loan, Savings, Legal, Total).
  - Stage Deductions / Route Expenses Ledger.
- End-of-Page Reconciliation Box with Net Sacco Vault Inflow.
- Editable cell inputs with dirty state detection, Save button, and Revert button.

### D. Automated Replica Database (`scripts/replicate-database.mjs`)
- Standalone SQLite replica: `database/replica/sacco_replica.db`.
- Replicates all live PostgreSQL tables (`members`, `vehicles`, `ledger_entries`, `routes`, `users`, `loans`, etc.) AND the historical manifest tables.
- Creates point-in-time timestamped snapshots.
- Includes `scripts/verify-replica-failover.mjs` verifying offline queryability.

---

## 3. Step-by-Step Execution Tasks

- [ ] **Task 1: Database Migration `031_historical_manifests.sql`**
  - Create table definitions with indices and foreign key cascades.
  - Apply migration to live PostgreSQL on Supabase.
- [ ] **Task 2: Ingest 2025 Data into Dedicated Tables**
  - Populate all 365 days, 16,911 collection rows, and 356 expense rows into `historical_manifest_*`.
  - Verify that `ledger_entries` remains at exactly 3,421 rows (zero contamination).
- [ ] **Task 3: Backend REST Endpoints in `server.ts`**
  - Implement `GET /api/historical-manifests/dates`.
  - Implement `GET /api/historical-manifests/day/:date`.
  - Implement `PUT /api/historical-manifests/day/:date` for saving edits.
- [ ] **Task 4: Build `HistoricalManifestView.tsx` Component**
  - Implement the dual-grid layout, editable inputs, row addition/deletion, auto-sum calculations, and save handler.
  - Wire navigation in `Sidebar.tsx` and `App.tsx`.
- [ ] **Task 5: Database Replica Engine & Failover Verification**
  - Author `scripts/replicate-database.mjs` to mirror live PostgreSQL tables into SQLite replica `database/replica/sacco_replica.db`.
  - Author `scripts/verify-replica-failover.mjs` to test offline recovery.
- [ ] **Task 6: Verification & Delivery**
  - Verify TypeScript compilation (`npm run lint`).
  - Verify Vite build (`npm run build`).
  - Verify test suite passes (`npm test`).
  - Commit and push to `agent/coop-bank-b2b-ipn`.
