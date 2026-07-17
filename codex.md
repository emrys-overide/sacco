# SACCO authentication and member access control

## Default authentication flow

```text
MEMBER
registered full name + registered phone + registered email + new password
        -> server locks and matches one active members row
        -> users profile with password_hash and linked_member_id
        -> phone/email + password login
        -> signed SACCO session
        -> member-scoped portal

OFFICER
Chairman-created profile + phone/email + password
        -> signed SACCO session
        -> role-scoped dashboard
```

Firebase is not required by the default account flow. Optional officer TOTP is available only when `OFFICER_TOTP_REQUIRED=true`; the safe, simpler default is password authentication plus server-enforced authorization.

## Security boundaries

- `POST /api/auth/member-registration` validates full name, phone, and email against the same active member row inside a database transaction. It creates or migrates exactly one Member profile and never accepts a client-selected `memberId`.
- `POST /api/auth/login` accepts phone or email for members and officers, validates the PostgreSQL password hash, account status, role, and member link, then issues a signed, expiring JWT.
- The first Chairman can be created only while the server confirms that no admin exists. Hiding the UI link is not the security control.
- The Chairman provisions officer roles and can reset active account passwords through authenticated `users.write` routes. Passwords are stored only as PostgreSQL `crypt` hashes.
- Roles and member scope always come from `users`, never from browser state. Members cannot read bank events, other members' records, reconciliation routes, or administration endpoints.
- For Member requests, the API ignores requested member IDs and uses `users.linked_member_id` for members, vehicles, payments, transactions, loans, totals, and `/api/member-portal`.
- Bank callback authentication is entirely separate from human login. Co-op credentials never enter browser bundles or database rows.

## Endpoint contract

| Purpose | Endpoint | Result |
| --- | --- | --- |
| Member account creation | `POST /api/auth/member-registration` | Matches one active member and creates a linked local password profile. |
| Shared login | `POST /api/auth/login` | Returns a SACCO JWT, or an optional TOTP challenge when configured. |
| Optional TOTP | `POST /api/auth/totp/verify` | Completes an explicitly enabled officer TOTP challenge. |
| First Chairman | `POST /api/auth/bootstrap` | Available only until an administrator exists. |
| Officer creation | `POST /api/users` | Chairman-only role-scoped account provisioning. |
| Password reset | `POST /api/users/:id/password` | Chairman resets an active member or officer password; action is audited. |

## Production configuration

```dotenv
DATABASE_URL=postgresql://...
JWT_SECRET=a-long-random-secret-at-least-32-bytes
PASSWORD_AUTH_ENABLED=true
OFFICER_TOTP_REQUIRED=false
```

If TOTP is later enabled, also set a 32-byte `TOTP_ENCRYPTION_KEY`. Legacy migration `009` and Firebase compatibility routes may remain while existing identities are moved, but the current browser flow does not depend on them.

## Verification

```text
npm run db:migrate
npm run lint
npm test
npm run build
git diff --check
```
