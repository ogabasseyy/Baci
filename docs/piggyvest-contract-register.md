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
- Identity: RESOLVED 2026-11-11 (§8) — the unique key for a credit is the
  envelope `pvb_reference` (the PVB credit id, `PVB01…`).
  `eventData.transaction_id` is internal-only and will not match the PVB
  credit; `internal_reference` and `session_id` are not unique keys either.
  `eventData.id`, `reference`, `third_party_reference` remain audit fields.
- Schema: `apps/web/src/schemas/piggyvest/events.ts`
  (`bankTransferInflowSuccessEventSchema`), colocated tests pass.
- Ledger (implemented 17 Sep 2026; key changed 2026-11-11, §8):
  `piggyvest_inflow_credits` dedupes on `pvb_reference` (unique column,
  migration `20261112050000`). `eventData.transaction_id` is kept as a
  still-unique audit column and as the plan-transfer projection key of the
  first writer. Previously it deduped on `eventData.transaction_id`.
  Positive amount enforced in app code and by
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
- Attribution: RESOLVED 2026-11-11 (§8) — `interest-payout.success` means
  the payout is settled on PVB; `pvb_wallet` is the PVB wallet that was
  credited, `eventData.destination_wallet` is PVB's internal wallet. The
  ledger attributes to `pvb_wallet` (previously, wrongly, to
  `destination_wallet`, which would have left every real payout unmapped).
- Ledger (implemented 17 Sep 2026; key changed 2026-11-11, §8):
  `piggyvest_interest_payouts` dedupes on `pvb_reference` (previously
  `eventData.id`, now an audit column); gross − tax = net = amount enforced
  in app code and
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
  10 automatic retries, then delivery marked failed. CORRECTED 2026-11-11
  (§8): there is NO endpoint for us to request a resend; retries are
  automatic with exponential backoff only. Once they run out, nothing on
  PiggyVest's side replays the event (operational risk in §8).
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

## 8. Provider answers — 2026-11-11 (PiggyVest engineer, shared WhatsApp group)

Source: PiggyVest's engineer answering our open contract questions in the
shared group on 2026-11-11 (owner shared a screenshot). Recorded verbatim in
substance; no customer data.

(a) **Unique credit key.** The unique key for a credit is `pvb_reference`
(the PVB credit id, `PVB01…`). `eventData.transaction_id` is internal-only
and won't match the PVB credit. `internal_reference` and `session_id` are
not unique keys either.

- Implemented: `piggyvest_inflow_credits` and `piggyvest_interest_payouts`
  gain a `pvb_reference` column with a UNIQUE constraint; the intake insert
  functions require it and use a target-less `ON CONFLICT DO NOTHING`, and
  the read functions take either key. Two deliveries with the same
  `pvb_reference` but a different `transaction_id` credit once.
- The old keys (`provider_transaction_id`, `provider_payout_id`) stay as
  still-unique audit columns, so a different `pvb_reference` reusing an
  internal id cannot insert and is quarantined as a conflict
  (`mismatched_fields: ['pvb_reference']`) rather than credited or acked.
- Existing rows are backfilled from the webhook inbox (`reference` stores the
  envelope `pvb_reference` for these event types). A row with no inbox
  evidence, or whose value would collide, stays NULL; the ledgers find such
  legacy rows by their old key, so a redelivery with the same internal id
  still dedupes. Because a NULL row collides with nothing on
  `pvb_reference`, a redelivery under a NEW internal id could otherwise
  credit twice, so while a NULL row exists for a customer the intake insert
  functions refuse THAT customer's new credits with a retryable `55000`
  (503 / drain retry); other customers are unaffected, and a redelivery
  whose internal id is already stored (the legacy credit itself) is exempt
  and dedupes normally. An operator must set
  those rows' `pvb_reference` from verified evidence. The migration does
  not abort on them, so deploys are not blocked. Runbook check before live
  traffic (read-only):
  `SELECT customer_id, count(*) FROM public.piggyvest_inflow_credits WHERE pvb_reference IS NULL GROUP BY 1;`
  and the same for `piggyvest_interest_payouts`.
  Repair path: `SELECT public.piggyvest_repair_pvb_reference_attribution();`
  (migration owner only; evidence-only, idempotent) re-runs the inbox
  re-attribution and the backfill, e.g. after restoring inbox evidence.
  Rows it still cannot prove need a manual `pvb_reference` from PiggyVest's
  transaction list.
