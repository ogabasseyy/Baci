# PiggyVest legacy migration runbook

PiggyVest is the system of record for money. We build no in-house money engine
and no automatic zero-out tool. The few customers with money in the old in-app
wallet are moved by hand, in this order: list, credit, record, one reviewed SQL
update. The owner runs every step against production. Agents never touch the
production database, Vercel, the VPS or real PiggyVest accounts.

Files:

- `docs/piggyvest-legacy-migration/01-balance-list.sql` (read only)
- `docs/piggyvest-legacy-migration/02-zero-out.sql` (the one update)

The update also blocks new wallet ledger rows for the few seconds it runs.
Two runs of the update at the same time are not possible: the script takes a
database lock first, so a second run waits for the first. If the first run
takes longer than 5 seconds the second stops with a lock timeout error and
changes nothing; start it again only after the first has ended. Once it can
run, it refuses a PiggyVest reference that was already used. The CI tests run the scripts on a
scratch database with a simplified schema (no foreign keys or ledger triggers),
so the ROLLBACK dry run in step 4 on the real database is the real check.

## Before you start

- The change that stops new PiggyVest money landing on the old wallet row is
  live. Otherwise a balance can change between the list and the update.
- You hold the signed-off list approved by the owner and the coordinator.
- Pause every old wallet spending path for these customers before step 2, and
  verify that no spend path can debit their wallets (for example, try a test
  spend on a staff wallet and confirm it is refused). Write the check and its
  date in the record from step 3. Do not credit anyone in PiggyVest until this
  is verified.
- Drain in-flight VTU purchases. A purchase paid from the old wallet can still
  be refunded back into it after fulfilment fails, which would put money on a
  wallet that was already moved. Do not approve or credit a customer until
  every VTU purchase and refund for that customer has settled (no pending or
  processing order, no refund waiting). Re-run step 1 afterwards.

## 1. Coordinator list

1. Run `01-balance-list.sql`. It only reads.
2. Give the output to the coordinator. Only rows with `eligible` true may go
   on the list. A row with `matches_ledger` false, a non-zero `pending_count`,
   `already_migrated` true, `customer_found` false or `over_zero_out_limit` true is excluded (the update cannot move more than
   99,999,999.99; take such a balance to the owner): do not credit it and do not list it. Run the list again later,
   once its pending rows have settled and the balance matches the ledger.
   `already_migrated` true means the customer was moved and paid in
   PiggyVest before; a later credit made the wallet look normal again. Never
   credit PiggyVest for it. Stop and ask the owner: the extra amount needs a
   new reviewed change.
3. The coordinator confirms each customer, wallet and amount, and the owner
   signs the list. Freeze it: a changed balance means a new list.

### Handling the list (customer personal data)

The output holds names, emails and phone numbers. Keep it in one restricted
folder that only the owner and the coordinator can open. Do not paste it into
email or chat, and make no extra copies. Delete every copy, including the
signed list, 30 days after step 5 is finished; keep only wallet ids, amounts
and PiggyVest references in the runbook record.

### Dry run on the real schema before any credit

After the list is signed and BEFORE crediting anyone in PiggyVest, run
`02-zero-out.sql` once as is (without the commit switch it always ends with `ROLLBACK`), using
`psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f ~/piggyvest-legacy/02-zero-out.filled.sql`
(the working copy described in step 4, outside the repository), with the signed rows and
placeholder references such as `DRY-RUN-1`, `DRY-RUN-2`. This checks the real
production tables, constraints, triggers and balances while nothing has been
paid yet. The CI tests use a simplified scratch schema and cannot do this. Do
not continue to step 2 until this dry run passes; any error means fix the list
and repeat.

## 2. Credit each customer by hand in PiggyVest

Only after the list is signed, and one customer at a time:

1. In PiggyVest, credit exactly the `legacy_balance` for that customer.
2. Copy the PiggyVest reference for that credit.
3. Check the customer's PiggyVest balance shows the credit before moving on.
4. If a credit times out or looks unclear, check its status in PiggyVest
   first. Never send it again until you have seen it did not happen.

## 3. Record each credit

Write one line per customer next to the signed list: wallet id, amount,
PiggyVest reference and the date. The owner credits and records every line;
the coordinator then checks every line against the PiggyVest statement. Customers with no confirmed credit are left out of step 4.

## 4. Dry run the SQL update

1. Copy `02-zero-out.sql` to the one working copy
   `~/piggyvest-legacy/02-zero-out.filled.sql` (outside the repository; the
   committed file stays empty). Fill in one row per credited customer between
   the marked lines: wallet id, merchant id, customer id, exact amount and the
   PiggyVest reference.
2. The coordinator re-checks every row against the owner's recorded credits
   before the commit run, and the owner confirms. Nobody else is involved.
3. Run the working copy as is, with `psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f ~/piggyvest-legacy/02-zero-out.filled.sql`.
   Load all rows in ONE multi-row insert, and set the declared row count to
   the number of rows you actually load (credited customers only; customers
   left out in step 3 are not counted). Each PiggyVest reference may appear
   once. The script stops if the counts differ. Without `zero_out_mode=commit` it always ends with `ROLLBACK`, so nothing is saved.
4. Check the result: every row shows `now_balance` 0 and the right amount.
   The script also re-adds the wallet ledger and refuses any wallet whose
   stored balance differs from it. Any error means a balance changed or a row was wrong. Nothing was changed.
   Fix the list from step 1, not the script.

## 5. Commit and verify

1. Run the same unmodified working copy with the commit switch (never edit it,
   and never point the command at the empty committed file):
   `psql -v ON_ERROR_STOP=1 -v zero_out_mode=commit "$DATABASE_URL" -f ~/piggyvest-legacy/02-zero-out.filled.sql`.
   A commit run refuses placeholder references such as `DRY-RUN-1`.
2. Run `01-balance-list.sql` again. The migrated customers must be gone.
3. Each migrated wallet has one ledger row of source
   `piggyvest_legacy_migration` holding the amount, date and PiggyVest
   reference. Keep the signed list and the output with this runbook record only for the
   30 days set in "Handling the list", then delete the names, emails and
   phone numbers and keep wallet ids, amounts and references.
4. Keep the pause from "Before you start" in force after the commit. A credit
   or refund that was already waiting on a wallet lock can still land on the
   zeroed wallet just after the commit, so the first re-run can look clean.
5. After the longest in-flight purchase or refund window has passed (at least
   one hour), run `01-balance-list.sql` once more and confirm no migrated
   wallet is listed. Only then lift the pause.
6. If a migrated wallet shows a balance again, do NOT credit PiggyVest a second
   time: the customer was already paid once. Stop and ask the owner. The script
   refuses that wallet on purpose, so the extra amount needs a new reviewed
   change.

## If something goes wrong

- Script error: nothing was saved. A pending-row error means that customer
  must come off the list until the row settles. Read the message, then re-check the list.
- Customer credited in PiggyVest but not zeroed: leave them out of the update
  until the script passes; do not credit again.
- Run committed by mistake with a wrong row: stop and ask the owner. Do not
  edit the ledger by hand. A correction is a new reviewed change.
- The script refuses a wallet that already has a migration row. That is on
  purpose: it cannot run twice for the same wallet.
