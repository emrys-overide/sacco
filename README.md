# Matatu SACCO Management System

A full-stack financial operations app for members, vehicles, daily collections, M-Pesa reconciliation, and ledger reporting.

## Local Setup

Prerequisites: Node.js and Docker. SACCO sessions use server-side password
authentication; officers also use Google Authenticator (TOTP).

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and configure `DATABASE_URL`, `JWT_SECRET`,
   `TOTP_ENCRYPTION_KEY`, and the SMS delivery secrets.
3. Run `npm run db:up`. This creates the local PostgreSQL container and applies pending migrations.
4. Start the app with `npm run dev`.

Member flow: a Member signs in with registered phone and password. A new Member
account and forgotten Member password use an SMS OTP sent only to the phone in
the SACCO register. Chairman, Treasurer, and Secretary (plus existing Auditor
and Accountant roles) sign in with password then Google Authenticator.

Configure `MEMBER_OTP_PEPPER` and the trusted HTTPS
`MEMBER_OTP_DELIVERY_WEBHOOK_URL` for SMS OTP. The delivery service receives
`{ to, code, expiresInSeconds, purpose }`; do not use a client-side SMS
provider or log the code. Generate the 32-byte TOTP encryption key with
`openssl rand -base64 32`.

Database commands:

- `npm run db:status` shows container and migration status.
- `npm run db:migrate` applies new migrations without recreating the database.
- `npm run db:down` stops PostgreSQL while preserving its Docker volume.

For disposable local work without PostgreSQL, explicitly set
`ALLOW_IN_MEMORY_DB=true`, a strong `JWT_SECRET`, and a valid
`TOTP_ENCRYPTION_KEY`. In-memory records are erased whenever the server
restarts and must never be used in production.

## Checks

- `npm run lint` validates TypeScript contracts.
- `npm test` runs authentication and ledger policy tests.
- `npm run build` creates the production client and server bundles.

Production requests fail closed when persistent storage is unavailable. The browser does not keep SACCO bearer tokens in application-managed local storage, and posted PostgreSQL ledger entries are corrected through reversals rather than mutation.

Member accounts are read-only and must be linked to a single `members.id` record by the backend. `codex.md` documents the access-control migration, deployment checklist, permission matrix, and rollback process.
