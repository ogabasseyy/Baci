# PiggyVest purchase and cancellation execution handoff

Date: 26 September 2026. Scope: Lane 4 bounded execution design. This document
does not enable a transfer, refund, order completion, ledger settlement, or
provider configuration.

## Current safe boundary

`customer-purchase-handler.ts` persists and recovers a purchase preparation.
Its only durable receipt is `purchase_pending` with `dispatch: contract_gap`
and `fulfilment: disabled`. A lost response retains the reservation and returns
an uncertain outcome instead of retrying or releasing funds.

`cancel-plan.ts` and `customer-cancel-handler.ts` likewise create or recover a
prepared cancellation receipt. It has `dispatch: contract_gap` and
`interestDisposition: unresolved`; it is not a refund. `dispatch()` always
returns `provider_cancellation_mechanism_unverified` and does not invoke an
executor or network client.

These boundaries must remain in place until the terminal-state implementation
and the few product-economics decisions below exist. A preparation receipt must
never become a paid order, fulfilled device, cancelled plan, or refund by
inference.

## Provider facts verified on 26 September

PiggyVest documents wallet transfer as a transfer between wallets under the
same business account. It requires an integer-kobo amount, source wallet,
destination wallet, NGN currency, and caller-provided reference. Its `202`
response only means the request is scheduled; the documentation requires final
confirmation through a webhook or periodic transaction-status query (TSQ).

TSQ takes the reference, optionally narrows by wallet, and documents only
`success`, `pending`, and `failed` terminal/pending values. The public webhook
list contains `wallet-transfer.outflow.success` but does not document a
wallet-transfer failure payload. It also lists restriction events. This is not
sufficient evidence to infer a reversal, return, or fee. It does not prevent
an approved refund from using the ordinary documented wallet or bank transfer
primitive; a dedicated provider cancellation endpoint is not required.

## Implementation dependency, not a provider blocker

Lane 3 can implement the documented wallet/bank transfer submission boundary
now, without a provider-side cancellation API. Its use of `202`, webhook, and
TSQ is ordinary asynchronous integration work:

1. Submit one transfer with the existing canonical operation ID as the
   provider reference; persist the initial result as `pending`, never success.
2. Apply a matching authenticated success webhook as the fast path.
3. Poll TSQ by that same reference for recovery. `pending` remains pending;
   `success` and `failed` are the documented final outcomes.
4. Treat missing, malformed, mismatched, or unrecognized delivery as `unknown`
   and retain the reservation until recovery resolves it.

The parent coordinator can then call that Lane 3 boundary and use the existing
reservation/recovery state. This is a code dependency, not an additional
permission or provider-evidence ceremony. Tests can exercise it with synthetic
documented request fields and deterministic transport fixtures; live provider
evidence remains a release-validation gate, not a prerequisite for writing the
integration.

## Irreducible economics decisions before activation

Only these product decisions are currently absent; none requires a bespoke
PiggyVest cancellation feature:

1. **Purchase settlement:** which already-reserved amounts become the device
   payment, who handles the quoted `otherPaymentKobo`, and which canonical
   order state may unlock fulfilment after a confirmed transfer.
2. **Cancellation destination and amount:** whether an approved cancellation
   pays to a mapped customer wallet or bank destination, and the exact amount
   to send. The existing quote deliberately reports principal, paid interest,
   and pending interest separately rather than deciding their disposition.
3. **Interest and fees:** approved treatment for paid/pending interest,
   forfeiture if any, and fee responsibility. Do not derive any of these from
   an initial transfer response, dashboard setting, or preparation quote.

Once those values are supplied by the product owner, they are normal typed
inputs to the documented transfer flow. They should be captured as part of the
same canonical settlement transaction, not as a new approval system or a
parallel ledger.

## Proposed integration boundary after those gates

Lane 3 owns the outgoing adapter and should expose a narrow, server-only result
to the parent coordinator: the canonical operation ID/reference, verified
wallet scope, and an explicit `pending`, `success`, `failed`, or `unknown`
outcome. `202` maps only to `pending`; a timeout, malformed response, or
unrecognized event maps to `unknown`. This lane must not construct a second
adapter or call the provider directly.

The parent-owned replay runtime must route the authenticated terminal webhook
and recovery/TSQ result into the same canonical operation. It must deduplicate
by the existing operation/reference relationship and retain the reservation
while the result is `pending` or `unknown`. A `success` terminal result may
reach a separately approved settlement transaction exactly once; `failed` and
restrictions require their separately approved handling. Neither result should
be guessed from the provider's initial HTTP response.

For purchases, only that exact terminal settlement transaction may unlock
order payment and fulfilment. For cancellations, the ordinary documented
transfer plus the chosen cancellation amount/destination may create a refund
only after verified finality. Interest stays unresolved unless the chosen
economic decision and canonical ledger transition specify otherwise.

## Parent wiring and regression gates

Parent must wire the future Lane 3 adapter result through the owned
`replay-store.ts`, `replay-crypto.ts`, `replay-runtime.ts`, their types, and
coordinator tests. Lane 4 currently adds no executable module for the parent to
wire; the existing purchase/cancellation preparation handlers remain the
customer-facing boundary.

Implement and run disposable-only regression coverage through the real
restricted executor and canonical recovery path before enabling either flow:

- A scheduled (`202`) transfer keeps the purchase unfulfilled and cancellation
  unrefunded.
- Duplicate webhook, duplicate TSQ success, and restart recovery settle exactly
  once against the same operation/reference.
- Pending, failed, malformed, missing, and restricted evidence never settles,
  fulfils, refunds, or releases by default.
- A terminal result whose operation, reference, wallet, amount, customer, or
  merchant scope disagrees with the preparation is quarantined without an
  economic mutation.
- Replaying an existing preparation never submits a second transfer.

All implementation tests use synthetic data. A separate live-provider release
validation can confirm real credentials, delivery, and finality without
changing the code path or activating customer funds during development.
