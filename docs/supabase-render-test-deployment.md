# Zero-cost Supabase + Render test deployment

Supabase hosts PostgreSQL; one Render Node service hosts both the React PWA and the Express API.
The browser never receives a Supabase database key or connection string.

Configured Supabase project:

- Project reference: `kbelzjdvqfprppqkjypi`
- Project API URL: `https://kbelzjdvqfprppqkjypi.supabase.co`

The API URL is public project metadata, not the PostgreSQL connection string.
Render still needs the private URI from **Connect → Session pooler** in its
`DATABASE_URL` secret. Never commit that URI because it contains the database
password.

## Test-only reliability boundary

Render's free web service sleeps after inactivity and may take about one minute
to wake. Supabase may pause an inactive free project. This is acceptable for a
human-reviewed test, but not for a live bank callback. Keep `COOP_IPN_ENABLED`
and automatic posting disabled on the free test deployment.

## 1. Create the free Supabase database

1. Create one free Supabase project in the region closest to the SACCO.
2. In **Connect**, copy the **Session pooler** connection string on port 5432.
   A persistent Render Node process should not use the transaction-mode port
   6543. URL-encode special characters in the password.
3. Enable SSL enforcement in Supabase.
4. Keep the connection string private. It belongs only in Render's secret
   environment settings and your private local `.env`.

## 2. Apply the schema

From a trusted machine with the private connection string in `DATABASE_URL`:

```bash
DATABASE_SSL=true npm run db:migrate
DATABASE_SSL=true npm run db:status
```

Apply migrations `001` through `017` before starting the application. Migration
`011` enables row-level security and removes Supabase browser-role access from
every application table; the browser continues to use only the Express API. Never
run the reference seed migration against real SACCO data without reviewing it.

## 3. Deploy the free test service

1. Push this branch to GitHub.
2. In Render, choose **New > Blueprint** and select this repository.
3. Render reads `render.yaml`.
4. Enter `DATABASE_URL` as a secret and set `APP_URL` to the Render HTTPS URL.
5. Deploy and require `/api/health` to report `postgres_configured`.

The generated `JWT_SECRET` must not be replaced casually: changing it signs all
users out.

## 4. Security acceptance tests

- Confirm the first Chairman can be created only once.
- Create two distinct members and link one login to each.
- Confirm member A cannot request member B's profile, vehicles, transactions,
  reports, users, payments, or bank inbox events.
- Confirm a Member cannot access `/api/members`, `/api/users`,
  `/api/transactions`, `/api/payments`, or official reports.
- Confirm an Auditor cannot mutate a ledger entry.
- Confirm all `/api/**` responses carry `Cache-Control: no-store`.
- Disconnect the network and confirm the PWA shows the offline notice and never
  displays or accepts cached financial data.
- Keep all Co-op Bank switches off throughout the free-host test.

## 5. Install the PWA

On Android Chrome, open the HTTPS URL and select **Install app**. On desktop
Chrome or Edge, use the install icon in the address bar. The in-app install
notice appears when the browser exposes its installation prompt.

The service worker caches only public application assets and the offline page.
It excludes API calls, authentication, navigation HTML, cross-origin requests,
and all non-GET operations.

## Moving beyond the test

Before enabling Co-op Bank IPN, move the Node service to an always-on plan,
enable Supabase backups, rotate production secrets, configure the confirmed bank
authentication fields, and repeat the complete callback/idempotency test plan.
