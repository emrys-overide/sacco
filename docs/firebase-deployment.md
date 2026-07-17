# Firebase deployment runbook

## What this project actually is

- Front end: React 19 with Vite 6.
- Browser build command: `npm run build:client`.
- Firebase Hosting folder: `dist/client`.
- Backend: Express with PostgreSQL, server-side JWT authorization, Firebase Admin compatibility, and Co-operative Bank IPN endpoints.
- Function build command: `npm run build:functions`.
- Function output: `functions/lib/index.cjs`.

The browser and backend outputs are deliberately separated. `dist/server.cjs`
and its source map must never be placed in the Hosting public directory.

## Important architecture boundary

This repository is ready for Firebase Hosting and second-generation Firebase
Functions, but it is not a Firestore-only application. Production startup,
password authentication, member linking, ledger operations, and the bank IPN
inbox currently require PostgreSQL. The existing Firestore adapter is incomplete
and intentionally rejected in production.

Firestore stays server-only. Officials and members access data through
`/api/**`, where the Express access-control layer checks roles and the trusted
`linkedMemberId`. `firestore.rules` denies every browser read and write. This is
the correct rule for the current architecture because the browser session is a
SACCO JWT, which Firestore Security Rules cannot validate. A Firestore-only
migration must be designed and tested separately before this boundary changes.

## Firebase resources

- Hosting serves the SPA and rewrites `/api/**` to `saccoApi`.
- `saccoApi` is a second-generation Node.js 22 HTTPS Function in
  `africa-south1`.
- `processPendingCoopBankEvents` runs every minute and retries durable bank inbox
  work. It does nothing while `COOP_IPN_ENABLED=false`.
- The HTTPS Function keeps one warm instance for callback reliability and caps
  scale at three instances to limit PostgreSQL connections. This has a cost.
- The API and Hosting release use a pinned function tag so a Hosting rollback
  also rolls back the API revision paired with that release.

## Values you add manually

Do not create or download a service-account JSON key. Firebase Functions uses
its attached service account and Application Default Credentials.

1. Copy `functions/.env.example` to `functions/.env` and replace only the
   non-sensitive values such as `APP_URL`. The file is ignored by Git.
2. In Secret Manager, create one JSON secret named
   `SACCO_RUNTIME_SECRETS`. It must contain `DATABASE_URL` and `JWT_SECRET`.
3. Add only the optional keys for features you enable:
   `TOTP_ENCRYPTION_KEY`, `FIREBASE_WEB_API_KEY`, `MEMBER_OTP_PEPPER`,
   `MEMBER_OTP_DELIVERY_WEBHOOK_URL`, `MEMBER_OTP_DELIVERY_AUTHORIZATION`,
   `COOP_IPN_TOKEN`, `COOP_IPN_BASIC_USERNAME`, `COOP_IPN_BASIC_PASSWORD`, and
   `COOP_ALLOWED_ACCOUNT_NUMBERS`.
4. Do not put those values in `.env`, source control, command arguments, build
   logs, screenshots, or support messages.

The safest CLI entry method is the interactive prompt, which avoids placing the
secret in shell history:

```bash
DEBUG= npx firebase-tools@15.24.0 functions:secrets:set SACCO_RUNTIME_SECRETS
```

Paste a valid JSON object at the private prompt. Alternatively, create the
secret in Google Cloud Console > Security > Secret Manager and grant the
Functions runtime service account Secret Manager Secret Accessor only for this
secret.

The `DEBUG=` prefix deliberately clears generic debug logging for each Firebase
CLI process so it cannot dump inherited environment variables into a debug log.

The Vite `VITE_FIREBASE_*` values in the root `.env.example` are public browser
configuration, not server credentials. The current normal login UI does not
need them; keep `VITE_FIREBASE_AUTH_ENABLED=false` unless the legacy Firebase
email-verification flow is intentionally re-enabled.

## Manual console setup

1. Select or create the Firebase project and upgrade it to Blaze. Function
   deployment, a warm instance, Secret Manager, and Cloud Scheduler require
   billing.
2. In Firestore, confirm that the existing named database
   `ai-studio-matatusaccomanag-cd852607-4b11-4562-8401-e653d5fca910` belongs to
   the selected project. If deploying to a new project, decide whether to create
   that named database or change `firebase.json` to the new database ID before
   deploying rules.
3. Keep Firestore in the same region as the Functions where possible. The
   selected Functions region is Johannesburg (`africa-south1`).