- The inbox applies the same rule at its boundary: a retry of the same
  `eventId` is a duplicate when its `pvb_reference` matches (older rows fall
  back to the inbox `reference` column), even if the internal transaction or
  payout id changed. Before this, such a retry was quarantined before any
  ledger saw it.
- A known `pvb_reference` arriving with an internal id that already belongs
  to a DIFFERENT stored credit is quarantined as a conflict
  (`provider_transaction_id` / `provider_payout_id`), not acked.
- Duplicate verification compares only money and attribution: customer,
  wallet, amounts (inflow `amount`/`fee`; interest gross/tax/net/amount) and
  a non-null stored `pvb_reference`. The eventData internals (`id`,
  `reference`, `session_id`, `batch_id`, `timestamp`, `transaction_id`)
  are audit-only, because PiggyVest guarantees only `pvb_reference` and,
  with no resend endpoint, a false conflict would strand the delivery.
  Drift in those internals on a deduped credit still pages
  (`PIGGYVEST_CREDIT_AUDIT_DRIFT`, field names only), so a reused
  `pvb_reference` or provider bug is seen rather than silently acked.
- Plan-transfer projection key NOT changed: it stays
  `plan-transfer:{provider_transaction_id}` of the stored (first-writer)
  row. Changing it to `pvb_reference` would project already-credited rows a
  second time on their next redelivery, and the projection RPC rejects a
  reused key whose transaction id differs. A redelivery with a new
  `transaction_id` therefore re-projects under the stored id and dedupes.
- Interest dedupe also moved from `eventData.id` to `pvb_reference`:
  answer (a) defines the key for any PVB credit, and `eventData.id` was only
  ever seen in a sample, like the internal ids PiggyVest said not to key on.

(b) **No resend endpoint.** There is no endpoint for us to request a webhook
resend. PiggyVest retries automatically with exponential backoff.

(c) **Interest payout semantics.** `interest-payout.success` means the payout
is settled on PVB. `eventData.destination_wallet` is PVB's internal wallet;
`pvb_wallet` is the PVB wallet that was credited. This matches the 18 Sep
inflow probe (§7), where the nested internal id 404s on the wallet API.

- Implemented: the legacy interest ledger and the inbox attribution
  (`record-input.ts`) use `pvb_wallet`. Interest inbox rows recorded
  earlier stored `destination_wallet` as `wallet_id`; the migration
  re-attributes them to the `pvb_wallet` in their own stored, redacted
  details, so a redelivery of an earlier (e.g. UNMAPPED-failed) payout
  matches its inbox row instead of quarantining as an event-id conflict.
  No ledger repair is needed: an interest payout could only have been
  credited under the old rule if `destination_wallet` (PVB-internal) matched
  a plan-wallet mapping, which it never does, so those payouts failed
  `INTEREST_LEDGER_UNMAPPED` (retryable, never quarantined) rather than
  crediting the wrong wallet. Read-only check before go-live:
  `SELECT count(*) FROM public.piggyvest_interest_payouts p JOIN public.piggyvest_webhook_inbox i ON i.event_id = p.event_id WHERE i.event_details->>'destination_wallet' = p.wallet_id;`
  (expected 0). Before this, a real payout would have
  failed `INTEREST_LEDGER_UNMAPPED` → 503 until retries ran out, and interest
  would never have been credited.
- Primary-wallet paid-interest path (`primary-wallet-paid-interest-signed`):
  unchanged in SQL. Its `sourceWalletId` selection key already carries
  `pvb_wallet`; the operator crosswalk pins all five envelope values exactly
  and credits `apiWalletId`. Operators must provision `apiWalletId` as the
  API id of `pvb_wallet`, never of `destination_wallet`. Open question: the
  crosswalk also pins `destination_wallet`; if PVB's internal wallet can
  differ between payouts, each payout would need re-provisioning
  (`prerequisite`) — confirm on the first live payout.

### Operational risk: unmapped events after retries run out

