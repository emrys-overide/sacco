# In-app workflow notifications

Notifications are stored privately in Supabase/PostgreSQL and shown through the
bell icon after the user signs in. They are not emails, SMS messages, browser
push notifications, or public alerts. While the person is connected to the
application, a secure live stream delivers new items immediately, similar to an
open WhatsApp conversation. If the network, browser, or Render service drops,
the application reconnects automatically and the 30-second refresh catches any
item missed while it was disconnected.

The notification itself is durable: signing out, refreshing the page, or
missing a live item does not delete it. It is read only when the recipient opens
the item or chooses **Mark all read**. An optional browser alert can be enabled
while the app is open; it is not a background/mobile push notification and is
therefore not delivered while the user is offline or has fully closed the app.

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
