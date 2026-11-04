# PiggyVest daily reconciliation

A read-only daily check. It emails the owner a report and raises a page when
anything is wrong. It resends, settles and releases nothing.

## What it checks

1. **Stuck transfers.** Every savings transfer still `reserved` or `dispatched`
   longer than 30 minutes, counted from when the money was reserved (a re-drive
   does not restart the clock). Each dispatched one is looked up at PiggyVest with
   the existing transfer status reader (the same reference, amount and wallet
   binding as the settlement path; a 404 is never read as "absent"). The report
   shows what PiggyVest says: completed, pending, failed, not listed, or
   unconfirmed.
2. **Balances.** For every goal wallet we confirmed principal into, the balance
   at PiggyVest against the principal we recorded. Less at PiggyVest pages (after
   a confirming re-read). More is listed for review and the email subject says
   REVIEW instead of all clear, because interest accrues there. A surplus never
   pages, however large: the recorded figure is principal only, so interest
   would page forever. It is an email REVIEW line only.

   The database snapshot is read first and the PiggyVest balances afterwards, so
   they can differ by a few minutes. A provider-side debit in that window could
   look like a shortfall; check a flagged wallet again before acting.

   The same skew applies to the stuck list: it is the state at snapshot time. A
   transfer may have settled or been released since, so the email says "at
   snapshot time" and the local record should be checked before acting on a
   "needs settling" or "needs releasing" line.
3. **Could not run.** A missing configuration, an unreadable database answer,
   or a balance that cannot be read pages. A run is never reported clean unless
   it completed.

4. **Too slow.** The route has 300 seconds. Provider reads stop starting after
   200 seconds; anything not yet read is reported as unchecked (a transfer as
   unconfirmed, a balance as unreadable) and the email says time ran out. The
   report and page therefore always go out, even when PiggyVest hangs.

5. **Large books.** One read returns at most 500 wallets and 200 stuck
   transfers, but not always the same ones. The window moves by one page each
   UTC day and wraps, so every wallet is checked within ceil(wallets / 500)
   days. The stuck list is best effort: the set of stuck transfers changes
   between runs, so a page can shift against it and some detail may stay
   unlisted for a while. Every stuck transfer is still counted in the total and
   still pages.
   The email says how many were left out of today's window. Wallets left out do
   not page, because later runs cover them; stuck transfers left out still page
   (any stuck transfer pages). Indexes on the savings, cancel and complete operation tables keep
   both reads inside the 2.5 second statement timeout.

The page is the existing `piggyvest_money_alert` event with code
`PIGGYVEST_RECONCILIATION_MISMATCH` (see `piggyvest-money-alerts.md`). It also
pages if the report email cannot be sent.

## Switches and settings (owner, production)

| Name | Meaning |
| --- | --- |
| `PIGGYVEST_RECONCILIATION_ENABLED` | Must be exactly `true`. Anything else: the route answers `disabled` and does nothing. |
| `PIGGYVEST_RECONCILIATION_REPORT_EMAIL` | Owner address the report is sent to. Missing or invalid pages instead. |

A balance below the record is read a second time (within the read budget) before it pages; it pages only if the shortfall persists. Report dates are UTC.

The email goes out through the platform ZeptoMail token (`ZEPTOMAIL_TOKEN`) with
a single attempt; a failed send pages. It reuses the `PIGGYVEST_PRIMARY_*` settings and the evidence database login.
It runs even when the savings flags are off and even when the master kill switch
(`PIGGYVEST_KILL_SWITCH`) is engaged or mistyped: it only reads, so only its own flag
turns it off. It runs even when the savings flags are off, so a rollback cannot hide a stuck
transfer. Set values by REST upsert, not a pipe.

## Running it

Route: `GET /api/cron/piggyvest-daily-reconciliation` with the cron secret.
The runner `vps-workers/jobs/run-web-cron.mjs` accepts this path. The VPS
crontab entry itself is an owner step and is deliberately not added by this change. Until then nothing calls it.
