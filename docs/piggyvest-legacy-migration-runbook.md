# PiggyVest legacy migration runbook

PiggyVest is the system of record for money. We build no in-house money engine
and no automatic zero-out tool. The few customers with money in the old in-app
wallet are moved by hand, in this order: list, credit, record, one reviewed SQL
update. The owner runs every step against production. Agents never touch the
production database, Vercel, the VPS or real PiggyVest accounts.

Files:

- `docs/piggyvest-legacy-migration/01-balance-list.sql` (read only)
- `docs/piggyvest-legacy-migration/02-zero-out.sql` (the one update)

## Before you start

- The change that stops new PiggyVest money landing on the old wallet row is
  live. Otherwise a balance can change between the list and the update.
- You hold the signed-off list approved by the owner and the coordinator.
- Pause the old wallet spending paths for these customers if any are active,
  so no customer spends while being moved.
- Drain in-flight VTU purchases. A purchase paid from the old wallet can still
  be refunded back into it after fulfilment fails, which would put money on a
  wallet that was already moved. Do not approve or credit a customer until
  every VTU purchase and refund for that customer has settled (no pending or
  processing order, no refund waiting). Re-run step 1 afterwards.

## 1. Coordinator list

1. Run `01-balance-list.sql`. It only reads.
2. Give the output to the coordinator. Only rows with `eligible` true may go
   on the list. A row with `matches_ledger` false, a non-zero `pending_count`
   or `over_zero_out_limit` true is excluded (the update cannot move more than
   99,999,999.99; take such a balance to the owner): do not credit it and do not list it. Run the list again later,
   once its pending rows have settled and the balance matches the ledger.
3. The coordinator confirms each customer, wallet and amount, and the owner
   signs the list. Freeze it: a changed balance means a new list.

## 2. Credit each customer by hand in PiggyVest

Only after the list is signed, and one customer at a time:

1. In PiggyVest, credit exactly the `legacy_balance` for that customer.
2. Copy the PiggyVest reference for that credit.
3. Check the customer's PiggyVest balance shows the credit before moving on.
4. If a credit times out or looks unclear, check its status in PiggyVest
   first. Never send it again until you have seen it did not happen.

## 3. Record each credit

Write one line per customer next to the signed list: wallet id, amount,
PiggyVest reference and the date. A second person checks every line against the
PiggyVest statement. Customers with no confirmed credit are left out of step 4.

## 4. Dry run the SQL update

1. Copy `02-zero-out.sql`. Fill in one row per credited customer between the
   marked lines: wallet id, merchant id, customer id, exact amount and the
   PiggyVest reference.
2. A second person reviews the rows against the recorded credits.
3. Run the file as is, with `psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f 02-zero-out.sql`.
   Load all rows in ONE multi-row insert, and set the declared row count to
   the number of rows you actually load (credited customers only; customers
   left out in step 3 are not counted). Each PiggyVest reference may appear
   once. The script stops if the counts differ. It ends with `ROLLBACK`, so nothing is saved.
4. Check the result: every row shows `now_balance` 0 and the right amount.
   Any error means a balance changed or a row was wrong. Nothing was changed.
   Fix the list from step 1, not the script.

## 5. Commit and verify

1. Change the last line from `-- COMMIT;` to `COMMIT;` and remove the
   `ROLLBACK;` line above it. Run the file again with the same
   `-v ON_ERROR_STOP=1` option.
2. Run `01-balance-list.sql` again. The migrated customers must be gone.
3. Each migrated wallet has one ledger row of source
   `piggyvest_legacy_migration` holding the amount, date and PiggyVest
   reference. Keep the signed list and the output with this runbook record.

## If something goes wrong

- Script error: nothing was saved. A pending-row error means that customer
  must come off the list until the row settles. Read the message, then re-check the list.
- Customer credited in PiggyVest but not zeroed: leave them out of the update
  until the script passes; do not credit again.
- Run committed by mistake with a wrong row: stop and ask the owner. Do not
  edit the ledger by hand. A correction is a new reviewed change.
- The script refuses a wallet that already has a migration row. That is on
  purpose: it cannot run twice for the same wallet.
