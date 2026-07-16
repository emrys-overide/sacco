# SACCO authentication and member access control

## Implemented authentication flow

```text
MEMBER
registered phone + password
        -> normal SACCO session

new member account
registered phone -> SMS OTP -> choose password -> normal SACCO session

forgot member password
registered phone -> SMS OTP -> choose password -> normal SACCO session

CHAIRMAN / TREASURER / SECRETARY
registered email or phone + password
        -> Google Authenticator TOTP
        -> SACCO session
```

The same password-plus-TOTP policy also covers the existing Auditor and
Accountant officer roles. A username (email or phone) is required for every
officer account so the server can identify which password and TOTP secret it
must verify; the role is always derived from the server-side `users` record.

Member registration is intentionally limited to an *unlinked, active member
record whose registered phone receives the SMS*. A person cannot use the
"new member" flow to replace an existing member's phone. Phone-number changes
must be performed by an authorized SACCO officer after identity checks.

## Security boundaries

- Password hashes use PostgreSQL `crypt(..., gen_salt('bf'))`; plaintext
  passwords are never persisted or returned.
- Member SMS codes are random six-digit values, HMAC-hashed with
  `MEMBER_OTP_PEPPER`, valid for 10 minutes, single-use, limited to five
  attempts, and rate-limited. Request responses are generic, preventing phone
  and membership enumeration.
- Google Authenticator secrets are Base32 keys stored only as AES-256-GCM
  ciphertext, encrypted with `TOTP_ENCRYPTION_KEY`. A provisioning key/URI is
  returned only while an officer is enrolling the authenticator.
- Every officer password login creates a separate five-minute, one-time,
  attempt-limited TOTP challenge. A password alone never creates an officer
  session.
- Sessions are signed HMAC JWTs with a bounded expiry (`JWT_EXPIRES_SECONDS`).
  The API resolves the current user by token subject on every request, so
  disabled or unlinked accounts cannot keep using an old session.
- Firebase token sessions are not accepted by the SACCO API. This prevents a
  legacy identity session from bypassing password or officer TOTP checks.

## Endpoint contract

| Purpose | Endpoint | Result |
| --- | --- | --- |
| Password login | `POST /api/auth/login` | Member returns a session; officer returns a TOTP challenge. |
| Officer enrollment/login TOTP | `POST /api/auth/totp/verify` | Returns a session only after a valid authenticator code. |
| First Chairman setup | `POST /api/auth/bootstrap` | Creates only the first account, then returns a TOTP enrollment challenge. |
| Officer provisioning | `POST /api/users` | Chairman-only; creates an officer password account that enrolls TOTP on first login. |
| New member SMS request | `POST /api/member-activation/request` | Always returns a generic response. |
| New member confirmation | `POST /api/member-activation/verify` | Verifies OTP, creates the linked Member account and returns a session. |
| Member reset SMS request | `POST /api/auth/member-password-reset/request` | Always returns a generic response. |
| Member reset confirmation | `POST /api/auth/member-password-reset/verify` | Verifies OTP and replaces the password hash. |

## Role and data scope

`src/server/accessControl.ts` remains the source of truth for authorization.
The backend, not the browser, derives a user role and member link:

```text
password/TOTP or SMS proof -> users.id -> users.role + users.linked_member_id
```

| Role | Scope |
| --- | --- |
| Chairman | SACCO-wide administration and finance. |
| Secretary | Member/fleet administration and reports. |
| Treasurer | Financial operations, Co-op Bank B2B event review, reconciliation, reports. |
| Accountant | Financial records and reconciliation. |
| Auditor | Read/report-only access. |
| Member | Read-only personal portal and owned vehicle financial records only. |

For a Member, the API ignores a requested member ID or query filter and uses
the trusted `linked_member_id`. This scopes members, vehicles, ledger entries,
payments, loans, totals, and `/api/member-portal` before information is sent
to the browser. Members cannot read users, post ledger entries, assign drivers,
or reconcile payments.

## Database changes

Migration `006_member_access_control.sql` added the user-to-member link,
account states, OTP challenge table, and driver assignment history.

Migration `007_password_and_totp_auth.sql` adds:

- nullable email for phone-only Member accounts;
- encrypted TOTP secret and enrollment timestamp on `users`;
- `Activation` and `PasswordReset` OTP purposes;
- one-time officer TOTP challenge records.

Run migrations with a PostgreSQL backup in place:

```bash
npm run db:migrate
npm run db:status
```

## Required production configuration

Set these only in the host secret store, never in the browser:

```dotenv
DATABASE_URL=postgresql://...
JWT_SECRET=a-long-random-secret-at-least-32-bytes
TOTP_ENCRYPTION_KEY=base64-encoded-32-byte-key
TOTP_ISSUER="Matatu SACCO"
MEMBER_OTP_PEPPER=a-long-random-secret-at-least-32-bytes
MEMBER_OTP_DELIVERY_WEBHOOK_URL=https://trusted-sms-provider.example/send
PASSWORD_AUTH_ENABLED=true
```

Generate the TOTP encryption key with:

```bash
openssl rand -base64 32
```

The SMS delivery webhook receives `{ to, code, expiresInSeconds, purpose }`.
It must use HTTPS, avoid logging message content, and be monitored for delivery
failure. Removing the OTP secrets safely disables member activation/reset; it
does not expose existing accounts.

## Verification completed

```text
npm run lint
npm test
npm run build
git diff --check
```

The automated end-to-end flow verifies first-Chairman TOTP enrollment and
repeat TOTP login, as well as Member scoped access. TOTP helper tests verify
bounded time-window validation and a standard Google Authenticator URI.
