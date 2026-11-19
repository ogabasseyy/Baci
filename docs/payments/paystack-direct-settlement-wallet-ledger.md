# Paystack direct-settled sales and the merchant wallet ledger

Status: fix in review (owner sign-off required before merge). Written 2026-11-03
against main `eca0c94f37`. HIGH-RISK money path.

## The problem

Storefront Paystack checkouts split each payment with Paystack's subaccount
feature (`subaccount` = the merchant's code, `bearer: 'account'`). Paystack
pays the merchant's share **straight into the merchant's bank**. Baci keeps only
`transaction_charge`, which was the platform fee alone.

Settlement nevertheless credited the same share to the internal
`merchant_wallets` ledger (`record_merchant_settlement` → `upcoming_balance` →
`process_due_settlements` → `available_balance`). That balance:

- could pay for GIG bookings (`reserve_merchant_shipping_charge`), and
- was picked up by the weekly auto-payout (`/api/cron/wallet-payouts` →
  `debit_merchant_wallet`), which would pay it out **a second time** if the
  payout provider ever enabled transfers.

Baci has no licence to hold merchant money, so sales that Paystack already
settled to the merchant must never look like Baci-held, spendable balance.

A second gap: for GIG orders where the customer pays delivery at checkout
(`shipping_funding_source = 'customer_checkout'`), the delivery fee went to the
merchant's bank with the sale. Baci books and pays GIG itself, so it paid GIG
without ever receiving the fee. The "retained shipping" existed only on the
wallet ledger. The REDVAULT pilot already added the fee to `transaction_charge`.

## (a) Every path that credits `merchant_wallets`

| # | Path (latest definition) | Money source | Who holds the money |
|---|---|---|---|
| 1 | `record_merchant_settlement` (`20260927151300`) + `process_due_settlements` (baseline) via `paid-order-settlement-executor.ts` | Storefront **Paystack** order sale | **Merchant's bank** when Paystack's verified payload names a subaccount (card, storefront DVA, agentic DVA all split). Baci only when the payload shows no subaccount (chat-order DVAs, some legacy DVAs) |
| 1b | same RPC, `settlementGateway = 'korapay'` | Korapay collection (credits `available` at once) | Baci (Korapay float). Korapay is off by default |
| 1c | same RPC, `settlementGateway = 'juicyway'` | Juicyway stablecoin checkout | Baci |
| 2 | `record_merchant_settlement_gigl_v1` (`20260905113100`) | Same as 1, with customer-paid GIGL retention | Same as 1. The retention was ledger-only: Baci never received it on Paystack |
| 3 | `record_merchant_settlement` from `api/payments/webhook/route.ts` (chat orders, `CHAT-` refs) | Chat-order DVA from `generatePaymentAccount` (no subaccount) | Baci's own Paystack balance |
| 4 | `record_merchant_settlement` from `scripts/reconcile-paystack-dva-executors.ts` | Manual DVA reconcile | Depends on the DVA (see 1/3) |
| 5 | `credit_merchant_wallet` (`20260430071509`) from `vtu-fulfillment.ts` | VTU commission | Baci (Baci collects the VTU sale) |
| 6 | `credit_merchant_wallet_funding` (`20260901193000`) from `confirm-paystack-merchant-wallet-dva.ts` | Merchant top-up into its wallet DVA (Baci account, no subaccount) | Baci |
| 7 | GIGL shipping refunds: `refund_merchant_shipping_charge`, `release_reserved_merchant_shipping_charges_for_order`, `self_fulfill_order_with_wallet_release`, `private.prevent_active_gigl_shipping_cancellation`, `private.refund_gigl_wallet_charge_on_provider_cancellation` | The merchant's own wallet money coming back | Same as the debit it reverses |
| 8 | `complete_wallet_withdrawal(p_success => false)` | Failed payout returned | Same as the debit it reverses |
| 9 | `backfill_wallet_balances` | One-off rebuild from the ledger (no caller) | n/a |
| — | `record_uba_redvault_direct_settlement(_gigl_v1)` | REDVAULT split sale | Merchant's bank: **already recorded as history, no wallet credit** |

Debits: `reserve_merchant_shipping_charge` (GIG bookings), `debit_merchant_wallet`
(weekly auto-payout; the only caller), and the refund reversals
(`finalize_refunded_cancellation_order_v1`, REDVAULT reversals). Manual
withdrawal routes (`/api/wallet/withdraw`, `/api/payouts/request`) are switched
off (404/503). The separate `merchant_balances` ledger already has a
gateway-origin guard (`20260724140000`).

## The fix (this PR)

### Database (append-only)

- `20261103084500_paystack_direct_split_settlement_history.sql`: the
  direct-split marker, the remaining customer-paid GIGL retention rule, and
  `get_order_paystack_split_retained_shipping_kobo`, the checkout read of the
  delivery fee Baci must keep. It is proof-bound (order id, merchant and the
  order's customer email, like checkout itself) and called with the
  request-scoped client, not the admin client.
- `20261103084501_paystack_direct_split_recorders.sql`:
  `record_paystack_direct_split_settlement(_gigl_v1)`, settled history rows
  (`status 'settled'`, `settlement_notified`, description "Settled to your
  bank by Paystack", `paystack_direct_split: true`) with **no wallet
  movement**, mirroring the REDVAULT recorders. They fail closed for any other
  gateway, a missing/malformed subaccount code, a code that is not the
  merchant's registered subaccount, a REDVAULT order, an unknown order, or a
  cancelled/refunded order. The row records what Paystack actually paid: the
  verified `fees_split.subaccount` share is `net_amount`, the verified
  `fees_split.integration` share is Baci's `platform_fee`, and Paystack's own
  fee stays in `gateway_fee` (so a bank-transfer DVA records ₦0 for Baci, and
  a checkout from before the GIG-fee fix does not book the delivery fee as
  Baci's). The GIGL
  variant also records the intended retention and
  `retained_shipping_collected_by_split` (whether Paystack's verified
  `transaction_charge` actually covered it).
- `20261103084502_paystack_direct_split_exposure.sql`:
  `private.merchant_wallet_direct_settled_exposure` and
  `get_merchant_wallet_spendable_balance`: settled Paystack order credits
  that lack proof Baci's own Paystack balance received them
  (`paystack_collection = 'integration'`) and that the owner has not
  reconciled (`legacy_wallet_credit_reconciled = true`). Spendable =
  `available_balance − exposure`, floored at 0.
- `20261103084503_paystack_direct_split_spend_guards.sql`: `debit_merchant_wallet`
  (payouts) and `reserve_merchant_shipping_charge` (GIG bookings) only spend
  the spendable part. Payouts fail with "Paystack-settled sales are not
  withdrawable"; GIG bookings fail with the existing
  `MERCHANT_WALLET_INSUFFICIENT`. `debit_merchant_wallet` also rejects
  non-positive amounts.
- `20261103084504_paystack_direct_split_refund_finalizer.sql`: the cancellation
  refund finalizer treats the new marker like REDVAULT's, so it never debits a
  wallet the sale never credited.

No existing row is changed.

### Application

- `classify-paystack-settlement-collection.ts`: reads Paystack's verified
  payload.
  - `direct_split`: `subaccount.subaccount_code` is a non-empty string,
    `fees_split.subaccount` (the merchant's share, may be 0),
    `fees_split.integration` (Baci's share) and `fees_split.paystack`
    (Paystack's fee) all parse as non-negative integer kobo, and
    merchant + Baci + Paystack = `amount` exactly. That identity held for all
    62 production splits (card, bank transfer and DVA).
  - `integration` (Baci-held): `subaccount` is null, `{}` or has a blank or
    null code, **and** `fees_split` is exactly `null` or shows a merchant
    share of exactly 0. All 46 production Baci-collected
    payments have exactly `subaccount: {}` with `fees_split: null`.
  - `unknown` (fail closed): anything else. That covers no `subaccount` key,
    a non-string code, a split that doesn't add up, an empty subaccount with
    a missing or malformed `fees_split`, or an empty subaccount alongside a
    positive merchant share.
- The weekly payout cron (`api/cron/wallet-payouts`) pays
  `get_merchant_wallet_spendable_balance`, not `available_balance`, for the
  minimum check, the debit and the transfer. If that read fails, the wallet
  is skipped as failed, with no fallback to the raw balance.

- `paid-order-settlement-executor.ts` (+ `resolve-settlement-rpc-routing.ts`):
  for Paystack, `direct_split` → the new history recorders; `integration` →
  the existing wallet-crediting RPCs with `paystack_collection: 'integration'`;
  `unknown` → throws `paystack_settlement_collection_unknown` before any RPC
  (never credit the wallet without proof). Two failure codes:
  - `paystack_settlement_collection_unknown`: the payload lacks the
    `subaccount`/`fees_split` fields. Retryable: the paid-order drain
    re-verifies such a stored payload, so a retry classifies the sale from a
    fresh one; the attempt cap and stranded-row recovery bound it.
  - `paystack_settlement_collection_inconsistent`: the split fields are
    present but contradict each other, or the split is for a different
    amount than the sale (for example a wallet-funding transfer bigger than
    the order). Permanent, because re-verifying cannot change it: manual
    review.
  Every settlement path (main executor, order-update-failure fallback, chat
  orders, manual reconcile) passes the sale's gross for that amount check. REDVAULT, Korapay and Juicyway are
  unchanged. A split to a subaccount that is not the merchant's registered
  one fails with the permanent `paystack_direct_settlement_subaccount_mismatch`.
- A failed chat-order settlement files a `merchant_settlement_failed`
  `reconciliation_review` row (the webhook is acknowledged and Paystack will
  not redeliver), so nothing is lost silently.
- `complete_merchant_invoice_partial_payment` (merchant invoice partial
  payments through a Paystack order DVA) still credits through
  `record_merchant_settlement_gigl_v1` without a `paystack_collection`
  marker. Order DVAs split to the merchant's subaccount, so those credits are
  deliberately counted as not spendable until reconciled; route that writer
  through the classification when it is next touched.
- The chat-order webhook path (`record-chat-order-settlement.ts`), the
  order-update-failure fallback (`record-order-update-failure-settlement.ts`)
  and the manual DVA reconcile script use the same classification, so
  Baci-owned chat DVAs stay spendable (`paystack_collection: 'integration'`)
  and verified splits are history only. On every path a payload that proves
  neither records nothing and the error is logged (fail closed).
- A GIGL direct split whose verified charge did not carry the delivery fee
  records `retained_shipping_amount: 0` (the intended fee is kept as
  `retained_shipping_intended_amount`), so the prepaid-shipping gates never
  let Baci fund a GIG booking with a fee it never received.
- Standard Paystack card init (`api/payments/initialize`, via
  `resolve-paystack-split-transaction-charge.ts`): `transaction_charge =
  platform fee + remaining customer-paid GIGL delivery fee`, mirroring
  REDVAULT, with validation (safe integers, non-negative, clamped to the
  payable amount, `fee + retained ≤ amount`, fail closed on an RPC error).
  The fee is read on the request-scoped client with the order's customer
  email as proof, not with the admin client.
- Storefront bank transfer (DVA) is refused for orders that still owe Baci a
  GIG delivery fee: a subaccount DVA gives Baci ₦0 (production `fees_split`
  shows `integration: 0`), so the fee could not be collected.

### Why the decision comes from the payload, not the gateway name

Not every Paystack order is split. Production (2026-11-03, 131 completed
Paystack payments): 62 payloads name a subaccount, 46 have an empty
`subaccount` (Baci's own balance), 23 have no split data. Treating every
Paystack order as direct-settled would hide real Baci-held money; treating
none as such is today's bug.

## (f) Reconciliation plan for the one live balance (owner decision, no data changed)

Merchant `6b5cb8a4-5575-456c-b936-8cdfae30db74` (ogabassey, the owner's store).
Read-only production figures, 2026-11-03:

| | Amount (₦) |
|---|---:|
| `available_balance` | 10,503,786.26 |
| = 21 Paystack order credits | 10,586,700.39 |
| + VTU commission (106 credits) | 2,565.07 |
| − cancellation refund reversal (1 sale, 2026-08-05) | 36,950.30 |
| − GIG booking (waybill 1349639673, the held duplicate) | 48,500.40 |
| − VTU commission reversals | 28.50 |
| `pending` / `upcoming` | 0 / 0 |
| auto-payout | **off** (it was on until recently; 21 failed attempts since 2026-06-08) |

The 20 still-settled Paystack credits split into:

| Group | Count | Net (₦) | Evidence |
|---|---:|---:|---|
| A. Split to the merchant's subaccount | 15 | 6,241,056.09 | Verified payload names the subaccount; `fees_split.subaccount` = the merchant's share. 6 of them are DVA transfers where Baci's share was ₦0 |
| B. No proof of a split | 5 | 4,308,694.00 | 2026-04-08 ₦502,095.00; 2026-05-09 ₦98.00; 2026-07-20 ₦46,226.00; 2026-07-21 ₦2,070,575.00; 2026-07-31 ₦1,689,700.00. Payloads show `subaccount` empty or absent (DVA / bank transfer) |

After this PR merges, the guard counts all 20 as exposure (₦10,549,750.09), so
the spendable balance is **₦0** and nothing can be paid out or spent on GIG
from this wallet until the steps below are done.

Also note: 4 customer-paid GIG orders (2026-09-23, 09-26, 10-12, 10-19) recorded
₦28,286.77 of retained delivery fee on the ledger that Baci's Paystack split
never collected. None of them has a Baci-booked GIG shipment.

### Steps

1. **Owner checks the Paystack dashboard (read-only)** for the 5 group-B
   payments: did they settle into Baci's own Paystack balance, and has Paystack
   already paid that balance out to Baci's settlement bank? For the owner's own
   store, Baci's settlement bank may be the owner's account, in which case the
   money already reached the owner.
2. **Owner decides**, per group-B payment, "Baci holds it" or "already with
   the owner". Group A needs no decision: the merchant's bank already has it.
3. **One owner-approved, append-only data migration** (separate PR), inside
   one transaction, locking the wallet row:
   - for each group-A settlement: write a `debit` wallet transaction
     (`source_type 'settlement_reclassification'`, metadata
     `{settlement_id, reason: 'paystack_direct_split'}`), subtract its
     `net_amount` from `available_balance` and `total_earned`, and set the
     settlement's metadata to `paystack_direct_split: true,
     paystack_collection: 'direct_split', legacy_wallet_credit_reconciled: true`
     with the "Settled to your bank by Paystack" description;
   - for each group-B settlement marked "already with the owner": the same;
   - for each group-B settlement marked "Baci holds it": set
     `paystack_collection: 'integration', legacy_wallet_credit_reconciled: true`
     only (it stays spendable);
   - assert the resulting balance equals the expected figure below, or roll
     back.
4. Expected results:
   - all 20 reclassified: ₦10,503,786.26 − ₦10,549,750.09 = **−₦45,963.83**.
     The GIG booking (₦48,500.40) was paid out of money Baci never held. The
     held duplicate waybill's auto-refund, if released, returns ₦48,500.40 →
     **₦2,536.57**, which is exactly the net VTU commission (₦2,565.07 −
     ₦28.50). If the refund does not come, the owner either funds the gap or
     records it as an owner-funded booking (see the owner-only GIG mechanism
     below). The migration must not leave a negative balance silently.
   - all of group B "Baci holds it": ₦10,503,786.26 − ₦6,241,056.09 =
     **₦4,262,730.17** spendable.
5. Keep auto-payout **off** for this wallet until step 3 is done and the
   result is checked.

## How this fits PiggyVest (slim plan)

PiggyVest is the system of record for customer money (main wallet and
savings goals), and there is no cash-out to bank. The merchant wallet stays a
narrow internal ledger for GIG booking funds and genuinely Baci-held merchant
earnings (VTU commission, wallet top-ups, Korapay). Direct-settled sales are
history only. Nothing here touches PiggyVest tables, and no service-role
exception is added: the checkout read is proof-bound and called with the
request-scoped client, and the settlement recorders are service-role SQL
functions called from the existing paid-order side-effect graph (see
`docs/agent-guidance/service-role-exceptions.md`).

## Not in this PR (follow-ups)

- **Two pending card checkouts for one GIG order each carry the delivery fee
  in `transaction_charge`.** The checkout read subtracts only recorded
  settlements, so if a customer pays both attempts, Paystack keeps the fee
  twice while settlement history records it once (the second paid attempt
  already goes to review). Fix by reserving the retained amount when a
  checkout starts, or by not retaining it while another attempt for the
  order is pending.

- **Owner-only "ship with GIG without paying from the wallet"**, for the
  owner's store, since Baci's GIG account is owner-funded. Keep it a separate,
  owner-restricted mechanism. After this PR merges, the owner's store cannot
  book wallet-funded GIG shipments (spendable ₦0) until that mechanism or the
  reconciliation lands.
- The reconciliation data migration above.
- An operator tool for side effects that stay failed after the drain's
  re-verified retries (`paystack_settlement_collection_unknown`) or that
  failed with the permanent `paystack_direct_settlement_subaccount_mismatch`.
  Today the manual reconcile script re-verifies a reference and re-runs the
  settlement step.
- Storefront/agentic DVA payments give Baci ₦0 platform fee (subaccount DVA
  split). Card is unaffected. Decide whether DVA should use a split code.
- Dashboard and mobile wallet screens: show direct-split rows as "Settled to
  your bank by Paystack" history and the spendable amount, not
  `available_balance`.
