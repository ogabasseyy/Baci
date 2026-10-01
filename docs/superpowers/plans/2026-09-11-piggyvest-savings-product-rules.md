# PiggyVest Savings Product Rules and Acceptance Specification

Companion to `2026-09-11-piggyvest-staging-integration.md`. Updated 11 September 2026 after owner review. This document specifies local implementation requirements, not deployed behavior, provider certification or permission for external changes. No real funds or customer data may be used for testing.

## 1. Decision register

| Topic | Recorded direction | Implementation boundary |
| --- | --- | --- |
| Wallet model | Dedicated provider wallet per plan; separate ordinary wallet and business settlement wallet. | Verify provisioning limits and actual settlement destination. No arbitrary four-plan limit. |
| Interest opt-in | Customer interest begins only on funds allocated to an opted-in savings plan. | Earlier ordinary-wallet interest is not retroactively customer plan interest. Company's entitlement to ordinary-wallet interest requires documented terms; do not book it as revenue merely because the owner intends it. |
| Customer cancellation | Refund remaining contributed principal; zero percentage cancellation fee; forfeit all interest attributable to that plan, including previously credited interest. | Owner policy, not PiggyVest policy. Requires reviewed terms, explicit consent and a confirmed entitlement/transfer mechanism before activation. No unrelated-wallet clawback. |
| Price promise | Guaranteed device price after activation, without claiming physical inventory was purchased or reserved. | Snapshot exact device variant/condition and price server-side. No misleading stock-reservation copy. |
| Activation | Previously accepted direction: draft is free; 5% initial contribution activates the price lock. | Clarify base as the server-quoted device price; use confirmed funds, not an initiated debit. Snapshot quote and expiry before payment; obtain fresh consent if it expires. |
| Duration | Previously accepted direction: up to six months plus 30-day grace. | Define calendar arithmetic, timezone and maturity behavior in tests; no automatic forfeiture or principal seizure at expiry. Expiry disposition still needs owner confirmation. |
| Contributions | Flexible manual or scheduled contributions, with additional contributions allowed. | Existing Paystack collection is not automatically replaced by a PiggyVest transfer schedule. One collection owner per plan. |
| Device change | Accepted direction: no cancellation fee; preserve principal and eligible interest, confirm new device price; original deadline by default. | A change is not a cancelled/new plan. Reuse the existing plan wallet; obtain explicit confirmation of new terms. |
| Early readiness | Funds cover the lower of guaranteed price and current price for the identical device. | Only confirmed principal and eligible paid interest count. Pause future scheduled collection; require Review & buy, never auto-order. |
| Lower-price offer | Seven-day offer window was proposed in the accepted review. | Snapshot the offer and its expiry explicitly; a expired offer never overrides a still-valid guaranteed price. |
| Company cancellation/FX | Owner requested protection against severe FX changes and discussed retaining customer interest. | No unconditional discretionary FX cancellation right is approved here. Trigger, evidence, notice and compensation remain unresolved. Block automated company cancellation pending explicit policy approval; do not change existing promises retroactively. |

Customer-facing copy must show the financial consequence beside “0% cancellation fee”: cancelling forfeits all plan interest. Before confirmation display principal refund, pending interest cancelled, paid interest forfeited and expected refund route/timing. “Powered by PiggyVest” must not suggest the company cancellation rule is the provider's rule; branding permission remains separate.

## 2. Financial records and invariants

Use integer kobo and immutable ledger entries with reversing entries, not destructive edits. Persist environment, merchant, authenticated customer, goal, provider wallet, operation and source evidence identifiers under restricted access. No payload logging.

Maintain distinct amounts for contributed principal, reserved principal, provider-paid plan interest, reserved paid interest, pending accrual, forfeited interest, refund liability and business proceeds. A local goal allocation is not a second asset on top of the provider wallet balance.

