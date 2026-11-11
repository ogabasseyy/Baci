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

6. **Missing credits.** PiggyVest has no webhook resend, so a credit whose
   webhook retries ran out is never recorded, and the balance check above
   cannot see it (a surplus never pages). For each mapped plan wallet (ready or
   restricted, 100 per run, rotating daily) the job lists the wallet's
   transactions at PiggyVest (`GET /api/v1/transaction?wallet_id=…`, newest
   first, at most 10 pages of 100) back to the window start, and compares each
   credit's id (the PVB credit id, `PVB01…`) with the `pvb_reference` values
   both credit ledgers recorded for that wallet
   (`piggyvest_primary.read_credit_gap_ledger`, evidence login only). The
   window covers every wallet's whole rotation plus two days, so visits
   overlap.
   - A successful credit older than 6 hours that neither ledger recorded
     **pages** (`unrecorded_credit`). Resolve it by replaying the stored
     webhook capture, or by hand. Wallet-to-wallet (`p2p`) credits are our own
     savings transfers (checked in 1.) and are only counted: the contract
     evidence (2026-11-02) shows every wallet-to-wallet transfer lands as
     `p2p`, while outside money (even into a goal wallet's own account number)
     is a bank deposit, which is checked. The email shows how many were
     skipped.
   - A `partial` credit that neither ledger recorded is a review line only
     (`partial_credit`): check at PiggyVest how much moved. `pending` and
     `failed` credits moved no money and are ignored.
   - An inflow we recorded that PiggyVest does not list as settled (missing,
     pending or failed) **pages**
     (`not_on_provider`); check it at PiggyVest before acting.
   - A list id without the PVB credit-id shape (`PVB01…`) is a review line
     only (`unverified_reference`): the list may use another id namespace than
     our `pvb_reference`. If none of a wallet's settled list ids is PVB-shaped,
     its recorded inflows missing from the list are review lines too, not
     pages. Confirm list id equals `pvb_reference` on the first live credit.
     When that downgrade happens for a wallet, one `list_namespace_unproven`
     line **pages** for it, so a list format change never silences the check.
     Treat it with the same urgency as a missing credit: until list ids are
     matchable, that wallet's missing credits are only review lines.
   - Internal transfers are matched on the category `p2p` after trimming and
     lower-casing; any other category still pages.
   - An interest payout we recorded that the list does not show is a review
     line only: whether the list includes interest rows is not yet confirmed.
   - A wallet whose list cannot be read, is not newest first, runs past 10
     pages, runs into the shared 200-second budget (checked before every
     page), or has more than 1,000 recorded credits in the window is reported
     NOT checked and pages. Rows recorded before `pvb_reference` existed have
     no key; they are counted and never matched.

   It never writes a credit or moves money.

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
crontab block in `vps-workers/deploy.sh` (installed by the isolated worker
release) calls it daily at 23:00 UTC (midnight Lagos time) with the cron secret, under its own
`flock` and log. The call is harmless while `PIGGYVEST_RECONCILIATION_ENABLED`
is unset: the route answers `{"status":"disabled"}` with HTTP 200, touches no
dependency, sends no email and raises no page. The runner's 6-minute client
timeout sits above the route's 300-second limit.
