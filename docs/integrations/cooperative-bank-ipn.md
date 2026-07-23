# Co-operative Bank Core Banking IPN

## Architecture

```text
Co-operative Bank HTTPS callback
  -> TOKEN/BASIC authentication
  -> JSON, field, date, decimal, and account validation
  -> PostgreSQL immutable event + idempotency constraint
  -> immediate HTTP 200
  -> deferred leased processor
  -> CREDIT matching / DEBIT ignore / unknown quarantine
  -> authorized manual allocation
  -> atomic canonical ledger entry + bank-event link + audit
```

The callback runs in Express and does not depend on a browser. `POST /api/integrations/coop/ipn` is canonical; `/api/webhooks/coop-bank/b2b-ipn` remains a compatibility alias. Both accept only JSON bodies up to 64 KB. A successful new or duplicate notification returns:

```json
{ "MessageCode": "2XX", "Message": "Successfully received data" }
```

`COOP_IPN_SUCCESS_MESSAGE_CODE` can be changed to `200` if the bank confirms that requirement.

## Configuration

Keep credentials in the deployment secret store, never in frontend variables or Git.

```dotenv
APP_URL="https://your-stable-domain.example"
COOP_IPN_ENABLED=true
COOP_IPN_AUTH_MODE=TOKEN
COOP_IPN_TOKEN="long-random-agreed-secret"
COOP_IPN_TOKEN_HEADER="authorization"
COOP_IPN_TOKEN_SCHEME="Bearer"
COOP_ALLOWED_ACCOUNT_NUMBERS="01134248358600"
COOP_IPN_SUCCESS_MESSAGE_CODE=2XX
COOP_OBSERVE_ONLY=true
COOP_AUTO_POSTING_ENABLED=false
```

For Basic authentication use `COOP_IPN_AUTH_MODE=BASIC`, `COOP_IPN_BASIC_USERNAME`, and `COOP_IPN_BASIC_PASSWORD`. The supplied document does not define which header or prefix TOKEN mode uses, so `COOP_IPN_TOKEN_HEADER` and `COOP_IPN_TOKEN_SCHEME` are configurable and must be confirmed during bank onboarding. An empty scheme sends the configured token as the complete header value. Missing credentials or accounts fail closed at startup. Legacy `COOP_B2B_*` names are read only to avoid breaking an existing deployment; new deployments should use `COOP_*`.

Production ingress must be HTTPS. Set `TRUST_PROXY=true` only behind one trusted reverse proxy; otherwise forwarded protocol headers are not trusted. Do not enable IP allowlisting unless Co-operative Bank supplies official outbound addresses.

## Supplied bank-document conformance

The local `B2B IPN_2023.docx` was audited directly. Its filename says 2023, but its internal revision history lists version 1.0 from 6 June 2019 and version 1.1 from 19 February 2020. The implementation maps its relevant contract as follows:

| Document detail | Implementation |
| --- | --- |
| REST callback using `POST` | Express-only `POST /api/integrations/coop/ipn`; other methods return 405. |
| `Content-Type` and `Accept: application/json` | Requests must be JSON; Express replies with JSON. Malformed JSON is controlled. |
| `AcctNo` | Required string, normalized without losing the raw payload, and checked against the configured account allowlist. |
| `Amount` | Required positive exact decimal stored in PostgreSQL `NUMERIC(14,2)` without floating-point ledger arithmetic. |
| `BookedBalance`, `ClearedBalance` | Optional exact two-decimal values retained in normalized columns and raw payload. |
| `Currency` | Required uppercase three-letter code; the source value remains in the immutable raw payload. |
| `CustMemoLine1`, `CustMemoLine2`, `CustMemoLine3` | Optional strings retained and evaluated in documented order after `PaymentRef` for exact matching. |
| `EventType` | Required, case-normalized; CREDIT is matchable, DEBIT is retained as `IGNORED_DEBIT`, other values are quarantined. |
| `ExchangeRate` | Optional exact decimal supporting up to eight decimal places. |
| `Narration` | Optional string retained and used only as the last exact-reference source. |
| `PaymentRef` | Retained as the payment reference and highest-priority match source, but not used alone for event idempotency. |
| `PostingDate`, `ValueDate`, `TransactionDate` | Optional validated bank date strings including the documented `YYYY-MM-DD+03:00` form. |
| `TransactionId` | Required and used with provider `COOP_BANK` for database-enforced idempotency. |
| TOKEN or Basic authentication | Both supported with constant-time secret comparisons and server-only configuration. |
| HTTPS in production, unsecured test allowed | Production rejects non-secure requests; development permits local HTTP. |
| HTTP/message success 200 or 201 and sample `2XX` | Callback returns HTTP 200 and configurable `MessageCode`, defaulting to the documented `2XX`. |
| Non-2XX failure and redelivery | Validation/authentication/persistence failures return non-2XX; valid duplicates return 200 without duplicate effects. |