- Available purchasing power is unreserved principal plus eligible, unreserved, provider-paid interest. Pending accrual is never spendable.
- Provider wallet cash must reconcile to classified liabilities/proceeds, accounting for documented pending movements and fees. Any unexplained difference blocks outgoing operations for that wallet and raises a redacted operational alert.
- Deposits above target cannot be erased or rejected only in local accounting after the provider has received them. Record the entire verified credit, allocate only the allowed amount and retain surplus as customer-owned cash.
- Fee payer and amount must be known before submission. Do not silently reduce a promised principal refund to pay a provider fee; unresolved fee treatment blocks that refund route.
- No automatic transfer of forfeited interest to Ogabassey until contractual entitlement and settlement mechanics are verified. A policy designation alone is not authority to sweep funds.

## 3. Interest recognition and finalisation

The accrued-interest endpoint is not proof of payment. The implementation needs a documented payout transaction/event or authoritative transaction read identifying the actual credit, its wallet, amount and period. An unexplained balance increase cannot be labelled interest.

Recognise each payout once using a durable unique provider payout identity; handle duplicate and reordered webhook/query observations. Attribute only verified plan-owned interest to the customer. If fees/taxes apply, establish gross/net semantics before exposing spendable amounts.

Preserve period-level accrual/payout attribution after a plan settles. Late payouts belonging to a completed purchase remain customer liabilities unless reviewed terms establish otherwise. Late payouts for a cancelled plan follow the disclosed forfeiture policy, not an automatic customer credit followed by an unrelated-wallet clawback. Keep a reconciliation record after the wallet is no longer offered for new funding.

Check the provider withdrawal counter, but do not locally invent provider interest eligibility or assume internal transfers are exempt. Sandbox counter observations and contractual confirmation are separate evidence. Unknown reversal semantics remain an activation gate; no guarantee of unrecoverable paid interest is inferred.

## 4. Shared operation reservation

Proposed internal lifecycle, not provider status enums:

`draft -> active -> ready -> purchase_pending -> purchased`

`draft/active/ready -> cancellation_pending -> cancelled`

Funded drafts below the 5% threshold are cancellable. Unfunded drafts can close without a refund operation. Before accepting the first contribution, retain versioned consent covering interest and cancellation; activation consent alone is too late. An expired activation quote requires fresh price consent or a principal-refund option, never automatic activation at a different price.

`ready -> active/review-required` when a protected offer expires or verified spendable funding is reversed. These transitions must respect any existing purchase/cancellation reservation.

An operation with uncertain provider outcome remains pending/reconciliation-needed; it must not release its financial reservation just because a request timed out. Pausing collection is an independent flag, not successful cancellation or refund.

In one database transaction, authenticate ownership, lock the goal's financial state, validate its version/status, reserve the required principal/interest and persist a unique operation intent. All purchase, cancellation and device-change paths must respect that same lock/reservation. Never hold the database lock across a provider network request.

Submission occurs after the intent commits. Repeated requests return the existing operation result. Use stable provider references and documented idempotency semantics. Unknown outcome means query/reconcile, not submit again. Reconciled completion consumes the reservation. A definitively failed purchase may release its reservation only after all payment legs are reconciled and no compensation remains due. A failed refund attempt never releases the cancellation reservation: the principal remains reserved for refund, collection stays stopped and the plan remains cancellation-pending. Retry only after establishing the previous attempt's terminal outcome; do not automatically reactivate saving.

Test checkout against cancellation and device change concurrently. Exactly one incompatible action may win. Worker lease expiry must not allow a second outbound submission when the first outcome is unknown.

## 5. Customer cancellation and refund

The existing cancel-future-debits RPC is not a refund implementation: funded goals are paused. Preserve that action and introduce a distinct confirmed cancel-plan/refund operation.

