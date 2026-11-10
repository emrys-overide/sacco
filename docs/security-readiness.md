# Security readiness for a closed SACCO user group

## Current assessment

The application is **conditionally suitable for a small closed group of known
SACCO members and officers** when it is deployed with the production settings
below. It is not yet a formally audited banking platform, a legal compliance
certification, or a substitute for organisational controls.

The system protects records at the application level: users must sign in, the
server re-checks role permissions for each protected request, and a Member is
scoped to their own record. A closed group should also be closed at the network
and identity level; a public Render URL alone is not an internal-company access
boundary.

## Controls already implemented

- Signed bearer sessions with issuer, audience, expiry, account-status, and
  role validation on protected requests.
- One-hour server-side inactivity timeout and default eight-hour token expiry.
- Login throttling: ten failed attempts lock that identity/IP combination for
  fifteen minutes.
- Server-side role permissions and member ownership checks; menus are not used
  as the security control.
- Chairman-only member/officer password reset approval, plus a narrowly scoped
  Secretary-only Chairman-recovery approval; both force replacement of
  temporary passwords and are audit-logged.
- Optional authenticator-app verification for officers.
- Parameterized PostgreSQL queries, input validation, request-body size limit,
  malformed JSON handling, security headers, anti-framing, and no-store API
  responses.
- Audit records and a restricted Developer Errors page in PostgreSQL
  deployments.
- Browser access never receives the Supabase connection string or service key.

## Evidence from the automated checks

Run the standard suite with `npm test`, the focused bounded concurrency suite,
and the isolated red-team regression checks with:

```sh
npm run test:stress
npm run test:red-team
```

The stress suite starts an isolated application and verifies, in parallel:

- 24 simultaneous registrations for one member create exactly one account;
- 120 normal member/health requests remain successful and member ID data stays
  masked;
- 30 reset requests create only one pending reset and one Chairman reminder;
- 100 unauthorised or malformed-token calls remain denied;
- malformed and oversized JSON are rejected safely; and
- concurrent bad logins activate the rate limit and also block a later correct
  password until the lock expires.

This is a bounded application stress test. It is not a production load test,
external penetration test, or assurance that Render/Supabase capacity will meet
future traffic levels.

The red-team checks attempt forged role claims, cross-member identifier access,
privileged request bodies, protected bank and developer endpoints, injection-
like login values, malformed JSON, and reset-account discovery. They confirm
that these attempts are denied or return the same privacy-safe response. They
are automated adversarial regression tests, not an independent external
penetration-test certification.

## Required before using real member financial data

1. Set production secrets only in Render/Supabase secret settings. Use a unique
   long `JWT_SECRET`; leave `ALLOW_DEV_AUTH_FALLBACK`, `ALLOW_DEV_JWT_AUTH`,
   and `ALLOW_IN_MEMORY_DB` set to `false`.
2. Set `APP_URL` to the real HTTPS address and set `TRUST_PROXY=true` only when
   Render is the trusted TLS proxy.
3. Set `OFFICER_TOTP_REQUIRED=true` and give each officer their own account.
   Never share Chairman credentials.
4. Restrict the production URL with a VPN, company identity gateway, or reverse
   proxy/IP allow-list if the application is genuinely for internal users only.
   This network restriction is not currently built into the application.
5. Keep the active member register accurate. Current self-registration matches
   name, phone, and email against that register; it is not a replacement for
   in-person identity verification. Use the Chairman reset process for member
   account recovery and review suspicious registrations. Agree and document the
   Secretary's in-person identity-verification process for the exceptional
   Chairman recovery flow.
6. Follow the backup and restore routine in
   [Free-tier operations](./free-tier-operations.md), and keep Co-op Bank IPN
   disabled while using a sleeping free web service.
7. Before a broader rollout or payment integration, arrange an independent
   security review/penetration test and complete the SACCO's legal, privacy,
   and data-retention review.

## Remaining risk level

For a small closed group with the required deployment controls, the residual
risk is **moderate**: the code has practical access, validation, and session
controls, but it relies on people protecting passwords, the hosting
configuration being correct, and the member registry being trustworthy. The
risk becomes **high** if the application is publicly reachable without an
identity perimeter, shared officer accounts are used, production secrets are
weak, developer settings are enabled, or bank callbacks are enabled on free
hosting.
