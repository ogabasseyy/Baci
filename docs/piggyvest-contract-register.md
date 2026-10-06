# PiggyVest contract register

Evidence checked: 17 September 2026. Source: provider message with two
sample webhook payloads plus fee/charge notes, official docs pages, and a
live staging probe run the same day. Local base: `d0d1cbd2fd`.

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
  (`bankTransferInflowSuccessEventSchema`), colocated tests pass.
- Ledger (implemented 17 Sep 2026): `piggyvest_inflow_credits` dedupes on
  `eventData.transaction_id`; positive amount enforced in app code and by
  CHECK constraint; zero-amount inflows ack as failed poison without
  credit. No sender PII columns (register-level rule, enforced by the SQL
  regression test). A credited inflow records provider confirmation —
  wallet balances remain live provider reads.
- Activation: live receipt still blocked on dashboard registration.

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
- Ledger (implemented 17 Sep 2026): `piggyvest_interest_payouts` dedupes
  on `eventData.id`; gross − tax = net = amount enforced in app code and
  by CHECK constraints; inconsistent payouts ack as failed poison without
  credit; snapshots sum net per wallet. Inbox claim re-wins `failed` rows
  so storage-error redeliveries re-attempt the credit.
- Activation: live receipt still blocked on dashboard registration.

## 2. Currency and fees — confirmed shape, payer unresolved

- Currency units confirmed: kobo integers on API and webhooks.
- Wallet-funding charges (provider message): ₦50,000 and below → ₦50
  (5000 kobo); above ₦50,000 → ₦75 (7500 kobo).
- Pay-with-Pocket: 0.5% capped at ₦1,000 (100000 kobo).
- Fee payer, production confirmation, and settlement mechanics remain
  unresolved. Implementation rule: store an unknown fee as unknown, never
  zero; do not silently reduce a promised principal refund to pay a fee.

## 3. Still blocked (do not activate on these samples alone)

- Webhook retry/replay: RESOLVED 17 Sep 2026 — provider confirms up to
  10 automatic retries, then delivery marked failed, plus manual resend.
  Treat every webhook as at-least-once; handler must be idempotent and
  return 2xx only after the event is durably recorded. Implemented:
  inbox collapses on `event_id` PK, duplicates ack without reprocessing,
  inbox-write failure returns 503 to trigger redelivery. Ordering and
  retention windows still unstated — never assume ordered delivery.
- Signature serialization: RESOLVED 17 Sep 2026 — provider confirms
  hex(HMAC-SHA512(secret, raw_body)) over the exact wire bytes in
  `x-pvb-signature`; secret is the API secret key. This supersedes the
  docs-page `JSON.stringify(req.body)` sample. Implemented with
  timing-safe compare; invalid signatures ack 200 without processing
  (per docs) so forged traffic does not consume retries. Still missing:
  key-rotation and replay-window terms. (The sample signature value in
  the provider message was garbled/non-hex; the formula is
  authoritative, the sample is not evidence.)
- Webhook URL registration: fixed 17 Sep 2026 — GET now answers the
  delivery-provider reachability probe with 200 while POST intake stays
  503-gated. Registration must be re-attempted provider-side.
- `eventId` uniqueness scope and stability across retries: unconfirmed.
- Authentication: RESOLVED 17 Sep 2026 — staging Bearer auth verified
  live (see §5). Transfer-status terminal enums still unconfirmed (no
  settled transaction to query yet).
- Bank account numbers/names appear in inflow payloads: never log raw
  bodies, signatures, or provider response bodies.

## 4. What these samples unblock next

- Versioned Zod schemas for exactly these two events (done, this change).
- Durable-inbox design against real field shapes (Task 3), still without
  external activation.
- 17 Sep 2026 update: envelope-routed schemas added for the four remaining
  officially listed events (`create-wallet.success` with documented
  `create_wallet` category; reserve/outflow events with unpublished
  categories left open). Durable inbox implemented: `event_id`-PK table
  with no raw-payload column, record/claim/resolve module, SQL regression
  test. Provider API client layer added (customers, wallets, funding,
  interest, test-mode fund) against official endpoint specs; all
  synthetic-tested, no live calls.
- Sandbox slice stays gated: signed sample + retry contract + isolated
  storage/credential approval + read-only auth check, in that order.
- 17 Sep 2026 live probe: auth check done (§5); inflow verification still
  blocked on provider-side test-funding settlement.
- 17 Sep 2026 processor slices: restriction flips and outflow terminals
  implemented. Restriction events attribute by `pvb_wallet` or
  `eventData.wallet_id` (both optional — shapes unpublished);
  unattributed restrictions ack failed without flipping any row. Lifts
  re-derive ready/provisioning from a live retrieve, never assume ready.
  Outflow success/failed attribute by reference candidates against the
  `piggyvest_transfer_outbox` (our submitted references); first terminal
  state wins atomically, unmatched events resolve without effect, and
  destinations stay masked (wallet id or bank code + last4).

## 5. Live staging verification — 17 Sep 2026 (probe, redacted)

Staging base `https://staging.piggyvest.business`, Bearer = secret key.
Credentials live only in the gitignored `apps/web/.env.local`; probe
scripts stayed in `/tmp` and were never committed.

