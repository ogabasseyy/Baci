# Pay from your PiggyVest wallet (IMEI first, then VTU)

Status: design, 2026-11-12. Dark: nothing here moves money until the owner
turns on a new flag. Checkout is out of scope.

## Goal in one paragraph

A customer pays Ogabassey for an IMEI check or an airtime/data/bill purchase
straight from their PiggyVest main wallet. The money moves PiggyVest-to-
PiggyVest: a wallet-to-wallet transfer from the customer's main wallet into an
Ogabassey **collection wallet** (a business wallet at PiggyVest that belongs to
no customer). Ogabassey never holds the money anywhere else and there is no
cash-out. If Ogabassey cannot deliver, the same amount goes back from the
collection wallet to the customer's main wallet, exactly once.

## What is reused (checked against the code on main, a97210000d)

| Piece | Where it lives today | How "pay" reuses it |
| --- | --- | --- |
| Executor login + allow-listed SQL | `primary-wallet-savings-executor.ts` (`piggyvest_primary_authorizer`) | New `WALLET_PAY_STATEMENTS` added to the allow-list |
| Customer scope check | `piggyvest_primary.assert_savings_scope(scope)` | Called first by every new customer-side function |
| Server-issued operation id + PIN spent in the reserve transaction | `issue_goal_cancel` / `reserve_goal_cancel_with_pin` (`20261103085004`) | Same shape: `issue_wallet_payment` / `reserve_wallet_payment_with_pin` |
| PIN proof minting | `goal-pin-verify.ts` + `verify_wallet_pin` (`20261102202603`) | New purpose `wallet_pay`; the server builds the binding from the issued row |
| One POST per reference, pending on doubt | `goal-cancel-transfer.ts`, `isDefinitiveNoTransferRejection` | Same rules in `wallet-pay-transfer.ts` |
| TSQ proof | `verifyPrimaryWalletSavingsProof` | Same checks; destination binding changes (see below) |
| Evidence login settle/release | `settle_goal_cancel`, `release_failed_goal_cancel` | `settle_wallet_payment`, `release_failed_wallet_payment`, same for refunds |
| Webhook attribution | `primary-wallet-savings-outflow-reconciliation.ts` (`GOAL_TRANSFER_KINDS`) | Two new kinds: `pvb-pay-`, `pvb-refund-` |
| Kill switch + flags | `piggyvest-feature-on.ts`, `piggyvest-kill-switch.ts` | New flag `wallet_pay` = `PIGGYVEST_WALLET_PAY_ENABLED` |

## Decisions

### 1. Where the collection wallet comes from (never the client)

- Database: new table `piggyvest_primary.collection_wallets` keyed by
  `integration_id` (one live row per integration), with `provider_wallet_id`
  and `enabled`. RLS deny-all, no grants. Only the migration owner writes it
  (operator SQL in the runbook), like the other `integrations` bindings.
- Env: `PIGGYVEST_COLLECTION_WALLET_ID`. The runtime refuses to start a payment
  unless it is set and equals the database row the reservation returns. Two
  owners must agree (code deploy + DB row), so neither a bad env value nor a bad
  row alone can redirect money.
- At dispatch the app reads the wallet at PiggyVest and requires
  `business_id = our business` and **no `api_customer_id`** (sandbox proved a
  business wallet is bound to no customer: `house_wallet_unbound_to_customer =
  yes`, `docs/piggyvest-contract-evidence/2026-11-02.md`). A collection wallet
  that answers with a customer id is refused, so a customer wallet can never
  stand in for it.

### 2. PIN proof: new purpose `wallet_pay`

- Purpose `wallet_pay` added to `wallet_pin_private.proof_purposes`.
- Bound to: customer, merchant (both from the verified scope), the **exact
  amount in kobo** (from the issued row, never the request), and
  `sha256('pay:<purpose>:<purchaseRef>:<operationId>')`, so a proof is for one
  attempt at one purchase of one product kind.