1. Show a server-calculated, versioned cancellation quote and obtain explicit customer confirmation. Terms accepted before first funding must be retained; do not apply new forfeiture rules retroactively. Include funded drafts and expired activation quotes in this flow.
2. Reserve the remaining principal refund and isolate all plan interest as pending forfeiture. Disable future collection and reject new voluntary plan allocations, while still accounting for incoming funds.
3. Refund only through an approved, ownership-verified route. Whether funds return to the ordinary wallet or a verified bank account, the expected time and provider fee payer are unresolved product/contract decisions. Do not silently choose one or label a wallet credit a bank refund.
4. Confirm the actual refund before marking cancelled/refunded. Timeout remains pending; definitive failure preserves the customer's refund liability and provides a recoverable status, not a false success.
5. Finalise interest forfeiture consistently with the refund outcome. A failed cancellation does not silently destroy the customer's recorded entitlement. Already spent interest from a completed purchase belongs to a separate returns policy, not this pre-purchase cancellation path.
6. Reconcile late contributions and interest. A late principal deposit remains refundable/customer-owned; it does not reactivate the plan. Do not collect another scheduled debit to satisfy a cancelled goal.

No customer refund may be blocked solely to preserve provider interest eligibility. Actual bank-refund testing requires a documented simulated endpoint/destination and separate owner approval; if unavailable, keep it mock/local-only and explicitly unvalidated end to end.

## 6. Checkout and split payments

Build a server-authoritative quote containing exact device/condition, guaranteed/current offer, delivery, taxes/fees if applicable, total, savings contribution, other payment contribution and expiry. Customer confirms the final quote and use of savings. Revalidate before reservation, not after money has already moved without a recovery path.

Savings settlement equals the customer-authorised savings portion, never automatically the entire order total. Within the reservation, persist the principal/paid-interest breakdown and all payment legs. All legs must reach confirmed success before paid/fulfillable status; disable fulfilment entirely in staging.

If one leg succeeds and another fails, retain a partial-payment/recovery state. Do not retry the successful leg or immediately return funds while the other leg remains unknown. The execution subplan must choose a collection sequence supported by the actual payment providers and define timeout expiry, customer retry and authorised compensation. No new financial calls until that sequence is tested.

If a quote/order expires after a successful transfer, recover through an explicit refund/reconciliation operation. Never lose the payment because the order changed state. Surplus is shown separately and remains customer-owned.

## 7. Price and schedule rules

Early readiness compares confirmed spendable savings against `min(valid guaranteed device price, current eligible price for the identical variant)`. It means the device price is covered, not necessarily delivery or the whole checkout. Explain any remaining charges on Review & buy.

Use server pricing, not client targets. Persist the original guarantee, approved replacements, quote expiry and terms version. A lower-price offer must be genuine; no fabricated discount or physical stock reservation. Notification may say: “Surprise! You’re ready ahead of schedule. Your savings now cover your device.”

Readiness pauses future scheduled collection. A debit already submitted may still arrive: reconcile it as customer funds, not duplicate progress or business revenue. Provider fees, failed collections and reversals require visible states and cannot change a contractual device price silently.

Owner accepted honouring the quoted lower-price offer throughout its seven-day window. During that window use the protected offer even if the catalogue price rises. On expiry, recalculate against current eligible pricing and the still-valid original guarantee; return to Continue saving if funds are insufficient. Require fresh consent before restarting automatic contributions. A funding reversal triggers balance review immediately, without cancelling the price promise itself.

Treat the six-month limit as calendar months in Africa/Lagos, with explicit month-end clamping and a separate 30-calendar-day grace period. This is an implementation proposal to verify against existing date helpers. When grace expires, retain funds and show a review-required state until the owner approves the exact expiry policy; do not invent an automatic refund or forfeiture.

## 8. Task-level implementation map

These paths are proposed, not claims that code exists. Each runtime file requires a colocated test and must remain below 300 lines. Follow local AGENTS.md before implementation; use new append-only SQL migrations and SQL regression tests, never edit historical migrations.