- Bank list: 200, 384 banks. Entries carry undocumented extra fields
  (`logo`, `primary_color`); our strip-unknown schema held. Provider
  message text differs from docs ("All bank list retrieved
  successfully") — we never assert on messages.
- Create customer: live `customer_id` + auto-generated default
  `wallet_id` + `new_customer: true`, exactly our schema. Staging
  accepts an all-zeros synthetic BVN.
- Create wallet: the POST hung past our 30s client timeout
  (`PIGGYVEST_NETWORK_ERROR`) but HAD minted the wallet — confirmed via
  the list endpoint (`status: active`). Rule confirmed: a timeout after
  POST means unknown, never failed; reconcile via list/retrieve before
  retrying, and keep `subaccount_name` deterministic so a retry cannot
  mint a duplicate. Follow-up: consider a longer, per-call timeout for
  provisioning endpoints.
- Retrieve wallet: schema held (`status`, `balance`, `withdrawal_count`,
  rates). Staging rates are 0/0.
- Funding accounts: virtual account auto-reserved on the subaccount
  (`FAAS (SANDBOX)` bank), shape matches our schema including null
  paypoints. Real account numbers exist in staging — never log them.
- Test-mode funding: NOT settling. Three calls across two wallets all
  returned 200 "Funding Processing" but produced zero balance change
  and zero ledger entries after 10+ minutes. Provider-side staging
  issue; inflow verification and TSQ terminal states stay blocked until
  the provider confirms or fixes settlement. Do not work around by
  crediting off the accepted response.
- Webhook receipt still unverified. Public staging URL confirmed
  reachable 17 Sep 2026: `https://staging.ogabassey.com/api/webhooks/piggyvest`
  (GET 200 `registration_ready`, `eventProcessing: disabled`). Note: this
  host serves different code than this branch (response shape differs from
  our route) — staging deployment is owned separately. 18 Sep 2026: added
  the staging secret under four candidate env names (exact name their code
  reads is unknown — source not in any local checkout) and redeployed;
  a correctly-signed probe now returns 200, so real provider deliveries
  should verify. Bad-signature POSTs still 503 there (their code maps
  invalid signatures to NOT_READY — flag: docs say ack 200 so forged
  traffic does not burn the 10 retries). Signed end-to-end delivery still
  needs a provider resend to confirm.

## 6. Quarantine + mapping-gate slice — 18 Sep 2026 (this branch, uncommitted)

- Authentic-but-unparseable, unknown-shape, and same-identity conflicting
  deliveries are now durably quarantined
  (`piggyvest_event_quarantine`, digest-collapsed, redacted detail only)
  and acknowledged 200. Retries cannot fix them, so they no longer burn
  the provider's 10 attempts; nothing quarantined touches financial
  state. This intentionally supersedes the interim 503-on-unknown
  behavior: the 503 was waiting on replayable storage, which now exists.
- Inflow and interest credits now require a verified plan-wallet mapping
  (`resolvePlanWalletMapping`: provider customer + wallet pair must match
  a mapping row; customer mismatch resolves to null). Unmapped credits
  fail retryable (UNMAPPED, route 503s) so the creation-race redelivery
  can still land; mapping storage errors fail closed.
- The inbox stores a redacted event-detail projection (allowlisted
  reconciliation fields; bank account numbers/names, sender names,
  narrations and IPs never stored) so a future worker can replay
  pending rows. Unknown shapes store NULL details.
- Same-eventId different-content redeliveries return `conflict`:
  first writer wins, the conflicting observation is quarantined.
- New migrations use unquoted type names throughout. Local PostgreSQL
  verification 18 Sep 2026: full 10-migration chain applies in order,
  7/7 SQL regression tests pass. The inbox/outbox quoted numerics were
  corrected under owner approval the same day; the new `event_details`
  column received an additive service-role INSERT grant, and the
  quarantine table carries least-privilege service-role grants.

## 7. Genuine observed event — 18 Sep 2026 (staging, test funding)

First provider-origin `bank-transfer.inflow.success` (eventId
`01M2TTNT0N08C81J5BEADH3BY8`, 17:57:47 UTC) for the 10,000-kobo probe
funding; both funded wallets read 10,000 kobo by 18:00 UTC. Vercel logs
show two 200 POSTs at 18:57:54/57 local matching the event timestamp.
Receipt count in the isolated DB is unverified (no access).

Shape deviations from the earlier samples (schemas updated, this
branch — samples alone would have quarantined this genuine event):
category `inflow_transaction` (not `bank-transfer`); `type: "inter"`
(not `"inflow"`); `status: "COMPLETED"` (not `"success"`); no
`source_wallet_id`/`attempts`/`session_id` keys; null senders; absent
nullable `pvb_*` envelope keys; many extra provider-internal keys
(lock/batch/retry/tax) which are ignored, never stored.
`destination_wallet_id` (`01M2T3QAGM…`) differs from `pvb_wallet`
(`01M2T3PCE…`, the credited plan wallet): mapping now matches either id
with the customer verified, and credits record the plan wallet.
`session_id` is now nullable in the ledger (additive migration).
Unfiltered transaction list still read 0 at 18:00 UTC despite settled
balances — lag or test fundings never list; watching.

18 Sep 18:12 UTC round (owner-verified live): second 10,000-kobo funding
settled; probe wallet at 20,000 kobo (balance and ledger balance agree);
PiggyVest lists two successful 10,000-kobo credits; second inflow
webhook received 18:12:45 UTC reporting the 20,000 balance. Both
probe-wallet inflow events omit `session_id` — nullable handling
confirmed correct. Repeat funding, settlement and delivery all work; no
resend needed. Wallet-ID relationship resolved as far as observable:
`pvb_wallet` retrieves the funded API wallet while the nested
destination id 404s on that endpoint — `pvb_wallet` is authoritative
for API reconciliation; the internal id remains undocumented.
