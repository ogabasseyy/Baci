# PiggyVest contract register

Evidence checked: 17 September 2026. Source: provider message with two
sample webhook payloads plus fee/charge notes. Local base: `d0d1cbd2fd`.

Status labels: `confirmed` (source-backed), `testable locally`
(schema + synthetic tests, no provider call), `blocked` (needs provider
input before activation).

No secrets, customer data, or raw provider bodies belong in this file.
All fixtures in colocated tests use synthetic identifiers.

## 1. Webhook events

### 1.1 `bank-transfer.inflow.success` — testable locally

- Envelope: `eventId`, `eventType`, `eventCategory: bank-transfer`,
  `customer_id`, `eventData`, `pvb_reference`, `pvb_wallet`, nullable
  `pvb_destination_wallet`, `pvb_third_party_reference`,
  `pvb_schedule_payment_id`, `pvb_destination_account_creation_reference`,
  `pvb_meta`.
- Money: integer kobo, `currency: NGN`. Balances
  (`destination_wallet_balance`, `destination_wallet_ledger_balance`,
  `destination_transaction_balance`), `amount`, `fee` all kobo.
- Identity: `eventData.id`, `transaction_id`, `reference`,
  `third_party_reference`, `internal_reference`, `session_id` are candidate
  reconciliation keys; exact dedupe scope still blocked (see §3).
- Schema: `apps/web/src/schemas/piggyvest/events.ts`
  (`bankTransferInflowSuccessEventSchema`), 9 colocated tests pass.
- Activation: blocked. No signed raw sample, no retry/redelivery contract,
  no staging credentials. Schema acceptance is not financial acceptance.

### 1.2 `interest-payout.success` — testable locally

- Envelope: `eventId`, `eventType`, `eventCategory: interest-payout`,
  `customer_id`, `eventData`, `pvb_reference`, `pvb_wallet`,
  `pvb_accrued_interest_wallet`, nullable `pvb_destination_wallet`,
  `pvb_third_party_reference`.
- Money: integer kobo. `eventData.break_down` gives
  `gross_interest_payout`, `withholding_tax`, `net_interest_payout`;
  sample satisfies gross − tax = net (100000 − 5000 = 95000).
- Recognition rule (from product-rules doc, now with confirmed shape):
  only the reconciled net payout counts toward purchasing power; pending
  accrual is never spendable. Each payout needs a durable unique provider
  payout identity before credit; duplicates must not double-credit.
- Schema: `interestPayoutSuccessEventSchema`, colocated tests pass.
- Activation: blocked, same as §1.1.

## 2. Currency and fees — confirmed shape, payer unresolved

- Currency units confirmed: kobo integers on API and webhooks.
- Wallet-funding charges (provider message): ₦50,000 and below → ₦50
  (5000 kobo); above ₦50,000 → ₦75 (7500 kobo).
- Pay-with-Pocket: 0.5% capped at ₦1,000 (100000 kobo).
- Fee payer, production confirmation, and settlement mechanics remain
  unresolved. Implementation rule: store an unknown fee as unknown, never
  zero; do not silently reduce a promised principal refund to pay a fee.

## 3. Still blocked (do not activate on these samples alone)

- Webhook retry/replay: provider confirming internally, no contract yet.
  No redelivery, ordering, retention, or duplicate-behavior evidence.
- Signature serialization: no signed raw HTTP sample; exact bytes vs
  `JSON.stringify` unsettled. Do not accept multiple guessed
  canonicalizations.
- `eventId` uniqueness scope and stability across retries: unconfirmed.
- Authentication: no credential verification or staging-base auth check in
  this update. No transfer-status terminal enums confirmed.
- Bank account numbers/names appear in inflow payloads: never log raw
  bodies, signatures, or provider response bodies.

## 4. What these samples unblock next

- Versioned Zod schemas for exactly these two events (done, this change).
- Durable-inbox design against real field shapes (Task 3), still without
  external activation.
- Sandbox slice stays gated: signed sample + retry contract + isolated
  storage/credential approval + read-only auth check, in that order.
