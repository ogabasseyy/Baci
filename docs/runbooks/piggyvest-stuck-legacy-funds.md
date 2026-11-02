# Runbook: resolve the two stuck legacy wallet amounts

Covers the ₦10,000 order that is still waiting for payment and the ₦103 airtime purchase
stuck in "processing", both in the Ogabassey legacy wallet. It carries out Default 11 of the
PiggyVest launch plan. Plain-English summary for the owner:
[change summary](../piggyvest-change-summaries/P0-stuck-funds-runbook.md). The SQL blocks
named below (O1, O2, V1 to V4) are in
[piggyvest-stuck-legacy-funds.sql](piggyvest-stuck-legacy-funds.sql).

- **When:** before either customer's legacy balance is moved into PiggyVest. That Phase 8
  move is not built yet, and it is designed to hold back wallets like these (a "pending hold")
  until they are fixed, so waiting is safe.
- **Who:** every write step needs the owner's go-ahead for that step. Nothing here runs on its own.
- **Scope:** the legacy Ogabassey wallet only. No PiggyVest money moves and no app code changes.

## Ground rules

1. Read first, write second. Blocks marked READ-ONLY only read.
2. Keep a private ops log. For every step record who approved it, when, the ids and the
   result. Ids, order numbers, phone numbers, vendor references and customer details stay in
   that log. Never paste them into GitHub, PR comments, shared channels or this file.
3. The amounts come from a 30 October snapshot. If a read-only step shows something other than
   what is described here, stop and ask the owner. Do not bend the steps to fit.
4. Run SQL in the production project's Supabase SQL editor, one block at a time. Never run
   the SQL file as a whole. Paste each block unchanged except for the values marked `PASTE`.
   The write block checks everything itself and changes nothing unless every check passes.
5. Do not run any wallet function by hand outside these blocks.

## Part A: the ₦10,000 order

The money left the customer's wallet when they placed the order, but the order was never paid
for. The 72-hour unpaid-order sweep (`mark_abandoned_orders`) only marks the payment as
abandoned; it does not return wallet money.

The fix is to cancel the order **through the merchant dashboard**. That runs
`cancel_order_as_merchant`, which in one step:

- marks the order cancelled;
- returns the wallet money (and any savings money) to the customer;
- closes the order's payment accounts and wallet funding requests;
- puts the stock back, writes an audit entry and queues the customer's cancellation email.

Returning the wallet money on its own (`reverse_wallet_redemption`) would leave the order
open, so it could later be completed without the wallet portion. Never change an order's
payment status by hand.

### A1. Find the order (block O1, READ-ONLY)

Expected: exactly one row with `wallet_held` 10000.00, `payment_status` `unpaid` (or
`cancelled` if the sweep already ran), `shipping_status` `pending` or `processing`,
`payments_in_flight` 0 and `completed_payments` 0. A `payment_status` of `pending` together
with `payments_in_flight` above 0 is the started-card-payment case below. Copy `order_id` and
`order_number` into the ops log.

Stop instead of continuing if:

- **No rows.** It may already be resolved. If the ops log has the order id from an earlier
  run, check it with A3; otherwise tell the owner.
- **More than one row, or a different amount.** The snapshot changed; the owner approves the
  new list first.
- **`completed_payments` above 0.** Cancelling would also start a card refund. That is a
  separate owner decision.
- **`payments_in_flight` above 0** (`payment_status` usually reads `pending`): the customer
  started a card payment for the rest of the order. The cancel will refuse with "A payment
  attempt needs to be checked". No automatic checker clears an abandoned attempt on an unpaid
  order, so do not wait for one. Look the attempt up in the Paystack dashboard and record the
  result in the ops log. If it succeeded, this is a completed payment and a separate owner
  decision. If it was abandoned or failed, stop and escalate to the owner, who either approves
  a small follow-up change that closes that attempt or defers this order in writing. Do not
  work around the refusal.

### A2. Cancel it (owner-approved write, in the dashboard)

1. Sign in to the Baci dashboard as the Ogabassey owner, or as staff allowed to edit orders.
2. Open **Orders**, search for the order number, and open the order.
3. Optional: tell the customer first. They will get the standard cancellation email.
4. Click **Cancel Order** and confirm "Cancel this order and restore its tracked inventory?".
5. "This order can no longer be cancelled" or "A payment attempt needs to be checked" means
   nothing changed. Stop and run A1 again.

The button calls `apps/web/src/app/api/orders/[id]/cancelled/route.ts`, which runs the cancel
under the owner's own signed-in session. Pressing it twice is safe: the second press finds the
order already cancelled and changes nothing.

### A3. Confirm (block O2, READ-ONLY)

Fill in the `order_id` from A1. Expected:
`cancelled | merchant | true | 10000.00 | 10000.00 | 0 | 0 | true`, and O1 now returns no
rows. The payment status keeps its old value (usually `unpaid`). That is normal: a merchant
cancel is recorded in the shipping status and the cancelled time.

## Part B: the ₦103 airtime purchase

A wallet airtime purchase stays "processing" until the vendor gives a final answer. The
automatic checker (`apps/web/src/lib/vtu-processing-reconciliation.ts`, run every five minutes
by the [VPS workers](../ops/vps-workers.md)) asks the vendor and settles the purchase itself
once the vendor answers. This one never got a final answer, so a person has to ask the vendor.
Giving the money back before the vendor confirms the failure could repay airtime that was
actually delivered.