The sample request's cookie, cache, connection, compression, host, port, and content-length lines are illustrative HTTP client metadata, not fields the application should require. The source sentence describing the maximum redelivery count is incomplete, so the application deliberately does not invent a bank retry limit.

Current public Co-operative Bank pages confirm that [B2B Integration sends electronic notifications for reconciliation](https://www.co-opbank.co.ke/corporate/agri-business/) and that [Co-op Connect offers an Instant Transaction Notification Service](https://www.co-opbank.co.ke/corporate/education-health-financial-services/). They do not publish the detailed callback credentials, token header, response-code interpretation, or retry schedule; the bank onboarding team must confirm those details.

## Data and status lifecycle

Migration `010_coop_bank_ipn_pipeline.sql` extends `coop_bank_ipn_events`, adds `coop_bank_event_audit`, exact constraints and indexes, and makes `raw_payload` immutable. `database/rollbacks/010_coop_bank_ipn_pipeline.down.sql` removes the added metadata without deleting existing bank events.

The idempotency key is `COOP_BANK:` plus normalized `TransactionId`. The database enforces both this key and `(provider, transaction_id)`. Duplicate deliveries increment only an operational counter and cannot create another event or ledger entry.

Processing states are `RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`, or `QUARANTINED` (with `VALIDATED` reserved). Reconciliation states are `NOT_EVALUATED`, `UNMATCHED`, `AMBIGUOUS`, `IGNORED_DEBIT`, `PENDING_ALLOCATION`, `POSTED`, and `MANUALLY_RECONCILED` (with `MATCHED` reserved).

- CREDIT events use exact member number, member ID, registered phone, or vehicle plate references in PaymentRef, memo fields, then narration.
- Multiple member matches are `AMBIGUOUS`; none are `UNMATCHED`.
- An exact member match remains `PENDING_ALLOCATION` because the bank does not determine a SACCO ledger category.
- DEBIT events are `IGNORED_DEBIT` and never reduce member balances.
- Unsupported event types are retained as `QUARANTINED`.
- Amount alone is never a match signal and bank data never creates members.

## Observe-only and manual reconciliation

Keep `COOP_OBSERVE_ONLY=true` during onboarding. The application may store, classify, match, and display events but refuses all ledger posting. `COOP_AUTO_POSTING_ENABLED=false` is also the default; no automatic posting path is enabled because the current ledger requires an explicit allocation category.

When controlled manual posting is approved, set observe-only to false and restart. Chairman, Treasurer, and Accountant roles with `payments.reconcile` can select an active member and category. The server locks the event, verifies it is an unposted CREDIT, creates one canonical `COOP_BANK_IPN` ledger entry, links it to the event, and records the actor and decision in one database transaction. A second or stale confirmation returns `409`.

Only the Chairman may fetch protected raw payloads. Ordinary members cannot list events, read configuration, view payloads, reprocess, quarantine, or reconcile.

## Simulator

Start the development server, configure test-only credentials, then run:

```bash
npm run simulate:coop-ipn -- --fixture valid-credit --token your-local-token
npm run simulate:coop-ipn -- --fixture valid-debit --token your-local-token
npm run simulate:coop-ipn -- --fixture duplicate-credit --token your-local-token
```

Optional flags include `--url`, `--auth BASIC`, `--username`, `--password`, `--token-header`, `--token-scheme`, `--account`, `--transaction`, `--reference`, `--amount`, `--event`, `--narration`, and `--memo1`. Fixtures also cover unmatched and ambiguous references, missing transaction ID, invalid amount, wrong account, invalid token, and unsupported event type. The simulator refuses to run with `NODE_ENV=production` and contains no real credential.

## Deployment and activation

1. Back up PostgreSQL, deploy the application, and run `npm run db:migrate`.
2. Configure a stable always-on HTTPS host, database connectivity, secrets, logs, and health monitoring.
3. Keep observe-only true and automatic posting false; verify `/api/health` and the authenticated Banking page.
4. Through the authorized SACCO/bank onboarding process, provide the HTTPS URL and agreed credentials. Do not send them from this application.
5. Ask for one small controlled CREDIT. Verify account, amount, TransactionId, PaymentRef, narration/memos, visibility, and duplicate behavior. Confirm no ledger entry exists.
6. Record where the real member reference appears and tighten deterministic matching if necessary.
7. Test manual allocation with SACCO approval before disabling observe-only.
8. Enable automatic posting only after a documented deterministic category rule exists; the current application intentionally has none.

Operational counts in the Banking page show received-today, duplicates, unmatched, ambiguous, pending allocation, posted, failed, quarantined, and last callback time. Monitor callback errors, database availability, old unresolved events, and secret rotation.

## Bank confirmations still required

- Whether `MessageCode` must be `2XX` or `200`.
- The final authentication mode and credential-delivery process.
- The exact TOKEN header name and scheme/prefix, if TOKEN is selected.
- The production callback URL and allowed account numbers.
- The exact real-payload location and format of member references.
- Retry schedule, timeout, and retention expectations.

These are external onboarding facts and are deliberately configurable rather than guessed.
