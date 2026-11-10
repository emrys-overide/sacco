# Month-end closing

Only the Chairman may close a completed past month through
`POST /api/monthly-closings` with `{ "closingMonth": "YYYY-MM", "notes": "..." }`.
The server snapshots posted credits, debits, cash/bank totals, and account-type
lines in one transaction, then blocks ordinary edits, reversals, and new ledger
entries dated in that closed month.

Before closing, reconcile bank events, resolve duplicate or unmatched payments,
check ledger references, and export the internal operational report. A closing
is an internal accounting control, **not** an auditor's certification or a
regulatory filing. Correct a genuine closed-period error with a documented,
Chairman-authorised corrective process; do not silently change the snapshot.