- The client sends only `operationId` + PIN to the verify route. The server
  reads the issued row (amount, purpose, purchase reference) and builds the
  binding itself. A proof minted for ₦1,000 cannot pay ₦2,000, and a proof for
  IMEI lookup A cannot pay lookup B.
- Spent inside `reserve_wallet_payment_with_pin` in the same transaction as the
  reservation (rolled back with it on any refusal). Merchants with PIN checking
  off still need a proof here: unlike goal funding, this is a new outflow
  kind, so there is no "worked before PINs" behaviour to keep.

### 3. Records and states

`piggyvest_primary.wallet_payments` — one row per payment attempt.

| State | Meaning |
| --- | --- |
| `issued` | Server priced the purchase and issued the id; no PIN yet. Expires after 10 minutes. |
| `reserved` | PIN spent, reference fixed. Nothing sent yet. |
| `dispatched` | The one POST to PiggyVest was attempted (sent, timed out or unknown). |
| `confirmed` | A verified PiggyVest record shows the money in the collection wallet. |
| `released` | Nothing moved: refused before sending, or PiggyVest definitively refused / reported failed. |
| `needs_review` | PiggyVest answered something our books refuse (fee ≠ 0, amount drift, late success after release with a newer attempt). A person decides. |

Key columns: `purpose` (`imei_check` \| `vtu`), `purchase_ref` (the IMEI
lookup id / VTU transaction id), `amount_kobo` (fixed at issue),
`reference` (`pvb-pay-<operationId>`, UNIQUE, never reused),
`source_wallet_id`, `destination_wallet_id`, `provider_transaction_id`,
timestamps, `fulfilment_state` (`awaiting` → `fulfilled` \| `refund_owed`).
At most one live (reserved/dispatched/confirmed) payment per
`(purpose, purchase_ref)` (partial unique index), so a purchase is paid once.