`INFLOW_LEDGER_UNMAPPED` / `INTEREST_LEDGER_UNMAPPED` (and any other
retryable processing failure) answer 503 so PiggyVest redelivers. With no
resend endpoint, once PiggyVest's backoff is exhausted nothing on their side
replays the event. What exists on ours:

- **Durable capture (exists).** The receiver stores the signed bytes before
  processing (route.ts, R5), so the event is never lost; the capture row
  stays pending (or `needs_review`).
- **Capture drain (exists, gated).** When
  `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED` is exactly `true` and the
  drain runner is actually scheduled, the drain re-processes pending rows up
  to 20 attempts, then parks them `needs_review`. If the drain is not
  attested, PiggyVest's own retries are the only retry path.
- **Missing:** (1) a replay of `needs_review` captures after a fix (the
  drain's park messages now say to replay the capture, not to request a
  resend);
  (2) ~~a reconciler that lists PVB credits by `pvb_reference` and finds
  credits we never recorded~~ — now part of the daily reconciliation
  (`docs/piggyvest-daily-reconciliation.md`, check 6, "Missing credits"): it
  lists each mapped plan wallet's credits via `GET /api/v1/transaction` (row
  `id` = the canonical transaction id that `GET /api/v1/transaction/:id`
  answers for the envelope `pvb_reference`) and pages on a PVB credit id
  neither ledger recorded. It only reads; a person replays the capture or
  repairs by hand. Balance surplus alone (`above_expected`) still never
  pages.

Follow-ups (not in this change): operator replay for `needs_review`
captures; on the first live credit, confirm that the transaction-list row
`id` equals the webhook `pvb_reference` and whether interest payouts appear
in the list (the credit-gap check keeps unlisted interest review-only until
then); confirm the
drain runner is scheduled before live inflows; on the first live payout,
confirm whether `destination_wallet` is stable, and if not stop pinning it
in the paid-interest crosswalk (or alert when `prerequisite` recurs for an
already-mapped `pvb_wallet`).

## 9. Pay from the PiggyVest wallet (wallet pay) — 2026-11-12, dark

Design: `docs/superpowers/plans/2026-11-12-piggyvest-pay-from-wallet.md`.
Migration `20261112161500_piggyvest_wallet_pay`, flag
`PIGGYVEST_WALLET_PAY_ENABLED` (default off; also stopped by
`PIGGYVEST_KILL_SWITCH`; airtime, data and bills also need
`PIGGYVEST_WALLET_PAY_UTILITIES_ENABLED`, so switching on IMEI never switches
them on), collection wallet `PIGGYVEST_COLLECTION_WALLET_ID`
(must equal the `piggyvest_primary.collection_wallets` row). Nothing has been
run against PiggyVest for this flow.

| Contract point | Status | Source / what the code does |
| --- | --- | --- |
| `POST /transfer/wallet` answers 202 "processing", never success | confirmed | §5 probes; transfers.ts. Payment and refund are "submitted" until a TSQ record settles them. |
| TSQ answers 404 for a just-accepted transfer before indexing | confirmed | contract evidence 2026-10-31 P2. A 404 is never proof of absence; only a definitive POST rejection plus `not_found` releases. |
| A business wallet carries no `api_customer_id` | confirmed (sandbox) | 2026-11-02 `house_wallet_unbound_to_customer = yes`. The send step refuses a collection wallet that names a customer. |
| A customer main wallet may send to a business (collection) wallet via the API | **unproven: staging queued but processed no wallet transfer at all on 2026-11-12** (probe below) | Docs: transfers are "from one wallet to another wallet under your account". If PiggyVest refuses, the POST's definitive rejection (400) releases the payment and nothing moves. |
| A business wallet may send back to a customer main wallet (refund) | sandbox-observed | Evidence 2026-11-02-2 P8 "Collection to main": worked; the destination row carries our reference and GET /transaction/:id resolves from both sides. Not confirmed for production. |
| Fee on either direction | **unknown** for production; sandbox 0 | Sandbox P6: the record carries a fee field, `transfer_fee_kobo` 0, exact amounts both sides. Docs: `PATCH /api/v1/business/api-fee-wallet-settings` charges a fee wallet when its flag is set, else the source wallet; an invalid fee wallet "may fail silently". No amounts are published and no fee wallet is known to be set. A record with `fee > 0` is never settled clean: it is recorded `needs_review` and nothing is delivered. |
| TSQ record for these transfers carries our reference in `third_party_reference`, both wallets, `internal_reference = id` | assumed from savings | Same shape as main→goal (evidence 2026-11-04 S12). `customer_id` may be the business id, as there. |
| Refund reporting (which webhook, which side) | docs: sender side only | Docs list `wallet-transfer.outflow.success` (sender) and no wallet-transfer inflow event; whether the receiver gets anything is unknown (P8 had no receiver). Refunds therefore settle from the collection wallet's outflow event plus the TSQ re-query on the sending wallet. The docs sample carries two differing reference-like fields (`initiator_reference`, `pvb_third_party_reference`), so which one echoes ours is unconfirmed; only the TSQ record settles. |
| A reference is unique forever | **unknown** window; sandbox rejects reuse | Sandbox P2: a reused reference is refused (400) with no second movement or record. We never re-post a reference anyway: payments are `pvb-pay-<id>` (one per attempt) and a refund retry takes `pvb-refund-<paymentId>-<n>`. |

