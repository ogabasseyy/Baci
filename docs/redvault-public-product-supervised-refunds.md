# Supervised refunds for the public UBA test product

The owner approved this supervised pilot-only process on 18 October 2026.
Automated live refund recovery remains disabled. This is not authorization to
submit a real refund now, enable the cron, grant a broad service role or change
general campaign terms. Obtain approval for each specific test-payment refund.

## Before exposing the test product

- Name the responsible Ogabassey operator and confirm access to Paystack Dashboard
  and the existing protected database-owner RPCs. Keep the authoritative amount,
  transaction reference, attempt and order linked throughout the operation.
- Configure usage terms with exactly `usage_limit: null` and
  `usage_limit_per_customer: null`; set the corresponding discount-code columns
  to SQL NULL. Dummy fixture metadata or an unapproved cap can block approval.
- Preserve the permanent physical-fulfilment hold. Disabling checkout cannot
  revoke hosted URLs already issued; reconcile later captures too.

## One supervised refund

1. Read the intended order, attempt and transaction. Independently verify the
   successful Paystack capture, its reference, NGN amount and merchant binding.
   A local success page or webhook acknowledgement is not sufficient evidence.
2. Under the authenticated database-owner operation, reserve `full_capture` using
   `reserve_uba_redvault_refund_v2(attempt_id, merchant_id, idempotency_key,
   'full_capture', NULL)`. Use one stable, order-specific idempotency key.
   Require the full original captured amount, not just NGN 95 merchandise.
3. Serialize refund operations and inspect pending work before calling
   `claim_next_uba_redvault_refund()`. Check the returned refund, attempt, capture,
   currency and amount match the intended refund exactly. Stop if another refund
   is claimed; never attach this test's provider refund ID to another row.
4. Refund that exact capture once through Paystack Dashboard. Check for an
   existing refund before repeating an ambiguous action. Retain its actual refund
   ID and state; a lost response is not permission to submit a second refund.
5. Record the provider's actual refund ID and supported observed status using
   `record_uba_redvault_refund_provider_submission`. Do not infer completion from
   Dashboard submission or a successful API request. A missing ID or unclear
   provider outcome requires manual reconciliation, not a new reservation.
6. Independently verify the provider refund has completed for the same capture
   and amount. Claim with `claim_next_uba_redvault_refund_reconciliation()` and
   verify its ID and non-null reconciliation token. Call
   `reconcile_uba_redvault_refund` with that exact token and verified provider
   status/reference. Do not mark a pending provider refund processed.
7. Confirm the persisted refund, order and payment transaction financial states,
   financial lifecycle and any settlement reversal. Inspect remaining inventory
   or lifecycle review separately. Never edit ledger rows or fulfilment fields to
   manufacture completion. Report financial completion and outstanding operations
   review as separate results. The test product must never ship.

The generic cancellation-refund webhook does not by itself reconcile REDVAULT's
private refund ledger, particularly for captured-held payments. A webhook 200 or
Dashboard refund alone is not the completion criterion above.

## Evidence and limits

The rollback-only full-schema suite exercises the actual protected reserve,
idempotent replay, submission claim/record, reconciliation claim and fenced
reconciliation functions for a synthetic guest capture of NGN 102.50. A wrong
token is rejected, and the order/payment/refund financial states become refunded.
All fixtures roll back; no provider request is made. This proves database behavior,
not live Paystack delivery or access to an operator's Dashboard.

The simulated held capture retains inventory lifecycle review
`partial_units_require_fulfillment_reconciliation`. Financial refund completion
does not close that review or authorize physical fulfilment. A responsible
operator must inspect and retain it explicitly. Never claim an automated or
fully reconciled production refund based on this simulation.