| Main task | Proposed module | Required responsibility |
| --- | --- | --- |
| 4 | `apps/web/src/lib/piggyvest/interest-ledger.ts` | Recognise verified payouts and attribute pending/paid/forfeited interest without duplicate credits. |
| 4 | `apps/web/src/lib/piggyvest/plan-operation.ts` | Shared durable intent/reservation boundary for purchase, cancellation and conflicting changes. |
| 4 | `apps/web/src/lib/piggyvest/cancel-plan.ts` | Cancellation quote, confirmation, refund lifecycle and late-funding recovery. |
| 4 | `apps/web/src/lib/piggyvest/settle-order.ts` | Savings-only settlement leg and split-payment recovery; no staging fulfilment. |
| 5 | `apps/web/src/lib/piggyvest/savings-policy.ts` | Pure, versioned price/activation/readiness and maturity decisions using confirmed amounts. |
| 5 | `apps/web/src/schemas/piggyvest/savings-actions.ts` | Validate operation references, quote versions and consent; never accept authoritative balances or destination wallet IDs from clients. |

Before each module is implemented, freeze its typed input/output contract and SQL transaction boundary in a small execution subplan. Use internal statuses explicitly mapped to verified provider statuses; no fabricated provider payloads. The parent plan remains a phased roadmap, not permission to guess missing API contracts.

## 9. Required acceptance examples

All amounts below are synthetic kobo. Convert these cases into colocated automated tests; concurrency/durability cases additionally require local PostgreSQL tests. Pure policy cases do not need provider credentials.

| Case | Input/action | Required outcome |
| --- | --- | --- |
| Pending interest | Principal 9,500,000; paid interest 300,000; pending 200,000; device 10,000,000. | Purchasing power 9,800,000; not ready. |
| Verified payout | The pending 200,000 receives one authoritative payout, observed twice. | Purchasing power 10,000,000; one credit; ready once. |
| Cancellation | Principal 10,000,000; paid interest 300,000; pending 100,000. | Refund quote 10,000,000; cancellation fee zero; all 400,000 interest disclosed as forfeited/cancelled, with paid and unpaid portions separate. |
| Refund timeout | Provider accepts refund, response is lost. | Refund pending, principal reserved; reconcile before retry; no second refund. |
| Concurrent operations | Checkout and cancellation target the same active goal simultaneously. | One winning intent/reservation, no double spend; loser gets conflict or existing operation state. |
| Split payment | Total 12,000,000; savings selected 10,000,000; other payment 2,000,000. | Internal transfer exactly 10,000,000; order paid only after both legs succeed. |
| Partial payment | Savings leg succeeds; other leg fails or times out. | No fulfilment, no duplicate savings debit; recoverable partial-payment state. |
| Late deposit | Cancellation is pending; confirmed contribution 50,000 arrives. | Record full credit as additional customer liability, no plan reactivation or loss. |
| Price falls | Guarantee 10,000,000; identical device current price 9,700,000; spendable 9,800,000. | Ready; checkout preserves 100,000 surplus before any separately authorised delivery charge. |
| Price rises | Valid guarantee 10,000,000; current price 11,000,000. | Device ceiling remains 10,000,000; FX is not an automatic override. |
| Activation | Device quote 10,000,000; contribution 499,999 versus 500,000. | Below threshold does not activate; confirmed 500,000 activates under the valid quote. |
| Existing terms | Customer accepted an older policy without forfeiture. | New cancellation forfeiture is not silently applied; require policy-specific handling. |
| Closure | Purchase completes before a later interest payout arrives. | Preserve reconciliation and customer entitlement; no automatic business sweep or wallet reuse. |
| Funded draft | Confirmed principal 100,000 against activation threshold 500,000; customer cancels. | Cancellation/refund path available; no requirement to reach activation first. |
| Expired activation quote | Contribution arrives after quote expiry. | Record funds without silently activating new pricing; offer fresh terms or principal refund. |
| Failed refund | Refund attempt definitively fails. | Plan remains cancellation-pending; principal reserved; collection stopped; recoverable retry without spendable duplicate balance. |
| Protected offer | Catalogue rises during seven-day lower-price offer. | Honour the recorded offer until expiry, subject to verified funds and no conflicting reservation. |
| Readiness expiry | Offer expires and funds no longer cover applicable price. | Return to Continue saving; automatic contributions remain paused until consent. |
| Funding reversal | Confirmed principal is reversed while ready. | Reconcile and review balance immediately; no underfunded checkout or silent scheduled debit restart. |

