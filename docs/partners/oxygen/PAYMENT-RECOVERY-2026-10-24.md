# Payment-link recovery implemented — 24 October 2026

The current actual checkout popup can resume the selected booking's payment step without replaying approval or returning to booking. This is local code plus an isolated-staging migration; no production deployment occurred.

## Changes

- Added distinct fixed-staging provider operations for `send/split/payment-setup` (upfront payment) and `send/payment-setup` (repayment setup).
- Oxygen's returned upfront URL used the exact HTTPS host `payment.hydrogenpay.com`, which was missing from configuration. Hydrogen's official payment documentation uses this host. The staging runtime now includes this exact hostname; HTTPS, user-info, port and other hostname checks remain enforced. No environment files or proxy rules were changed.
- Added `/api/payments/oxygen/recovery`: normal customer auth, CSRF on POST, bounded schema input, rate limits, safe errors and no browser caching. Signed URLs are returned only after hosted-link validation. GET restores cached progress without contacting Oxygen.
- Added a separate private staging ledger and evidence table through `20261024184250_oxygen_payment_recovery.sql`. The customer owns enqueue/status; the merchant's bound ordinary Auth worker owns claim, encrypted evidence and finish. Direct table access and anonymous RPC access are denied.
- Recovery is bound to the canonical booking, current workflow version, merchant/customer/order, enabled staging worker and an eligible workflow state. It cannot run approval, booking, cancellation, activation or settlement. It cannot act on an uncertain booking or a still-executing original command.
- A recent status read must confirm the relevant step is incomplete before a link is reissued. Completed repayment setup cannot be resent accidentally. Duplicate idempotency keys reuse the intent; concurrent work is serialized. An uncertain link request blocks another resend of that kind, but a status read remains available. A worker-login failure before execution can abandon only the still-queued recovery intent.
- Provider response evidence is encrypted before validation. The documented generic `url` field is captured. A rejected URL leaves bounded reason/hostname/length metadata without its query values. Arbitrary strings, identity fields, OTPs and signatures remain excluded. The recovery evidence is tied to workflow/command/sequence and hidden after its 24-hour read expiry.
- The actual storefront popup shows payment/setup status, Continue to payment, Check payment status and an explicit new-link action. An indeterminate approval remains recorded; its command is never silently changed to failed/succeeded. Payment progress lives separately and does not invent approved financial terms.

## Current application: verified live

- Workflow: `b1c11c04-ef5c-4519-963e-a5a9a8d2f951`.
- Selected/canonical reference: `438f96ee-37c4-49bb-a56c-51451f9cb624`.
- Through ordinary authenticated customer and worker clients, the new ledger executed one payment-status read and one upfront-link retrigger. Both responses were captured before validation.
- Oxygen reports repayment setup complete and upfront payment incomplete.
- A valid payment link was stored under that reference, passed exact HTTPS hostname validation, and was returned unchanged by a fresh saved-state read.
- Browser reload showed Continue to payment in the actual checkout popup. The link was not opened or paid by the assistant.
- Before/after original workflow snapshots and the fingerprint of all indeterminate original commands were identical. Older protected applications/bookings were not acted on. Activation and settlement remained false.

The original approval response was discarded before the earlier capture fix and remains indeterminate. Recovering the payment link does not establish its missing approved response/terms. That audit history is retained rather than cleared to make the UI advance. Status checks in this module record only payment/setup facts and do not mark the commerce order paid or authorize fulfilment.

## Validation

Regression coverage includes both endpoint mappings, exact-reference binding, idempotent replay, wrong/stale references, blocked completed setup, auth/CSRF/rate limits, malformed responses, URL rejection, encrypted capture, persistence failure, no automatic provider replay, queued-intent cleanup, popup reopening and status checking. Transactional SQL fixtures verify customer/worker separation, anonymous/direct-table denial, evidence access after finish, stale versions, duplicate requests, uncertain resend blocking, and unchanged original approval history. Fixtures roll back.

The implementation was checked with affected Oxygen provider/runtime/API/UI tests, Biome, web and tools-worker typechecks, and the SQL regression on isolated staging. No commit, push, merge, deployment or activation/settlement test was performed.

## Sources

- [Oxygen Support APIs](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis)
- [Oxygen booking and approval](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-booking-and-activation)
- [Hydrogen hosted payment URL](https://docs.hydrogenpay.com/reference/single-payment)

The earlier recovery audit describes the pre-fix snapshot. This document records the payment-recovery implementation. General indeterminate create/book reconciliation and uncertain KYC-command recovery were not broadened by this payment-specific change.

Final validation: 113 distinct focused tests passed across the final provider/runtime/API/UI runs, web and tools-worker typechecks passed, changed-file Biome checks passed, and isolated-staging SQL regression passed. Full web lint was also attempted: it is blocked by existing formatting errors in `src/app/api/orders/route.ts` and `src/app/api/orders/order-security.test.ts`; these unrelated files were preserved. A pending recovery request can be refreshed with a cached GET without issuing another provider action. The original staged patch still compares byte-for-byte equal to its saved baseline.


### Checkout continuation

Continue to payment opens the saved Oxygen-generated payment URL inside the existing checkout dialog, which resizes to the hosted payment panel. No nested payment dialog or additional backdrop is created; Back restores the still-mounted application. Customers do not see a link-generation action. If the URL is missing, continuation checks provider status and requests the appropriate link once, using the canonical selected reference and the existing idempotency and indeterminate-outcome guards. A pending or uncertain resend is never blindly repeated. Closing the hosted popup retains the URL and does not mark payment complete; provider status remains authoritative. The storefront frame allowlist includes the exact payment.hydrogenpay.com host with owner authorization. No payment, approval, activation, settlement, cancellation, or booking is initiated by this UI change.


### Hosted payment first paint

The payment shell now paints before the external iframe is created, using two cancellable animation-frame callbacks rather than a fixed timer. The white surface, cover placement and initial frame visibility are inline styles, and the payment viewport isolates and contains its paint. The iframe remains hidden until its document load event. This controls the opening paint and is not a provider-ready or payment-success signal. No provider-ready message contract was established. Browser screencast inspection of eight opening frames showed the saved plan followed directly by the white placeholder, with no dark frame in that captured opening sequence. Production CWV was not measured.


### Automatic confirmation on return (25 October)

The customer-facing Check payment status action has been removed. The single Continue to payment action reuses the saved link or performs the existing guarded missing-link recovery. Returning from the hosted payment view triggers a status-only check; returning from a hidden browser tab during an open payment session also triggers that read. Ordinary renders, iframe load, repeated visible events and already completed steps do not trigger confirmation. The existing in-flight lock coalesces concurrent work. Closing a frame is not payment evidence. Failed status reads preserve the last confirmed state, with no automatic approval, booking or link resend. The indeterminate original approval remains separate and unchanged.

The prior plan/code view yields to the confirmation summary when both payment/setup flags become true. A real status check on 25 October returned HTTP 200 with upfront payment incomplete and repayment setup complete. See PAYMENT-STATUS-2026-10-25.md. Final affected coverage for this change: 38 tests across six files, web/tools-worker typechecks and changed-file Biome checks. No deployment or financial action occurred.
