# Oxygen webhook payloads — 20 October 2026

These are synthetic examples from the current [official Support APIs](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis), not callbacks received for our test loan.

## Transaction callback

```json
{
  "phone_number": "08000000000",
  "transaction_reference": "txn-example-001",
  "amount_deducted": "28000.00",
  "amount_sent": "28000.00",
  "loan_request_reference": "fe448e69-9e01-47b6-a1f9-f90ab6455ea8"
}
```

## Address validation callback

```json
{
  "webhook_type": "address_status_update",
  "phone_number": "08000000000",
  "address_validated": true
}
```

## Vendor settlement callback

```json
{
  "webhook_type": "vendor_settlement",
  "event_id": "d6a70f82-df66-456d-9047-e8274e4b167a",
  "status": "SUBMITTED",
  "partner_reference": "partner-example",
  "vendor_identifier": "vendor-example-001",
  "vendor_name": "Example Merchant",
  "amount": 100000.0,
  "occurred_at": "2026-10-12T10:00:00",
  "previous_webhook_sent_at": null,
  "previous_activations_captured_at": null,
  "activations_captured_at": "2026-10-12T10:00:02Z",
  "activation_audit_scope": "partner",
  "activated_loan_count": 1,
  "activated_loans": [
    {
      "loan_reference": "fe448e69-9e01-47b6-a1f9-f90ab6455ea8",
      "loan_request_reference": "6d9d3852-3dbd-47bd-a697-8b4975ce487b",
      "loan_id": 123,
      "loan_identifier": "loan-example-123",
      "loan_amount": 75000.0,
      "first_repayment": 25000.0,
      "loan_tenure": 3,
      "activated_at": "2026-10-12T09:45:00Z"
    }
  ]
}
```

## Direct partner settlement callback

```json
{
  "webhook_type": "partner_settlement",
  "event_id": "47a7eae5-c128-4bd9-9bfb-d47cc2ec7996",
  "status": "SUBMITTED",
  "partner_reference": "partner-example",
  "partner_identifier": "partner-id-example-001",
  "partner_name": "Example Partner",
  "amount": 50000.0,
  "occurred_at": "2026-10-12T11:00:00",
  "previous_webhook_sent_at": "2026-10-12T10:00:03Z",
  "previous_activations_captured_at": "2026-10-12T10:00:02Z",
  "activations_captured_at": "2026-10-12T11:00:02Z",
  "activation_audit_scope": "partner",
  "activated_loan_count": 0,
  "activated_loans": []
}
```

## How we consume them

- Authenticate first. `API_KEY` sends `api_key` and `api_secret` headers. The docs also specify Bearer and Basic auth. `custom_headers` are currently ignored by Oxygen; there is no separate HMAC signature. Our receiver does not permit unauthenticated mode.
- Transaction `loan_request_reference` means the booked loan reference. Reconcile both completion flags through the confirmation endpoint; do not activate from this event alone.
- Address callbacks have only a phone identifier and indicate success. Resolve candidates within the configured partner/environment and query KYC status; never mark an arbitrary matching customer verified by phone alone. Ambiguous matches require reconciliation.
- Settlement `amount` is the payout. `SUBMITTED` is not proof of bank receipt.
- `activated_loans` is a partner-wide activation audit, not allocation of this payout. Its `first_repayment` is equity only, excluding charges.
- `occurred_at` can omit a timezone. Preserve the source text; do not assume it is UTC.
- Persist and enqueue atomically before acknowledging. Scope settlement `event_id` and transaction-reference deduplication to partner AND environment. Do not apply financial effects on duplicate delivery. Address events should initiate an idempotent KYC read rather than a financial effect.
- HTTP 200 with `{ "received": true }` acknowledges acceptance. Settlement retries exist without a promised retry schedule. Address/transaction delivery is best effort; retain polling reconciliation.

## Local implementation boundary

`src/schemas/oxygen-webhook.ts` validates these four sample shapes.
`src/lib/payments/oxygen/webhook.ts` normalises their semantics and money to integer kobo.
`src/lib/payments/oxygen/webhook-receiver.ts` validates authentication, bounds the request body and calls an injected acceptance adapter before acknowledging.

A separate [staging receiver](../../../apps/web/tools/oxygen-staging-webhook/README.md) now wires this logic to a durable local SQLite inbox and temporary HTTPS endpoint. Oxygen confirmed its active staging registration on 20 October (HTTP 200). Public reachability and unauthenticated rejection passed. Actual provider delivery still needs observation or replay. This is not the production Next.js route/queue integration. No order-paid, fulfilment or bank-receipt transition is implemented.

The existing diagnostic observer remains separate and explicitly unverified. Its only saved observation at this check is an October 12 selfie-shaped body; it is not a real payment or settlement fixture.