## 11. Funding-channel research and implementation direction

Official documentation checked on 11 September 2026. Documentation confirms capabilities, not account enablement or successful staging tests. Recommend direct plan-wallet bank funding as the first integration path; Pocket is an optional additional channel, not cross-app goal synchronisation.

| Channel | Official evidence | Boundary |
| --- | --- | --- |
| Dedicated virtual account | [Wallet creation](https://www.piggyvestbusiness.com/docs/api/wallet/create) supports `reserve_virtual_account`; [funding accounts](https://www.piggyvestbusiness.com/docs/api/wallet/funding) returns accounts for a wallet. | Retrieve and verify the plan-linked destination before display. No funding instructions until provisioning succeeds. Bank examples are not promises of available banks for this account. |
| Regular/disposable account | [Reserve account](https://www.piggyvestbusiness.com/docs/api/wallet/reserve) documents regular accounts and disposable accounts with expiry/amount policies. | Prefer regular accounts for repeated savings deposits; validate provisioning limits, late-deposit behavior and sandbox support before enabling. |
| Pocket checkout | [SDK](https://www.piggyvestbusiness.com/docs/pay-with-pocket/sdk) documents Pocket and bank-transfer payment methods, with optional target `wallet_id`; omission credits the primary wallet. | Always supply the server-resolved plan wallet; verify destination, reference, amount and final credit server-side. Frontend callbacks/redirects are not proof of funding. No SDK installation or activation authorised here. |
| Scheduled wallet movement | [Schedules](https://www.piggyvestbusiness.com/docs/api/schedules/create) uses a source wallet and wallet/bank destination. | Not evidence of card collection or direct debit from an external bank account. Requires source funds; do not replace existing collection mandates on this basis. |

No native card collection or external-bank direct-debit contract was established from these pages. Preserve existing Paystack behavior; keep its PiggyVest funding bridge disabled until actual settlement, fees, reversals and reconciliation are specified.

For general-wallet-to-plan contributions, reserve source funds and track one transfer intent through verified destination credit. For externally collected money, show pending savings funding until the real plan-wallet credit is confirmed. Never count both a collection webhook and its corresponding funding credit as two contributions. Only provider-confirmed eligible accrual after actual funding supports interest display.

Additional discovery: wallet creation now documents `interest_payout_wallet`. Record this as a potential payout-routing capability, not permission to divert customer interest or proof of existing configuration. Confirm recipient ownership, attribution and reversal behavior before choosing a payout destination; preserve the approved entitlement rules.

Required tests: pending account provisioning exposes no account; missing/tampered Pocket destination cannot credit a plan locally; duplicate collection/funding observations credit once; failed bridge preserves the customer's funds as pending liability; wrong-wallet funding is quarantined; late deposits after cancellation remain customer-owned. Keep all fixtures synthetic and all live financial operations gated by separate approval.

## 10. Readiness gates

Local foundation can proceed independently. Customer cancellation, full checkout and interest payout activation require all relevant decisions and contracts below; unresolved items must be reported, not silently skipped in a “complete” result.

- Verify settlement-wallet ownership, multiple-wallet limits, internal-transfer fees/counting and documented payout recognition/reversal behavior.
- Confirm refund destination, timing, fees, provider-approved synthetic refund route and cancellation-interest entitlement handling.
- Obtain reviewed customer terms and versioned consent for all-interest forfeiture; do not reopen the already approved wallet-interest business use case.
- Obtain owner decision on post-grace expiry and any exceptional company cancellation/FX policy before enabling those paths.
- Freeze the split-payment collection/compensation sequence after reviewing the actual providers' contracts; prove concurrent operation safety and late-credit handling.
- Preserve separate evidence for local tests, deployed staging, provider profiling, authenticated access, sandbox financial outcomes and production certification. No new external activation is authorised by this document.