4. Ensure the production PostgreSQL service accepts TLS connections from the
   Functions runtime and has migrations `001` through `010` applied. Restrict
   network access as tightly as the database provider supports.
5. Enable Cloud Functions, Cloud Build, Artifact Registry, Secret Manager, and
   Cloud Scheduler APIs when prompted. Do not manually edit the scheduler job
   created by Firebase.
6. If legacy Firebase email authentication will be used, enable Email/Password
   in Authentication and add the Hosting/custom domain under Authorized
   domains.
7. Configure a billing budget alert and log-based alerts for function errors,
   repeated 5xx responses, and bank callback failures.
8. Keep `COOP_IPN_ENABLED=false`, `COOP_OBSERVE_ONLY=true`, and
   `COOP_AUTO_POSTING_ENABLED=false` for the first deployment.

## First deployment

Run these from the repository root:

```bash
npm ci
npm --prefix functions ci
DEBUG= npx firebase-tools@15.24.0 login
DEBUG= npx firebase-tools@15.24.0 use --add
cp functions/.env.example functions/.env
```

Edit `functions/.env` with non-sensitive values only. Add
`SACCO_RUNTIME_SECRETS` through the interactive command above, then validate and
deploy:

```bash
npm run lint
npm test
npm run test:firestore-rules
npm run firebase:prepare
DEBUG= npx firebase-tools@15.24.0 deploy --only firestore:rules,firestore:indexes,functions,hosting
```

Do not deploy from an unreviewed dirty worktree. For a production rollout,
commit and tag the exact source first. Use a separate Firebase project,
PostgreSQL database, and secret for staging; a Hosting preview channel that
points at production APIs is not an isolated test.

## Post-deploy testing checklist

- Open `https://PROJECT_ID.web.app` and confirm the SPA loads on a hard refresh
  and on a nested route.
- Request `/api/health`; require HTTP 200, `status: ok`, and
  `database: postgres_configured`.
- Confirm `/server.cjs`, `/server.cjs.map`, `.env`, and source files return 404
  or the SPA without exposing backend content.
- On an empty database, confirm first-Chairman setup is visible; after creation,
  confirm it is hidden and the bootstrap endpoint refuses another Chairman.
- Test official login, member login, invalid password, disabled account, and
  expired/invalid bearer tokens.
- Confirm a member can read only their linked member portal data and cannot read
  all members, users, vehicles, transactions, payments, or bank events.
- Confirm an authorized official can perform only the permissions assigned to
  their role.
- In Firestore Rules Playground or the emulator, verify anonymous, member, and
  official browser reads and writes are all denied.
- With the bank endpoint disabled, require a fail-closed response. In staging,
  test missing/incorrect authentication, an unauthorized account, one valid
  observe-only event, and the same event twice; confirm only one inbox event and
  an incremented duplicate count.
- Confirm the scheduled processor exists, has no repeated failures, and can
  recover a deliberately failed staging inbox item.
- Check function logs for secrets, full account numbers, passwords, tokens, or
  raw authorization headers. None should appear.
- Check Firebase Hosting response headers: `index.html` is not cached and hashed
  `/assets/**` files are immutable.
- Watch function latency, cold starts, instance count, PostgreSQL connections,
  4xx/5xx rates, and billing for at least one normal operating cycle.

## Rollback plan

1. Stop risky traffic first: set `COOP_IPN_ENABLED=false` in
   `functions/.env`, redeploy Functions, and keep the durable inbox intact.
2. In Firebase Console > Hosting > Release history, roll back to the last known
   good release. The pinned `saccoApi` revision rolls back with it.
3. Redeploy the previous Git tag to roll back the scheduled function and rules:

   ```bash
   git switch --detach LAST_KNOWN_GOOD_TAG
   npm ci
   npm --prefix functions ci
   npm run firebase:prepare
   DEBUG= npx firebase-tools@15.24.0 deploy --only functions,firestore:rules,firestore:indexes,hosting
   ```

4. If a secret rotation caused the incident, enable the prior Secret Manager
   version and redeploy the functions that bind it. Never print the old value.
5. Restore PostgreSQL only from a verified backup and only for data corruption.
   Do not automatically reverse financial migrations or delete bank inbox rows.
   Prefer a forward fix or the reviewed migration rollback in
   `database/rollbacks/`.
6. Repeat `/api/health`, login, member-scope, ledger, and bank idempotency tests
   after rollback and record the release/version IDs used.
