# Developer error log

The application records unexpected server failures and authenticated browser
runtime errors in the Supabase/PostgreSQL `application_error_logs` table. This
is an operational debugging aid, not an accounting or member report.

## Enable access

Set this secret environment variable on the deployed Node service, then restart
or redeploy it:

```dotenv
DEVELOPER_ERROR_LOG_EMAILS="your-developer-login@example.com,second-developer@example.com"
```

Only an active logged-in SACCO account whose email exactly matches this
comma-separated allow-list can see **Developer Errors** in the sidebar or use
the diagnostics API. Leaving it blank keeps the page disabled for everyone.

## What is collected

- Timestamp, source (server or browser), severity, response status and request
  identifier.
- HTTP method and path without query parameters.
- Error code, message, sanitized stack trace, and small browser context.
- The logged-in reporter for authenticated browser errors.

Passwords, access tokens, cookies, API keys, request bodies, bank payloads and
query strings are not intentionally stored. Common credential-like strings are
redacted before persistence. Do not paste secrets into resolution notes.

## Using the page

Open **Developer Errors**, inspect the error message, request ID and sanitized
stack trace, reproduce/fix the issue, then add an optional short resolution
note and mark the entry resolved. Resolved entries remain available when
**Show resolved entries** is selected.

The page does not replace Render/Supabase platform logs or alerting. Check those
services too when the application cannot start or the database is unavailable.
