# Free-tier operating model: Supabase and Render

This is a temporary, cost-conscious operating model for the SACCO while usage
is small. It keeps the database persistent in Supabase and accepts that the
Render application wakes on demand. It is not suitable for bank callbacks,
time-sensitive background jobs, or guaranteed instant delivery to people who
are not online.

## What users should expect

- A free Render web service spins down after **15 minutes without an inbound
  HTTP request or WebSocket message**. The first request after that wakes it;
  Render says this usually takes about one minute.
- A user whose browser is open and online keeps the live notification stream
  active. When they return after the service slept, the application reconnects
  and reloads durable notifications from Supabase. The first reconnection may
  be delayed by the cold start.
- The current free deployment is a single web-service instance. Before scaling
  to multiple instances, add a shared realtime broadcast service; an in-memory
  live connection list cannot deliver an event from one instance to a browser
  connected to another.
- The sleep does not erase Supabase records and does not remove notifications,
  loans, transactions, or password-reset requests. It does delay the first
  request, live notification connection, web form submission, and bank callback
  that arrives after the service is asleep.
- Render's local disk is not storage. Do not save receipts, backups, uploads,
  or operational data only on the web service filesystem.

## Daily/weekly operator routine

1. Before an officer begins work, open the site and wait for it to wake. Do not
   resubmit a form just because the first load takes longer than usual.
2. Keep the normal SACCO browser tab open during active work. Live notifications
   are intentionally online-only; the bell will reconnect after a short network
   interruption.
3. Check the private Developer Errors page and Render logs weekly.
4. Keep Co-op Bank IPN disabled until the SACCO moves to an always-on service.
   A sleeping host can delay a bank callback and a free service is the wrong
   place for a time-sensitive payment integration.

## Supabase Free backup routine

Supabase Free does not include automatic downloadable backups or point-in-time
recovery. Make an encrypted backup from a trusted administrator computer at
least weekly and before migrations or major data cleanup.

1. Install PostgreSQL client tools so `pg_dump` and `pg_restore` are available.
2. Put the production Supabase connection string in `DATABASE_URL` and set
   `DATABASE_SSL=true` if it is not already included in the URL.
3. Run:

   ```sh
   npm run db:backup
   ```

4. The custom-format dump and a credential-free manifest appear in `.backups/`.
   Copy both to encrypted, SACCO-controlled storage. `.backups/` is ignored by
   Git and must not be treated as the only copy.

## Monthly restore rehearsal

Never restore a backup into production to test it. Create a separate,
disposable Supabase project or database, then run this only after verifying the
target is not production:

```sh
BACKUP_FILE=.backups/sacco-postgres-YYYY-MM-DDTHH-MM-SS-sssZ.dump \
RESTORE_DATABASE_URL='postgresql://...' \
RESTORE_TARGET_LABEL=restore-drill \
CONFIRM_RESTORE_TO_NON_PRODUCTION=RESTORE_TEST \
npm run db:restore-test
```

The command deliberately refuses to run unless all of the safeguards above are
present and rejects a target matching `DATABASE_URL`. It uses `pg_restore
--clean`, so the named target must be disposable. After it completes, sign in
to that target and check member data, receipts, loan data, notifications, and
the Chairman password-reset workflow. Record the date, person, backup file,
and result in the SACCO operations log.

## Upgrade trigger

Move to paid, always-on hosting before enabling production payment callbacks,
introducing strict response-time commitments, or relying on alerts for urgent
operational decisions. Also upgrade Supabase before the Free database limit,
backup requirements, or inactivity pauses become a business risk.

## Official references

- [Render Free web services](https://render.com/docs/free)
- [Render WebSocket reliability](https://render.com/docs/websocket)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