### B1. Find and classify (block V1, READ-ONLY)

Expected: one row with `processing | checkout | airtime | 103.00`, vendor `kuda` or `monnify`,
`provider_fallback` empty, `split_wallet` 103, `split_card` 0, `debited` 103.00, `reversed` 0
and `refunded` 0. Copy `vtu_id` into the ops log.

- **The row is gone:** the checker settled it. Run B4 to see how, then go to "After both parts".
- **`debited` is 0:** nothing was taken from the wallet. Still ask the vendor; B3 then closes
  the purchase without moving money.
- **Other rows:** they are not part of this approval. Record them and tell the owner.
- **Any other shape** (a card part, a debit other than 0 or 103.00, money already returned):
  stop and escalate. The B3 block refuses these shapes anyway.
- **`provider_fallback` is filled in:** the app re-routed the purchase from Monnify to Kuda, so
  ask Kuda. A "failed" answer goes through B3 as normal. A "delivered" answer needs the app's
  cashback and commission correction, which B3 cannot make, so B3 refuses it: escalate.

### B2. Ask the vendor (block V2, READ-ONLY)

V2 prints the references the vendor needs. They go into the ops log only.

- **Kuda:** ask Kuda (business dashboard or support) for the bill status of that request
  reference and vendor transaction id.
- **Monnify:** ask Monnify for the bills-payment status of the Monnify vend reference. If it is
  empty, ask with the request reference and the date.

What counts:

- **Failed:** the vendor says in writing (ticket, email or dashboard screenshot) that this exact
  reference failed or was reversed and will not be delivered.
- **Delivered:** the vendor shows that it succeeded.
- **Not an answer:** pending, processing, "not found", no reply, or only the customer saying the
  airtime never arrived.

Save the vendor's answer in the ops log. Its entry reference (no personal data) is the
`PASTE-OPS-LOG-REF` value in B3.

With no answer, do nothing: the checker keeps checking, so ask the vendor again later. The
owner may also defer this explicitly; record that. While it is deferred, the Phase 8 move is
designed to keep this wallet out.

### B3. Record the vendor's answer (block V3, owner-approved write)

1. Paste block V3. Fill in the `vtu_id`, the vendor's answer (`failed` or `delivered`) and
   the ops log reference. Leave `v_apply` as `false`.
2. Run it. A dry run always ends with an error that starts **DRY RUN OK**: that is expected
   and nothing was changed. An error that starts **STOP** means the purchase is not in the
   approved shape. Nothing was changed; escalate.
3. With the owner's go-ahead, set `v_apply` to `true` and run it once more.

Before changing anything, the block checks that the purchase:

- is an Ogabassey purchase that is still processing;
- is a wallet-only purchase of exactly the approved amount;
- has exactly the wallet debit expected, and no money returned yet;
- when the answer is "delivered", was not re-routed from Monnify to Kuda (see B1).

What it then does:

- **Failed, paid from the wallet:** closes the purchase as failed and returns the ₦103 through
  `reverse_vtu_wallet_payment`, the same function the checker uses after a vendor failure. That
  function refuses to return the same purchase twice. The block then writes the refund markers
  the app writes, so the customer's history shows the refund and the checker leaves it alone.
- **Failed, wallet never charged:** closes it as failed with no credit.
- **Delivered:** marks it successful and moves no money. The checker then finishes the normal
  follow-ups of a successful purchase, such as cashback.

The block runs as one transaction under the same locks as the checker's own refund, so the
checker cannot act on the purchase halfway through.

### B4. Confirm (block V4, READ-ONLY)

Fill in the `vtu_id`. Expected after "failed":
`failed | vendor_confirmed_failed | 103.00 | 103.00 | 0 | true`. After "delivered":
`successful | vendor_confirmed_delivered | 103.00 | 0 | 0 | true`. V1 must no longer list the
purchase.

## After both parts

- When the Phase 8 legacy provenance report is available, run it for these two customers.
  Neither may show `pending_hold`. Until then, the check is that O1 and V1 no longer list
  these two cases.
- The ops log holds, for each part: the approver, the time, the ids, the evidence and the
  A3 or B4 result.
- Done means both amounts are resolved this way, or the owner has deferred one in writing.

## What could go wrong

| Risk | What prevents it |
|---|---|
| The order was paid after all | O1 shows `completed_payments`; the runbook stops there |
| A card payment for the order is still open | The cancel refuses; the runbook checks Paystack and escalates instead of waiting |
| Airtime repaid although it was delivered | Money is returned only on the vendor's written, final "failed" |
| Wrong cashback on a re-routed purchase | V3 refuses "delivered" for a purchase re-routed from Monnify to Kuda |
| A step runs twice, or two people run it | A second cancel changes nothing; V3 refuses a purchase that is no longer processing |
| The checker acts at the same moment | V3 takes the same locks as the checker's refund; whichever runs second sees a closed purchase |
| A typo in an id, amount or answer | V3 stops before changing anything, and a dry run always comes first |
| Someone runs the whole SQL file | Every block with a `PASTE` value fails, the write block included, so nothing changes |
