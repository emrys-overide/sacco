# In-app workflow notifications

Notifications are stored privately in Supabase/PostgreSQL and shown through the
bell icon after the user signs in. They are not emails, SMS messages, browser
push notifications, or public alerts. The bell refreshes every 30 seconds, and
an unread badge remains visible until the person opens or marks the item read.

## Reminders currently enabled

| Event | Recipient | Destination |
| --- | --- | --- |
| Member requests a password reset | Every active Chairman | Account Access |
| Chairman approves a reset | The requesting Member | My Account |
| Member submits a loan | Every active Secretary | Loans |
| Secretary clears a loan for financial review | Every active Treasurer | Loans |
| Treasurer clears a loan for final decision | Every active Chairman | Loans |
| Secretary, Treasurer, or Chairman rejects a loan | The Member | My Account |
| Chairman approves a loan | The Member | My Account |

These reminders are durable: signing out, refreshing the page, or missing a
notification does not delete it. They are read only when the recipient opens
the item or chooses **Mark all read**.
