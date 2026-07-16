# Co-op Bank B2B Hosting Plan

## Objective

Deploy a durable HTTPS endpoint for Co-operative Bank Core Banking B2B Event Notifications without reintroducing Safaricom Daraja. The bank sends account credit/debit events to the application; the application stores each event once and exposes it to authorised SACCO staff for review.

```
Co-op Bank B2B notification → HTTPS application endpoint → PostgreSQL durable inbox → staff review/reconciliation
```

The B2B endpoint is not a member SMS service and it does not automatically post money to a member ledger. In particular, debit events must never become income automatically, and a credit must be reviewed before it is reconciled with a member or transaction.

## Production Requirements

- A stable public HTTPS URL registered with Co-op Bank:
  `https://your-domain.example/api/webhooks/coop-bank/b2b-ipn`
- PostgreSQL with migration `008_coop_bank_b2b_ipn.sql` applied before the bank enables notifications.
- A long random shared Bearer token, or Basic credentials if Co-op Bank requires that method. Store all values in the host secret manager, never in the frontend.
- `COOP_B2B_ALLOWED_ACCOUNT_NUMBERS` set to the full authorised Co-op account number(s), comma separated.
- `COOP_B2B_IPN_CURRENCY=KES` unless Co-op Bank explicitly agrees otherwise.
- Monitoring for endpoint errors, duplicate-event rates, unreconciled-event age, and database availability.

Co-op Bank treats a `200` or `201` response as successful delivery. The app responds `201` when a new transaction ID is persisted and `200` when a repeated notification is safely deduplicated. Authentication, validation, and configuration failures deliberately return a non-success response so the bank’s retry/operations process can be used.

## Required Secrets

```dotenv
APP_URL="https://your-domain.example"
DATABASE_URL="postgresql://..."
JWT_SECRET="..."
TOTP_ENCRYPTION_KEY="..."
COOP_B2B_IPN_AUTH_MODE="token"
COOP_B2B_IPN_TOKEN="long-random-shared-secret"
COOP_B2B_ALLOWED_ACCOUNT_NUMBERS="your-full-authorised-account-number"
COOP_B2B_IPN_CURRENCY="KES"
```

For a Basic-auth integration, set `COOP_B2B_IPN_AUTH_MODE="basic"` and supply the two `COOP_B2B_IPN_BASIC_*` secrets instead of the token. Confirm the exact authentication method with Co-op Bank during onboarding.

## Deployment Sequence

1. Host the Node application and PostgreSQL on infrastructure that remains reachable continuously; do not use a sleep-to-zero free tier for the bank callback.
2. Deploy the application and run `npm run db:migrate`.
3. Configure the secrets and restart the application.
4. Confirm the authenticated staff page, **Banking**, reports that webhook authentication and at least one allowed account are configured.
5. Give Co-op Bank the production HTTPS callback URL and the agreed authentication details through their approved onboarding process.
6. Ask the bank to send a controlled test notification. Verify the event appears once as `PendingReview`, has the correct transaction ID, amount, account number, and event type, and that no ledger entry was created automatically.
7. Establish the SACCO’s written process for matching a reviewed credit to a member contribution and handling debit/reversal events.

## Acceptance Tests

- A request without valid endpoint credentials is rejected.
- A valid credit event for an allowed account returns `201` and is visible only to staff with payment-reading permission.
- Repeating the same `TransactionId` returns `200` and leaves one durable inbox record.
- An event for an unlisted account is rejected and creates no inbox record.
- A member session cannot read the Banking configuration or B2B events.
- A database migration and application restart preserve all received events.

## Operational Notes

- Keep raw bank payloads server-side for audit evidence; never return them to the browser.
- Rotate the webhook secret through an agreed change window with Co-op Bank; support the old and new credential only if a deliberate transition plan is implemented.
- Back up PostgreSQL before migrations and monitor pending events daily.
- Historical `mpesa_*` tables remain only for existing data compatibility. No Daraja route, credential, registration, simulation, or automatic payment-posting path is active.
