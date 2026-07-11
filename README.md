# Matatu SACCO Management System

A full-stack financial operations app for members, vehicles, daily collections, M-Pesa reconciliation, and ledger reporting.

## Local Setup

Prerequisites: Node.js and Docker. Firebase Authentication is the normal identity provider.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and configure `DATABASE_URL` plus the Firebase server and browser values.
3. Run `npm run db:up`. This creates the local PostgreSQL container and applies pending migrations.
4. Start the app with `npm run dev`.

Database commands:

- `npm run db:status` shows container and migration status.
- `npm run db:migrate` applies new migrations without recreating the database.
- `npm run db:down` stops PostgreSQL while preserving its Docker volume.

For disposable local work without PostgreSQL, explicitly set `ALLOW_IN_MEMORY_DB=true`, `ALLOW_DEV_AUTH_FALLBACK=true`, `ALLOW_DEV_JWT_AUTH=true`, and a strong `JWT_SECRET`. In-memory records are erased whenever the server restarts and must never be used in production.

## Checks

- `npm run lint` validates TypeScript contracts.
- `npm test` runs authentication and ledger policy tests.
- `npm run build` creates the production client and server bundles.

Production requests fail closed when persistent storage is unavailable. The browser does not keep SACCO bearer tokens in application-managed local storage, and posted PostgreSQL ledger entries are corrected through reversals rather than mutation.
