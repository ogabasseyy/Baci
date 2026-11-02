# Change summary: stuck legacy wallet money runbook (P0-stuck-funds-runbook)

## What changes

Nothing in the app changes. This adds a step-by-step runbook and database checks for fixing
two amounts stuck in the old Ogabassey wallet:

- **₦10,000** taken from a customer's wallet for an order never paid for. The fix is to
  cancel it with the normal Cancel Order button in the merchant dashboard, which also returns
  the ₦10,000 to the wallet.
- **₦103** taken for an airtime purchase stuck on "processing". The fix is to ask the vendor
  first. Only if the vendor confirms in writing that it failed does the ₦103 go back. If it
  was delivered, the purchase is marked successful and no money moves.

## Why

This is Default 11 of the launch plan. Both customers' old balances will later move into
PiggyVest, and unfinished payments like these must be fixed first. Returning the ₦10,000
without cancelling the order could let it be completed later at a ₦10,000 discount.
Returning the ₦103 before the vendor answers could repay airtime the customer received.

## What could go wrong and how it is prevented

- **The wrong order or purchase is changed.** Read-only checks must first show exactly the
  expected case. Anything different means stop and ask you.
- **An abandoned card payment blocks the cancel.** Nothing clears it automatically, so the
  runbook checks Paystack and comes to you.
- **Wrong cashback on a re-routed purchase.** If the app switched vendors, a "delivered"
  answer comes to you, because only the app corrects that cashback.
- **Money is returned twice.** Both fixes refuse to repeat, and the airtime step refuses if
  money was already returned.
- **A typo or a missed value.** The airtime step checks the purchase, amount, vendor answer
  and wallet history first, and always starts with a practice run that changes nothing.
- **Bad timing with the automatic checker.** The airtime step takes the app's refund locks.
- **Private details leak.** Ids and customer details stay in the private ops log.

## How it is tested

Every database check and the airtime step ran against a test database built from the app's
real tables and refund function, with made-up customers. Over eighty checks cover finding
only the right order and purchase, the practice run changing nothing, exactly ₦103 returned
once, "delivered" moving no money, and refusing every wrong case: wrong amount, card payment,
other merchant, re-routed purchase, already refunded, missing evidence and repeats.

## How it stays switched off

Nothing runs by itself. Every change to live data needs your go-ahead, is done by a person
following the runbook, and is logged. The PiggyVest move is designed to hold
back wallets like these, so waiting is safe.
