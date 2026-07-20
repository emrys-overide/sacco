# Sowetamu Sacco

A full-stack financial operations app for members, vehicles, daily collections, Co-operative Bank event reconciliation, and ledger reporting.

## Local setup

Prerequisites: Node.js and Docker.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and configure `DATABASE_URL` and a long random `JWT_SECRET`.
3. Run `npm run db:up` to start PostgreSQL and apply migrations.
4. Run `npm run dev`.

The first-Chairman setup link appears only while no administrator exists. After that, members and officers share one login screen and use a phone/email plus password. Member account creation succeeds only when the submitted full name, phone, and email match one active `members` row; the server creates a password profile linked to that `members.id`. Roles and member scope are enforced on every API request.

The Chairman creates officer accounts and resets member/officer passwords from **Account Access**. Optional officer TOTP can be enabled later with `OFFICER_TOTP_REQUIRED=true`; it is off by default.

Member password recovery uses a one-time six-digit code sent to the email already recorded on the member profile. Configure the `SMTP_*`, `EMAIL_FROM`, and `MEMBER_OTP_PEPPER` variables shown in `.env.example`. A Chairman reset creates a 24-hour temporary password which must be replaced before the account can use functional APIs.

Loans use an ordered, server-enforced workflow: member application → Secretary eligibility review → Treasurer financial review → Chairman final approval. The Chairman controls the interest rate and eligibility policy in **Loans**. Interest supplied by a browser is ignored; the active server-side policy is used. Repayments are attached to a specific loan and automatically clear it at zero balance.

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

## Zero-cost test deployment and PWA

Use a free Supabase PostgreSQL project and the included free Render Blueprint
(`render.yaml`) to host the React
PWA and Express API together. See
[`docs/supabase-render-test-deployment.md`](docs/supabase-render-test-deployment.md).
This free path is for acceptance testing because the web service can sleep and
must not receive live Co-op Bank callbacks. Android Chrome and desktop Chrome or
Edge can install the HTTPS deployment; financial API data is always network-only
and is never stored by the service worker.
