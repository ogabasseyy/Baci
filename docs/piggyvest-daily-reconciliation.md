# PiggyVest daily reconciliation

A read-only daily check. It emails the owner a report and raises a page when
anything is wrong. It resends, settles and releases nothing.

## What it checks

1. **Stuck transfers.** Every savings transfer still `reserved` or `dispatched`
   longer than 30 minutes. Each dispatched one is looked up at PiggyVest with
   the existing transfer status reader (the same reference, amount and wallet
   binding as the settlement path; a 404 is never read as "absent"). The report
   shows what PiggyVest says: completed, pending, failed, not listed, or
   unconfirmed.
2. **Balances.** For every goal wallet we confirmed principal into, the balance
   at PiggyVest against the principal we recorded. Less at PiggyVest pages. More
   is listed for review but does not page, because interest accrues there.
3. **Could not run.** A missing configuration, an unreadable database answer,
   or a balance that cannot be read pages. A run is never reported clean unless
   it completed.

The page is the existing `piggyvest_money_alert` event with code
`PIGGYVEST_RECONCILIATION_MISMATCH` (see `piggyvest-money-alerts.md`). It also
pages if the report email cannot be sent.

## Switches and settings (owner, production)

| Name | Meaning |
| --- | --- |
| `PIGGYVEST_RECONCILIATION_ENABLED` | Must be exactly `true`. Anything else: the route answers `disabled` and does nothing. |
| `PIGGYVEST_RECONCILIATION_REPORT_EMAIL` | Owner address the report is sent to. Missing or invalid pages instead. |

The email goes out through the platform ZeptoMail token (`ZEPTOMAIL_TOKEN`) with
a single attempt; a failed send pages. It reuses the `PIGGYVEST_PRIMARY_*` settings and the evidence database login.
It runs even when the savings flags are off, so a rollback cannot hide a stuck
transfer. Set values by REST upsert, not a pipe.

## Running it

Route: `GET /api/cron/piggyvest-daily-reconciliation` with the cron secret.
The VPS crontab entry (through `vps-workers/jobs/run-web-cron.mjs`) is an owner
step and is deliberately not added by this change. Until then nothing calls it.
