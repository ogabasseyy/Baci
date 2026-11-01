# Selected booking staging activation trial — 25 October 2026

## Authorization and scope

The owner explicitly requested a “Confirm payment and activate” button, a note that confirmed payment should auto-activate the plan, and a real staging activation test to inspect the response. This supersedes the prior no-activation boundary only for this one selected staging booking. It does not enable general activation, production execution or settlement.

- Booking: `438f96ee-37c4-49bb-a56c-51451f9cb624`
- Workflow: `b1c11c04-ef5c-4519-963e-a5a9a8d2f951`
- Order: `99744178-6b29-4273-9bac-f8a495c5583d`

The button and note are in `OxygenActivationTrial.tsx`, embedded in the existing payment confirmation screen. A customer-owned, authenticated API and bound ordinary worker use a separate one-use activation-trial ledger. Only this exact staging reference is permitted. The generic runtime still reports activationEnabled=false and settlementEnabled=false. No service-role client, approval replay, cancellation or older booking was used.

## Actual provider responses

A fresh `POST /v1/partner-loans/split-payment-setup/confirmation` returned HTTP **200** at 10:55:18 UTC with both completion flags true. One `POST /v1/partner-loans/activate-loan` returned HTTP **200** at **11:55:30 Africa/Lagos** (10:55:30 UTC):

```json
{
  "loan_reference": "438f96ee-37c4-49bb-a56c-51451f9cb624",
  "status": "ACTIVATED",
  "product_amount": 396000,
  "loan_amount": 297000,
  "equity_percentage": 25,
  "equity_amount": 99000,
  "total_charges": 5865.75,
  "total_upfront_payment": 104865.75,
  "first_repayment": 104865.75,
  "loan_tenure": 6
}
```

The JSON above is the safe field projection of the actual response. Complete HTTP bodies/statuses were encrypted before validation in the private trial ledger and exported to mode-0600 `activation-trial-*.encrypted.json` artifacts in transfer `runtime/private`. The private report records one payment read and one activation attempt, original workflow snapshot unchanged and all original indeterminate-command fingerprints unchanged. No settlement request was sent.

The trial row is now terminal `activated`; repeated button submissions cannot claim or resend it. Response loss/timeouts after sending activation become indeterminate, with no automatic retry. A failed payment/setup prerequisite sends no activation. The earlier local approval history remains unresolved and preserved separately; the provider activation success is recorded in the trial ledger, not rewritten into that history.

## UI implications

The current button changes to “Payment plan activated” after the stored success. Keep the plan/product and payment details in the same modal. A subsequent customer screen can lead with “Payment plan confirmed”, then product summary, upfront amount and a compact next-payment reminder. Activation does not by itself prove the commerce order is confirmed, fulfilled or settled; retain awaiting order confirmation until those states are authoritatively updated.

Here `first_repayment` equals the upfront amount, not the first monthly instalment. Reuse the selected booking's saved schedule for monthly amounts and dates. The response has no fulfilment or delivery promise; do not invent one.

## Verification

- 38 affected service, API, schema and UI tests passed across seven files, including missing payment/setup, timeout, malformed response, rejection and no-repeat cases.
- Transactional isolated-database test passed: unrelated customer denied, customer cannot claim, worker claims once, mismatched activation reference denied and terminal trial cannot be enqueued again. Its mocked changes rolled back.
- Web and tools-worker typechecks passed.
- Task-file Biome checks passed. Existing staged patch remained unchanged.
- No production deployment, production observation, settlement or original approval reconciliation was performed.
