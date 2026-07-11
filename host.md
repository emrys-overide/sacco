# No-Card Pilot Hosting Plan

## Summary

Deploy the Vite frontend and API on Cloudflare Workers with Static Assets, retain Firebase Authentication,
and move PostgreSQL to Supabase Free. This avoids container cold starts and preserves the existing
PostgreSQL service code through Cloudflare Hyperdrive.

Use a durable M-Pesa ingestion path:

Safaricom callback → Cloudflare Worker → D1 inbox + Queue → Supabase ledger

The browser being offline will not affect payment capture. When Supabase is unavailable, callbacks remain in
D1 and are retried automatically; opening the app can also trigger an immediate retry.

## Free-Tier Requirements

- Cloudflare account:
  - Workers: 100,000 requests/day and 10 ms CPU/request.
  - Static assets: free and unlimited requests.
  - Hyperdrive: 100,000 database queries/day.
  - D1: 5 million rows read/day, 100,000 rows written/day, 5 GB storage.
  - Queues: 10,000 operations/day with 24-hour message retention. (Workers
    (https://developers.cloudflare.com/workers/platform/pricing/), D1
    (https://developers.cloudflare.com/d1/platform/pricing/), Queues
    (https://developers.cloudflare.com/queues/platform/pricing/))

- Supabase Free account:
  - Two active projects, 500 MB database limit, 5 GB egress.
  - Free projects may pause after roughly one week of insufficient activity.
  - No production SLA or managed backup guarantee. (Supabase billing
    (https://supabase.com/docs/guides/platform/billing-on-supabase), project pausing
    (https://supabase.com/docs/guides/platform/free-project-pausing))

- Existing Firebase Spark project:
  - Enable Email/Password Authentication.
  - Add the deployed Cloudflare domain to Authorized Domains.
  - Spark supports approximately 3,000 daily active users for common providers; email limits include 150
    password resets/day and 1,000 verification emails/day. (Firebase Auth limits
    (https://firebase.google.com/docs/auth/limits))

- Safaricom Daraja sandbox or production credentials and permission to register public HTTPS callback URLs.
- Node.js 22+, npm, Wrangler CLI, GitHub repository, and a stable workers.dev hostname. A custom domain is
  optional.

## Implementation Changes

- Replace the Express-only routing layer with a Worker-compatible Hono router while preserving current /api/
  * request and response contracts.

- Keep the Node Express entry point for local Docker development, sharing authentication, ledger, payment,
  and PostgreSQL services between both runtimes.

- Use pg through a Hyperdrive binding connected to Supabase’s session pooler on port 5432; retain atomic
  PostgreSQL transactions, unique references, reversals, and reconciliation safeguards.

- Replace Firebase Admin middleware in the Worker with Firebase ID-token verification using Google’s public
  Secure Token keys, validating issuer, audience, expiry, UID, active SACCO profile, and database role.

- Add Worker bindings:
  - HYPERDRIVE for Supabase PostgreSQL.
  - MPESA_INBOX D1 database.
  - MPESA_QUEUE and MPESA_DLQ.
  - Secrets for Daraja credentials; Firebase client values remain build-time public configuration.

- Add D1 mpesa_callback_inbox with unique trans_id, raw payload, received time, status, attempts, last
  error, and synchronization timestamps.

- On each M-Pesa callback:
  - Validate required fields and amount.
  - Insert idempotently into D1 before acknowledging Safaricom.
  - Enqueue the transaction ID.
  - Return the same success response for duplicate callbacks.

- Queue consumers process callbacks into Supabase using the existing atomic payment-and-ledger operation.
  Failed messages use exponential retry and a dead-letter queue.

- Add a scheduled Worker that scans unsynchronized D1 records and requeues them. Queue expiry must never
  lose a payment because D1 remains the durable inbox.

- Add authenticated endpoints:
  - GET /api/system/sync-status for pending, failed, and last-synchronized callback counts.
  - POST /api/payments/sync for Chairman, Treasurer, and Accountant roles to request immediate requeueing.

- Retain unsynchronized D1 records indefinitely and synchronized receipts for 90 days; Supabase remains the
  authoritative permanent ledger and raw callback archive.

- Build the Vite application as Worker static assets with SPA fallback and API-first routing. Add
  dev:worker, build:worker, deploy:worker, and remote migration commands.

- Configure workers.dev as the initial public hostname, update APP_URL and Daraja callback URLs, then
  register:
  - /api/daraja/c2b-validation
  - /api/daraja/c2b-confirmation

- Add a documented encrypted pg_dump command. For the pilot, run it daily and before every migration because
  Supabase Free is not an adequate sole backup for financial records.

## Test And Acceptance Plan

- Run typecheck, unit tests, Worker build, and existing Node build.
- Verify Firebase sign-in, token expiry, disabled profiles, and every backend role restriction.
- Apply migrations to an empty Supabase project and verify members, vehicles, ledger entries, reversals,
  derived balances, and reports.

- Submit duplicate M-Pesa callbacks and confirm one payment record and one ledger posting.
- Simulate Supabase failure, confirm the callback is acknowledged and retained in D1, restore Supabase,
  trigger scheduled/manual sync, and confirm exactly-once financial posting.

- Verify pending/dead-letter visibility and retry controls.
  registration.

- Monitor Worker, Queue, D1, Hyperdrive, Supabase storage, and egress quotas during the pilot.

## Assumptions

- The current local PostgreSQL database is empty, so only schema and seed migrations are required; no
  operational data import is needed.

- The deployment is a small pilot, not the final system of record.
- Free tiers provide no uptime SLA. If the pilot becomes operationally dependent on live M-Pesa and official
  accounting, move Supabase and Workers to paid plans with automated backups and alerting.

- Cloudflare is the application host; Firebase is retained for authentication rather than Firebase Hosting
  because backend hosting on Firebase requires Blaze billing. (Firebase Cloud Run integration
  (https://firebase.google.com/docs/hosting/cloud-run))
