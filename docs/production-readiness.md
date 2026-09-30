# Production readiness plan — Sacco Ledger OS

**Review date:** 2026-09-30  
**Estimated readiness:** 30% (static code review; financial correctness and deployment unverified)

## What exists

React dashboard and Express API for members, vehicles, ledger transactions, payments, reports, Firebase authentication, Firestore access, PostgreSQL schema drafts, and Daraja integration.

## Completed on this branch

- Changed Firestore rules from public read/write to deny all direct client access. The server-side Firestore SDK remains the intended access path.

## Release blockers, in order

1. **Access control:** Remove hard-coded role passwords and legacy authentication headers from any production path. Make Firebase token verification and active server-side role lookup mandatory. Review first-admin bootstrap for race conditions and restrict it to verified identity.
2. **Durable ledger:** Disable silent fallback to in-memory storage in production; database outages must fail visibly and preserve existing balances. Choose one production source of truth (PostgreSQL or Firestore), complete migrations, and rehearse backup/restore.
3. **Financial invariants:** Use database transactions for ledger posting, member balance updates, reversals and payment reconciliation. Enforce unique external transaction references and idempotent Daraja callbacks at the database layer. Reconcile end-of-day totals against provider statements.
4. **Webhook trust:** Authenticate/verify M-Pesa notifications where possible, validate amount/shortcode/reference, and quarantine unmatched payments. Limit sensitive setup actions to Treasurer/Chairman.
5. **Coverage and deployment:** Add automated role-matrix, bootstrap, reconciliation, reversal, duplicate callback and outage tests. Run build/typecheck in CI. Set deployment secrets, monitoring, audit retention, disaster recovery and role approval procedures.
6. **Documentation:** Replace the AI Studio starter README with actual deployment instructions, required environment variables, migration order, operational runbook and known limitations.

## Exit criteria

- No unauthenticated browser can read or write ledger records.
- A database outage cannot switch the live ledger to memory or acknowledge a payment without durable recording.
- Independent reconciliation and restore tests pass; admins approve role policies and production Daraja setup.
