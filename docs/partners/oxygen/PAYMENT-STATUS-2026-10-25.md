# Selected booking payment status — 25 October 2026

Owner-requested status read at **06:45:26 Africa/Lagos** (05:45:26 UTC).

- Booking: `438f96ee-37c4-49bb-a56c-51451f9cb624`
- Workflow: `b1c11c04-ef5c-4519-963e-a5a9a8d2f951`
- Endpoint: `POST /v1/partner-loans/split-payment-setup/confirmation`
- Provider calls: **one**, strictly allowlisted to this status endpoint and exact booking.
- HTTP response: **200**.

Returned payment/setup fields:

```json
{
  "split_payment": {
    "completed": false,
    "completion_date": ""
  },
  "repayment_setup": {
    "completed": true,
    "completion_date": "2026-10-19T11:19:34.067677"
  }
}
```

The provider's completion date is preserved verbatim; its value has no timezone suffix. Upfront payment remains incomplete, so this is not a successful-payment result.

The exact HTTP body and status were captured locally before validation in an AES-256-GCM encrypted, mode-0600 artifact named `payment-status-2026-10-25T05-45-24-708Z.encrypted.json` under the transfer's `runtime/private/` directory. The safe report is stored alongside it as `payment-status-2026-10-25T05-45-24-708Z.json`. Neither credentials nor encryption keys are included here. The normal authenticated customer and bound ordinary worker used the existing recovery ledger; no service-role client was used.

Before/after workflow snapshots were identical, and the fingerprint of indeterminate original commands was unchanged. No OTP, booking, approval, cancellation, activation or settlement was requested. Both activation and settlement remained disabled.

## Confirmed after Oxygen's manual staging update

One owner-requested status read at **11:40:26 Africa/Lagos** (10:40:26 UTC) returned HTTP 200 for the same selected booking:

```json
{
  "split_payment": {
    "completed": true,
    "completion_date": "2026-10-24T15:23:45.250439"
  },
  "repayment_setup": {
    "completed": true,
    "completion_date": "2026-10-19T11:19:34.067677"
  }
}
```

Completion dates are provider values without a timezone suffix and are preserved verbatim. The separate payment recovery ledger now holds both confirmed flags. This was a status-only read following Oxygen's manual staging update, not an observation of HydrogenPay's browser-completion callback.

Exact response capture: private encrypted artifact `payment-status-2026-10-25T10-40-23-352Z.encrypted.json` in the transfer runtime/private directory. Original workflow snapshot and indeterminate-command fingerprints remained unchanged. Activation and settlement remained false. No OTP, booking, approval, cancellation or payment submission was made.

The documented backend step after confirming both flags is activation; that remains disabled. The customer screen should show payment confirmed, the selected products and upfront amount, a compact next-repayment reminder and awaiting order confirmation. It must not imply activation, fulfilment or settlement has occurred. The existing success component can now render from this real saved status rather than a mocked result.
