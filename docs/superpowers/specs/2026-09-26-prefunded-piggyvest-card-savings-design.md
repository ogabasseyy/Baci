# Prefunded PiggyVest card contributions

Date: 26 September 2026.
Status: funding model selected by the owner; written design awaiting review.
Scope: isolated staging first. No production activation or treasury movement.

## T+1 discovery and live staging result

The prefunded model below is not the only documented provider option.
PiggyVest also documents `POST /api/v1/transfer/tplusOne` with Paystack as a
provider. A genuine Paystack sandbox card payment was submitted to that
endpoint on 26 September 2026. PiggyVest returned HTTP 403 with
`Tplus one not activated for your business`. The probe wallet balance and
durable webhook receipt count stayed unchanged.

This proves that the tested staging business lacks T+1 activation, not that
PiggyVest cannot support Paystack funding. Do not implement prefunding on that
incorrect premise or claim T+1 settlement works. Activation, settlement linkage,
credit timing and retry semantics remain to be established with the provider.
See [the measured test report](2026-09-26-piggyvest-tplus-staging-test.md).

## Outcome and chosen model

The customer can add to an existing savings plan with a card while PiggyVest
actually holds the resulting savings principal. Ogabassey fronts that principal
from its own prefunded PiggyVest business wallet after verified Paystack card
collection. Later Paystack settlements help replenish the business float through
a separate treasury operation. This is not Paystack split settlement and is not
a direct movement of Paystack test money into PiggyVest.

Manual plans keep the bank account visible and offer optional card funding.
Adding a card does not enroll the customer in automatic debits. An extra card
contribution to an auto-debit plan does not change its schedule or next due date.
An accepted request is not displayed as completed savings until provider funding
and the app's durable contribution projection both succeed.

## Current code boundaries, checked locally

- `apps/web/src/app/api/storefront/customer/savings/funding/route.ts` concerns
  plan provisioning/funding-account access, not a card-to-PiggyVest transfer.
- `apps/web/src/lib/customer-savings-auto-debit-process.ts` currently charges a
  saved authorization, credits the internal Baci wallet and allocates from it.
  Its internal-wallet completion must not be reused as PiggyVest funding proof.
- `apps/web/src/app/api/storefront/customer/savings/auto-debit/authorize/route.ts`
  uses a separate authorization transaction and `credit_wallet` accounting.
  Its existing behavior is not silently changed for unrelated consumers.
- `apps/web/tools/staging-wallet-payments/handler.ts` confirms Paystack test
  collections into the internal test wallet. It is not a treasury bridge.
- `apps/web/src/lib/piggyvest/collection-reconciliation.ts` records pending or
  unknown correlation metadata only; it neither authorizes spending nor credits
  money. Do not broaden that existing contract into a payment processor.
- `tools/staging/piggyvest-goal-funding/projection-functions.sql` currently
  projects eligible bank inflows into legacy manual goals. A peer-wallet transfer
  and an auto-debit goal require their own validated event support; do not relabel
  an outflow event as a bank inflow just to reuse the projection.

These are source observations, not fresh claims about VPS services or balances.

## Provider facts and evidence gap

