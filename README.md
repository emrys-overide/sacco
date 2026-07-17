# Matatu SACCO Management System

A full-stack financial operations app for members, vehicles, daily collections, Co-operative Bank event reconciliation, and ledger reporting.

## Local setup

Prerequisites: Node.js and Docker.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and configure `DATABASE_URL` and a long random `JWT_SECRET`.
3. Run `npm run db:up` to start PostgreSQL and apply migrations.
4. Run `npm run dev`.

The first-Chairman setup link appears only while no administrator exists. After that, members and officers share one login screen and use a phone/email plus password. Member account creation succeeds only when the submitted full name, phone, and email match one active `members` row; the server creates a password profile linked to that `members.id`. Roles and member scope are enforced on every API request.

The Chairman creates officer accounts and resets member/officer passwords from **Account Access**. Optional officer TOTP can be enabled later with `OFFICER_TOTP_REQUIRED=true`; it is off by default. Legacy Firebase routes remain only for migration compatibility and are not required by the normal UI.

Database commands:

- `npm run db:status` shows container and migration status.
- `npm run db:migrate` applies pending migrations.
- `npm run db:down` stops PostgreSQL while preserving its Docker volume.

For disposable development without PostgreSQL, set `ALLOW_IN_MEMORY_DB=true`. In-memory data is erased on restart and must never be used in production.

## Co-operative Bank IPN

The backend callback is `POST /api/integrations/coop/ipn`. Configure it using the `COOP_*` values in `.env.example`. Safe defaults keep the endpoint disabled, reconciliation in observe-only mode, and automatic posting off. See [docs/integrations/cooperative-bank-ipn.md](docs/integrations/cooperative-bank-ipn.md) for authentication, simulation, deployment, and activation instructions.

## Checks

- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

Production requests fail closed when persistent storage is unavailable. Raw bank payloads and integration credentials remain server-side. Posted PostgreSQL ledger entries are corrected through reversals rather than mutation.