| Per-customer limits on API-initiated debits | **unknown** | No evidence (P4 withdrawal counter inconclusive). The only documented refusal is 400 "Insufficient funds", which releases cleanly. |
| Freeze / lien on a wallet | **unknown** whether it blocks business-initiated transfers | Wallets expose `is_frozen` and `has_an_active_lien`; wallet pay refuses to send from or into a flagged wallet (fail closed). |
| A collection (house) wallet exists | sandbox-observed; production: none yet | Sandbox P3 `house_wallet_unbound_to_customer` = yes. The owner must create or designate a production collection wallet; it must not reuse the interest payout wallet without the owner's OK. |

### Staging probe — 2026-11-12 (owner-approved, test money, QA customer only)

One ₦1 round trip on `staging.piggyvest.business`, between the QA customer's main
wallet and the business settlement wallet (no API customer). Masked output only.

- `POST /transfer/wallet` customer main → business wallet: **202 "Wallet
  transfer processing"**, then nothing. For 15 minutes: TSQ on the sender wallet
  stayed HTTP 404 with only `processing_status` in `data`, neither balance
  moved, and neither wallet's transaction list showed a row. So staging accepts
  this direction and then neither settles nor fails it. Wallet pay holds such a
  payment `dispatched` (never delivered, never re-posted); the daily report
  lists it after 30 minutes. **Owner question #1 for PiggyVest: are customer →
  business transfers supported, and why does a 202 leave no record?**
- Reusing the same reference: **400 "Reference already passed, Please try again
  in a few minutes"**. The wording suggests a time window, not uniqueness
  forever. Wallet pay never reuses one.
- Business → customer refund while the business wallet held 0: **400
  "Insufficient funds"**, nothing moved. This is a definitive no-transfer
  refusal; the refund stays owed and the drain retries (`unfunded`).
- Wallet reads: the business wallet answers `type: "settlement"`,
  `api_customer_id: null`, `interest_payout_wallet: null` and no
  `withdrawal_count`. Customer and business wallets both carry `is_frozen` and
  `has_an_active_lien` (false here). **Bug found and fixed**: `retrievePiggyvestWallet`
  rejected `null` and a missing `withdrawal_count`, so every wallet payment
  would have been refused as unavailable.
- Docs check after the probe (2026-11-12): no page says which wallet types may
  send or receive `POST /transfer/wallet`. The wallet list endpoint documents
  only `api` wallets, the fee settings speak of "API wallet" transfers, and
  our business wallet is `type: "settlement"`. Likely cause, not confirmed:
  `/transfer/wallet` only settles between `api` wallets, and a settlement
  wallet destination is accepted (202) and then dropped. The fix would then be
  an `api`-type collection wallet owned by the business (no API customer), or
  PiggyVest enabling settlement-wallet transfers. TSQ's documented statuses are
  `success`/`pending`/`failed`; `GET /transaction/:id` adds `partial`.
  `processing_status` (what our 404 carried) is not documented anywhere.
- The business settlement wallet is a pass-through: `auto_payout: true` and
  `auto_withdrawal_destination_type: "wallet"`, forwarding to the business
  `expense` wallet (the Pay with Pocket wallet). Its balance always reads 0, so
  it can never fund a refund and is unusable as the collection wallet. All three
  business wallets (settlement, expense, savings) showed no transactions after
  the probe, so the 202-accepted payment was not forwarded either: it never
  moved.
