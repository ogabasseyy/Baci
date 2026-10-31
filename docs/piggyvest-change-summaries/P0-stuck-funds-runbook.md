# Change summary: stuck legacy wallet money runbook (P0-stuck-funds-runbook)

## What changes

Nothing in the app changes. This adds a step-by-step runbook and its database checks for
fixing two amounts stuck in the old Ogabassey wallet:

- **₦10,000** taken from a customer's wallet for an order that was never paid for. The fix is
  to cancel that order with the normal Cancel Order button in the merchant dashboard, which
  also returns the ₦10,000 to the customer's wallet.
- **₦103** taken for an airtime purchase stuck on "processing". The fix is to ask the vendor
  first. Only if the vendor confirms in writing that it failed does the ₦103 go back
  to the wallet. If the vendor says it was delivered, the purchase is marked successful and no
  money moves.

## Why

This is Default 11 of the launch plan. Both customers' old balances will later move into
PiggyVest, and wallets with unfinished payments like these must be fixed first. Returning
the ₦10,000 without cancelling the order could let the order be completed later at a
₦10,000 discount. Returning the ₦103 before the vendor answers could repay airtime the
customer received.

## What could go wrong and how it is prevented

- **The wrong order or purchase is changed.** Each part starts with read-only checks that must
  show exactly the expected case. Anything different means stop and ask you.
- **Money is returned twice.** Both fixes refuse to repeat, and the airtime step refuses if
  any money was already returned.
- **A typo or a missed value.** The airtime step checks the purchase, amount, vendor answer
  and wallet history before changing anything, and always runs first as a practice run that
  changes nothing.
- **Bad timing with the automatic checker.** The airtime step takes the same locks as the
  app's own refund, so the two cannot interfere.
- **Private details leak.** Ids, references and customer details stay in the private ops
  log, never GitHub.

## How it is tested

Every database check and the airtime step ran against a test database built from the app's
real tables and refund function, with made-up customers. Over sixty checks cover finding
only the right order and purchase, the practice run changing nothing, exactly ₦103 returned
once, "delivered" moving no money, and refusing every wrong case: wrong amount, card payment,
other merchant, already refunded, missing vendor evidence and repeat runs.

## How it stays switched off

Nothing runs by itself. Every change to live data needs your go-ahead, is done by a person
following the runbook, and is recorded in the ops log. The PiggyVest move is not built yet
and is designed to hold back wallets like these, so waiting is safe.
