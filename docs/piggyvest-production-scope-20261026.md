# Production scope update — 26 October 2026

The owner explicitly selected **checkout and utility spending included** in the
first production release. The checkout/utility exclusions in the historical
`piggyvest-isolated-ledger-boundary-20261023.md` proposal are therefore superseded
for implementation planning. This does not activate any capability or establish
that the additional flows have been implemented or deployed.

## Required behavior

- Reuse the existing onboarding, signed bank/interest inbox, savings state
  machine, balanced ledger, payment-intent, order and VTU recovery code.
- The isolated ledger remains the sole financial authority. An application
  projection is a read model, never permission to spend or a second spendable
  wallet. No outage may fall back to debiting a legacy copy.
- Preserve existing eligibility rules: ordinary available wallet funds and
  non-withdrawable device-plan savings are not interchangeable. Checkout and
  utility access must enforce their respective server-side eligibility policy.
- Resolve the customer and merchant from authenticated ownership. Compute
  prices, fees, order/utility scope and spend limits on the server; bind them to
  an immutable operation identity before dispatch.
- Reserve funds before the existing payment/provider dispatch. Provider
  acceptance is pending, not settlement. Where provider custody must move,
  require the verified corresponding settlement before recording a completed
  payment or permitting fulfillment; a projection acknowledgment is not proof.
- An uncertain timeout, lookup 404, lost acknowledgment, app restart or retry
  must recover the same operation and references. Do not dispatch another
  transfer or release a dispatched hold merely because a response was lost.
- Refunds, cancellations and reversals must reference their original operation,
  obey existing verified-provider-evidence rules and conserve value. They must
  not mint funds into a legacy wallet or create duplicate spendable balances.
- Close/revocation and deletion must fence new financial admission while
  preserving accepted work, signed receipt retention and reconciliation.
- Apply existing notification intent/receipt deduplication once per financial
  event; projection updates must not generate a second delivery.

## Acceptance additions

The selected release requires checkout and utility happy paths, insufficient
funds, concurrent spend, duplicate submission, rejected versus uncertain provider
outcomes, lost reply/restart recovery, late settlement, cancellation/refund and
wrong-customer/merchant rejection tests. Run synthetic/local contracts first;
production transactions require a separate final, bounded canary approval.

All recording-account records remain excluded. Live flags remain disabled.