- Option B (owner-approved: Ogabassey as its own API customer, its main API
  wallet as the collection wallet) could not be set up in staging. Creating the
  customer is refused: the all-zeros sandbox BVN answers "Customer already
  exists" (one customer per BVN), and other BVNs answer "An error occurred
  creating customer". It needs another sandbox BVN that staging accepts, or a
  named sandbox customer to stand in. The collection-wallet check in code is
  unchanged until a transfer into an Ogabassey API wallet settles.
- Second destination tried (same day, same QA customer, ₦1 test money): the
  business `expense` wallet (no API customer, `auto_payout: false`, the wallet
  the settlement wallet forwards to). Same outcome: 202 "Wallet transfer
  processing", then for 6 minutes no row on either wallet, no balance change,
  and TSQ 404 now carrying `processing_status: "initiated"`. So in staging a
  customer API wallet cannot pay ANY business-owned (non-API) wallet; only
  API-wallet ↔ API-wallet transfers (main ↔ goal) are proven.
- Creating a new API customer for Ogabassey fails for every BVN except the
  taken all-zeros one: `11111111111`, `12345678901`, `22222222222`, the docs' cURL example `22112200222`, random
  values, minimal bodies, local/international phones, and with a NIN all
  answer 400 "An error occurred creating customer". Staging appears to verify
  BVNs; Option B needs a sandbox BVN PiggyVest staging accepts (never a real
  person's BVN).
- **Correction (later the same day): staging is not processing ANY wallet
  transfer today, so the "customer → business unsupported" reading above is
  withdrawn.** A control transfer of the kind that settled on 2026-11-04/06
  (QA main → the QA customer's own goal wallet, both `api` wallets) also stayed
  at 404 "Transaction Not Found" + `processing_status: "initiated"` for
  6 minutes, with no balance change. So did QA main → another customer's main
  API wallet (the all-zeros-BVN sandbox customer: not the QA customer, bound to
  no app account). The 202 reply carries PiggyVest's own id
  (`data.reference`, `PVB01…`); TSQ by our reference, TSQ by the PVB id, and
  GET /transaction/:id all answer the same 404/`initiated`, and the source
  wallet lists no pending row. Reading: PiggyVest queued every transfer and
  its staging worker is not picking them up. **Re-run the probe when staging
  processes transfers again.** Nothing about customer → business is proven
  either way.
- **Root cause found (16:40 UTC): outbound transfers are paused on the staging
  account.** History shows p2p transfers settling up to 2026-11-09 11:04 UTC
  (wallets created the same day sent successfully, so new customers are not the
  issue) and none since. A control ₦1 from a wallet that sent on 2026-11-08 got
  **403 "Outbound transfers are paused, please contact support"** at POST time,
  nothing moved. The QA-wallet transfers were accepted (202) and parked at
  `initiated` instead. Unpausing is a dashboard or PiggyVest support action. The
  wallet-pay client maps 403 to PIGGYVEST_AUTH_ERROR, a definitive no-transfer
  rejection, so a paused account releases the payment cleanly. A 202 that parks
  at `initiated` stays pending (correct: it may still execute after an unpause).
- **Five ₦1 test transfers are queued at PiggyVest staging** (QA main → the
  settlement wallet, → the expense wallet, → the all-zeros customer's main
  wallet ×2, → the QA goal wallet). If the worker resumes they may all execute:
  ₦5 of test money leaves the QA main wallet, the goal-wallet one is unknown to
  our books (the daily reconciliation would list the goal as above expected,
  REVIEW only), and none has a refund. Re-read balances when staging recovers.
- `processing_status` is an undocumented field on the TSQ 404 body; `initiated`
  means queued, not failed. Wallet pay already treats a TSQ 404 as "not
  proven absent" and holds the payment pending, which is right for this.
- Not observed (no transfer completed): the fee on a completed transfer, the
  TSQ record shape for these directions, and webhooks.

Read-only checks before go-live: the collection wallet row and env agree; a
staging round trip (pay ₦100, force a failed delivery, see one refund) with
the sandbox key; `read_wallet_pay_reconciliation` empty after it.