[PiggyVest wallet transfers](https://www.piggyvestbusiness.com/docs/api/transfers/wallet)
take `amount` in kobo, `source`, `destination`, `currency` and our `reference`.
HTTP 202 means processing, not final success. Its
[TSQ endpoint](https://www.piggyvestbusiness.com/docs/api/transfers/status) is
`GET /api/v1/transaction/verify?reference=...`, optionally with `wallet_id`.
The published TSQ example is bank-oriented; it does not establish all the
source/destination identity fields needed for this peer-wallet funding flow.

The [event list](https://www.piggyvestbusiness.com/docs/webhooks/events) includes
`wallet-transfer.outflow.success`. The generic
[payload page](https://www.piggyvestbusiness.com/docs/webhooks/payload) does not
give its full event-specific shape. Capture genuine staging transfer evidence
and establish correlation before enabling customer card charges. Do not assume
a matching bank-inflow event also arrives, or that repeating a POST is safe just
because a reference is present.

[Paystack verification](https://paystack.com/docs/payments/verify-payments/)
provides the transaction status inside `data`, separate from API-call success.
Its [recurring-charge guide](https://paystack.com/docs/payments/recurring-charges/)
supports reusing a reusable authorization from a successful payment. Server
verification and durable fulfillment deduplication remain mandatory.

## Money and ownership invariants

1. A server-selected, separately provisioned treasury binding identifies the
   environment, integration, merchant, business, source wallet and fee policy.
   Never use a customer's ordinary wallet, plan wallet or old probe wallet as the
   float by inference. Never accept source/destination IDs from the phone.
2. Pin the destination to the existing trusted customer/merchant/goal mapping.
   Recheck mapping, goal eligibility and ownership before financial dispatch.
   Pausing or cancelling before collection prevents collection. After collection,
   reconcile the obligation rather than dropping it or silently redirecting it.
3. Use integer kobo throughout the new operation. Reject fractional kobo, invalid
   currency, unsafe ranges and amounts beyond the goal's unreserved remainder.
   The displayed savings amount is principal, not settlement net of fees.
4. Before charging, atomically reserve both goal capacity and sufficient company
   float, including the configured fee allowance. A balance read alone is not a
   concurrency-safe reservation. Serialize reservations against one treasury row.
5. Track a conservative spend budget backed by verified company prefunds. Reserve
   operations reduce it; confirmed transfers consume it. Do not restore capacity
   from an old balance snapshot, an expired worker lease or an unresolved timeout.
   Reconcile provider available balance too; stale evidence, unrecognized outflows
   or a budget mismatch stop new charges and alert the operator.
6. A verified Paystack collection creates a funding obligation, not spendable Baci
   wallet credit or completed plan principal. Only the PiggyVest fulfillment
   projector credits savings. Settlement replenishment never credits a customer
   again, and interest accounting remains separate and unchanged.
7. First staging release supports only verified zero-fee test transfers. Production
   fees need an approved policy: either Ogabassey absorbs them or the customer sees
   and accepts a separate quoted charge. Never silently reduce the plan credit or
   enable real charges with an unconfigured fee policy.

## Durable operation and dispatch

Create a dedicated card-contribution operation, not a second savings balance.
Persist its immutable scoped identity, amount, saved-method ID, payment purpose,
environment, destination, fee allowance, idempotency key and request fingerprint.
Allocate separate stable Paystack collection and PiggyVest transfer references
before either provider call. Reusing a key returns the existing operation; a
changed fingerprint returns a conflict. Provider references are unique within
their environment/integration and cannot fulfill another operation.

Store collection and fulfillment states separately:

| Dimension | States |
| --- | --- |
| Collection | not_started, dispatching, action_required, pending, unknown, verified_success, verified_failed, reversed |
| Fulfillment | not_started, dispatching, pending, unknown, verified_success, verified_failed |
| Projection | unapplied, applied, reconciliation_required |

Write the dispatch claim and immutable request before sending it. One leased
worker owns each attempt; fencing prevents a stale worker committing transitions.
After a crash or uncertain provider response, a replacement worker verifies the
same reference instead of sending another financial request. Lease expiry alone
never grants a new charge/transfer attempt. Do not promise provider-side
exactly-once execution from database locking alone.

Verify Paystack status, reference, amount, NGN, test/live domain, customer and
stored authorization ownership using trusted server state. A callback merely
wakes reconciliation. Malformed responses, transport errors and pending states
are not declines and must not release an unresolved charge's reservation.

Only verified collection success permits PiggyVest transfer dispatch. Persist
raw verified provider evidence in restricted storage. Correlate final transfer
evidence with the original request, expected business, source, destination,
amount, currency and provider transaction identity. TSQ/webhook races converge
on the same operation; incomplete identity evidence stays pending review.

Both the transfer worker and bank-inflow replay must use one database-owned
credit-claim registry and atomic projector. Before dispatch, register our unique
transfer reference against the operation and immutable source/destination/amount.
Validated transfer receipts resolve to that operation as the canonical economic
identity. Record provider transaction IDs as unique aliases of that identity;
different outflow/inflow IDs require evidence linking them to the same transfer,
not a guess based on equal amounts or nearby timestamps.

A related inflow resolves to the same operation before any contribution insert.
An unrelated, positively identified bank deposit keeps its existing namespaced
provider-transaction identity. Ambiguous receipts for an enabled bridge wallet
are retained for reconciliation rather than allowed through an independent
legacy credit path. Missing correlation evidence never means "new money".

An append-only migration must adapt the existing inflow projection to this shared
claim/project transaction, preserving its deposit replay semantics. Every active
receipt worker must use that boundary, with obsolete bypass grants withdrawn,
before the bridge activates. Unique canonical claims cover the contribution
insert, goal update and operation fulfillment in one transaction. Transfer plus
inflow, different event IDs and replay across old/new receipt workers must prove
one economic credit in SQL concurrency tests. Conflicting evidence is quarantined.

If collection succeeded but funding is pending/failed, show "Payment received;
savings funding pending" and alert operations. Do not charge again. A refund
decision is separate, idempotent and reconciled; never initiate a refund while
the PiggyVest outcome is unknown. A late transfer success after a refund or a
Paystack reversal after fulfillment opens a loss/reconciliation case, not another
credit or an unapproved automatic clawback from the customer.

## App and API boundaries

- A customer-authenticated, scoped capability read reports account readiness,
  saved-card availability, contribution limits and whether the bridge is enabled.
  Never expose business float balances, secret authorization codes or credentials.
- One-off contribution creation requires validated input, CSRF protection, current
  customer/goal ownership, a scoped saved-method ID and durable idempotency key.
  The customer can read only their operation's redacted status.
- Provider requests and credential reads belong to a restricted worker. User
  routes use authenticated RLS/RPC access, not a service-role client. New tables
  and RPCs have explicit least-privilege grants; old migrations remain untouched.
- Manual plans show their bank account regardless of ordinary-wallet balance.
  With a saved card, show amount and Charge card. Without one, Add a card opens a
  disclosed first-contribution amount followed by Paystack-hosted checkout, with
  explicit consent to save the reusable card. Do not silently collect the old
  small authorization fee or start a recurring schedule.
- A charge requiring customer authentication stays action-required and uses the
  provider-supported checkout/action for the same operation. Do not submit a new
  charge to work around 3-D Secure or OTP. Resume server verification after return;
  closing that screen is not proof that the payment failed.
- Auto-debit plans use the same one-off contribution flow for Add to savings.
  Migrating the recurring scheduler is a separate step: when enabled it must use
  this same funding engine with the existing due-period identity, never run the
  legacy internal-wallet collector and new collector on the same occurrence.
- Cancel before dispatch may release reservations. Closing the sheet after a
  request does not cancel its financial operation; reopening restores its status
  and key. Double taps and network retries cannot create another operation.

## Staging activation and acceptance

Use existing staging services and exact public-route allowlists where possible;
do not invent another ad hoc payment server. Keep current bank funding working.
Do not widen the gateway, change secrets, extend its lease or redeploy production
as a side effect of selecting this model.

Before enabling the card controls, require all of:

1. Reviewed append-only storage/RPC changes and unit, SQL, concurrency and restart
   tests for reservations, double submission, decline, timeout, scope mismatch,
   forged evidence, webhook/TSQ ordering, duplicate economic credit and reversals.
2. Verified dedicated staging source wallet, company test float, fee behavior,
   customer destination mapping and restricted worker credentials. The exact
   source and test amount require explicit operational selection before transfer.
3. A small owner-authorized PiggyVest-only staging transfer that proves the actual
   event/TSQ contract and source debit/destination credit. This must not first
   charge a customer to discover whether the transfer rail works.
4. A Paystack test collection linked to a PiggyVest staging transfer: one collection,
   one treasury debit, one destination credit, one app contribution. Replaying
   delivery/reconciliation produces no additional value. Test systems simulate
   separate legs; this is not proof of real inter-provider cash settlement.
5. Phone checks on the correct Metro worktree: manual account-first display,
   card checkout/return, persisted pending state, final progress update, retry,
   cancellation, expired login and unchanged manual/auto schedule settings.

Low-float alerts and an operator replenishment report belong to this release;
automatic bank sweeps and production treasury automation do not. No float amount
is inferred from earlier probe balances. The actual top-up and production fee
policy remain explicit operational decisions, not hidden defaults.

## Work staged in this turn

This design and the adjacent mobile funding-status note are documentation only.
No product code, migration, credential, running service, provider wallet or card
has been changed. Model selection is approved; the written design still requires
review before the implementation plan and payment code are prepared.