`piggyvest_primary.wallet_payment_refunds` — one refund **per payment**
(`payment_id` UNIQUE among live rows). States `reserved`, `dispatched`,
`confirmed`, `released`, `needs_review`. Reference `pvb-refund-<paymentId>`,
then `-<n>` only after a dispatched attempt is released (same "never reuse a
reference" rule as goal cancel). Amount = the payment's confirmed amount,
read from the payment row inside the function, never passed in.

### 4. Fulfilment waits for a settled payment

- Pending is never "paid". A product is delivered only when the payment row is
  `confirmed` (verified TSQ record). The 202 from `/transfer/wallet` is only
  "submitted".
- A timeout or any ambiguous failure leaves the row `dispatched`; reconciliation
  (status poll, outflow webhook, daily report) settles it. No blind retry:
  every retry of a payment is a status check that never POSTs.
- Exactly-once delivery: `claim_wallet_payment_fulfilment(paymentId)` moves
  `fulfilment_state` from `awaiting` to `claimed` under a row lock, and only
  the caller that wins runs the IMEI lookup / VTU purchase. The product's own
  idempotency keys (lookup id, VTU transaction id) back this up.
- IMEI: if the lookup fails definitively, `mark_wallet_payment_refund_owed`
  sets `refund_owed` and creates the refund row in the same transaction.
  VTU: a definitive provider failure does the same; an indeterminate VTU result
  stays with the existing VTU pending/requery machinery and is never refunded
  until it is definitively failed.

### 5. Refunds (collection wallet → customer main wallet), exactly once

- Created only by the database, from a confirmed payment whose fulfilment is
  `refund_owed`. Nothing the client sends can create or size a refund.
- No PIN: it returns the customer's own money to their own wallet.
- Dispatch is the same one-shot POST; a definitive rejection plus a TSQ
  `not_found` releases the attempt and the next drive takes a fresh suffix. A
  verified success confirms it and sets the payment's `fulfilment_state` to
  `refunded`.
- Refunds are driven by the status path the customer is already polling and
  by a cron drain (`/api/cron/piggyvest-wallet-pay-drain`), which also picks up
  abandoned payments. The drain runs under the recovery runtime, so refunds
  still go out after the flag is switched off or the kill switch is on: a
  rollback never strands a customer's money in the collection wallet.

### 6. Reconciliation additions

- Webhook: `wallet-transfer.outflow.success` / failed references beginning
  `pvb-pay-` or `pvb-refund-` reconcile through the same proof path.
- Proof (`wallet-pay-proof.ts`): same TSQ checks as savings (reference,
  amount, both wallets, provider id echo, terminal status), with fee `0`
  required. A non-zero fee is **not** left pending forever: it settles the
  row to `needs_review` and pages (fee rules are unconfirmed; see questions).
- Daily report (`read_daily_reconciliation`): adds three lines, read-only:
  payments stuck `reserved`/`dispatched` > 30 min; confirmed payments still
  `awaiting`/`claimed` > 30 min (paid, not delivered); refunds not confirmed
  > 30 min. No collection-wallet balance equation: the owner may sweep the
  wallet, so a balance check would page forever.

### 7. Flag, kill switch, rollout

- New feature `wallet_pay` → `PIGGYVEST_WALLET_PAY_ENABLED`, default off.
  `isPiggyvestFeatureOn('wallet_pay')` gates issuing and reserving new
  payments; the master `PIGGYVEST_KILL_SWITCH` stops them too.
- Status checks, settlement, fulfilment of already-confirmed payments and
  refunds run under the recovery runtime and ignore both, so a switch-off
  never strands money.
- Merchants without PiggyVest (no primary runtime for the merchant, or the
  customer has no verified onboarding intent) see exactly today's behaviour:
  the routes only offer "Pay from PiggyVest wallet" when the server says the
  wallet is ready; the legacy store-credit path is untouched.

## PR split

1. **Engine + SQL** (this PR): migration, replay-registry folder, SQL
   regression test, schemas, store/transfer/proof/reconciliation/runtime
   modules with unit tests, flag registration, PIN purpose, docs.
2. **IMEI wiring**: `/api/storefront/imei-check` gains `piggyvest_wallet` as a
   payment method (issue → PIN → pay → status), fulfilment claim + refund
   marking in `execute-imei-lookup.ts`; app UI in
   `apps/mobile-storefront/app/imei-check/` reusing `WalletPinSheet`.
3. **VTU wiring**: same payment step in front of the existing VTU fulfilment.

## Tests that prove "done"

- A payment moves money exactly once: replayed submits, a double tap, a
  replay after timeout and a webhook racing a poll all POST once and settle
  once (unit + SQL).
- Wrong or missing PIN moves nothing: reserve returns `pin_refused`, the row
  stays `issued`, no transfer port is called (unit + SQL).
- A failed IMEI / VTU fulfilment refunds exactly once: one refund row per
  payment, a second `refund_owed` call is a no-op, two drains race to one POST.
- Merchants without PiggyVest are unchanged: existing route tests still pass,
  plus a test that the new method is refused when the runtime is off.

## Open questions for PiggyVest (not sent)

1. Are customer-main-wallet → business (collection) wallet transfers allowed on
   our account via `/transfer/wallet`, and the reverse for refunds?
2. What fee applies to each direction, which wallet pays it, and does the
   `api-fee-wallet-settings` switch move it to a fee wallet? (Our proof needs
   `fee = 0` on the record, or a known fee wallet.)
3. How is a refund reported: a `wallet-transfer.outflow.success` on the
   collection side only, or also an inflow on the customer side? Which field
   carries our reference?
4. Is a `third_party_reference` unique forever, or only for a window? (Same as
   the 2026-11-02 question 7.)
5. Does PiggyVest place any per-customer debit limit or extra customer
   authorisation on API-initiated transfers out of a customer's main wallet?
