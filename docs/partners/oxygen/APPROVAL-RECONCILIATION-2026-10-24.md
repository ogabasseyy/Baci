# Selected-plan approval observation — 24 October 2026

The customer entered the approval code in the actual storefront checkout. Do not repeat this approval, create another booking/application, cancel any reference, or use an older indeterminate booking to recover it. Activation and settlement remain disabled.

- Order: `99744178-6b29-4273-9bac-f8a495c5583d`
- Workflow: `b1c11c04-ef5c-4519-963e-a5a9a8d2f951`
- Selected/canonical booking: `438f96ee-37c4-49bb-a56c-51451f9cb624` (25%, six months).
- Latest resend: created 16:23:10 Lagos; queued for 1.23 seconds, execution 4.94 seconds; succeeded. These timings do not measure email delivery. Recent local action POST logs also showed 18.9–20.9 seconds including development-server overhead; do not attribute all of that to Oxygen.
- Approval: created 16:23:40 Lagos, completed 16:23:46; command outcome `indeterminate`, stage `reconciliation_required`. Sanitized diagnostic: operation `approve`, kind `validation`, outcome `indeterminate`, duration 3752ms. No HTTP status/full response body was retained for this validation failure, so the exact mismatched response field is not established.
- The customer reports receiving the repayment-setup email. This was not independently verified from the mailbox and is not evidence of payment, activation or settlement.
- Read-only calls to the existing breakdown/details endpoint for that exact reference returned HTTP 400, `loan not found`. This endpoint supplies the repayment breakdown; this is not a definitive approval-status result. No approval was repeated or workflow state overwritten.

Oxygen must confirm the selected reference's status, whether approval created/replaced any provider reference, and the authoritative approved terms/setup links. Preserve the recorded indeterminate attempt pending that reconciliation.

## UI correction

Pending verification now keeps the red streak orbiting separate grey boxes until a server-confirmed result. Only confirmed success starts stacking and the green tick. The confirmed destination waits briefly for that animation, skips the pause for reduced motion, and releases on unmount. An indeterminate approval now displays one confirmation-hold screen rather than reverting to the plan selector. No API amount/reference validation was relaxed.

## Read-only reconciliation and one resend probe

A read of `/v1/partner-loans/split-payment-setup/confirmation` for the exact selected reference returned `repayment_setup.completed: true` and `split_payment.completed: false`. It did not return either hosted link. This confirms setup status, not the missing approved terms or successful upfront payment. The saved workflow remains on reconciliation hold.

A fresh KYC read returned all six recognized statuses `DONE`, including `selfie_status`. This is Oxygen's saved status; it does not prove a face-verification screen was completed in this browser session.

At the user's explicit request, one diagnostic approval-code request was made at 17:39:05 Lagos to `/v1/partner-loans/approve-loan/trigger-otp` for `438f96ee-37c4-49bb-a56c-51451f9cb624`. Oxygen returned HTTP 200 with parsed JSON; the captured known response shape contained no repayment-setup link, and no trusted hosted link was returned in the projection. A private, encrypted allowlisted response projection and intent/result receipts were retained outside the repository. No OTP was submitted, no activity token was applied to the workflow, and no approval was repeated. Before/after snapshots and the indeterminate-command fingerprint were unchanged. A new code request succeeding does not establish approval replay safety or repayment-link resend semantics. This diagnostic request does not unlock the checkout's reconciliation hold.

## Evidence capture fix

Durable command execution now encrypts an allowlisted projection of provider status, reference, amounts, known response field types and trusted setup/payment links before business validation. This preserves evidence if a successful HTTP response fails schema/amount validation or subsequent command completion. OTPs, signatures, activity tokens, identity fields, arbitrary body strings and request bodies are excluded. HTTP errors, invalid JSON, oversized responses and interrupted streams retain bounded metadata. Capture failure leaves mutations indeterminate without replay.

The ordinary bound staging worker can read this evidence for reconciliation; customers cannot read it. Entries expire from reads after 24 hours and expired entries are pruned on subsequent merchant writes. Evidence does not automatically overwrite approved terms or resolve an uncertain command. The schema and authorization regression were applied/tested only on isolated staging, with rolled-back synthetic fixtures. Production was not deployed.

The discarded original approval body cannot be reconstructed by this fix. Recover the original approved response/reference/terms and hosted links from Oxygen's trace (or independently verified provider evidence), validate them against the selected plan, then resolve that exact command through the established reconciliation contract. Do not mark it failed merely to permit another approval. Keep activation and settlement disabled.

Validation for the evidence change: 50 focused provider/runtime/cache tests passed; affected Biome checks and web/tools-worker typechecks passed. Database authorization/expiry regression passed on isolated staging with fixture rollback. The staged patch remained byte-for-byte unchanged. No commit, push or production deployment was made.

## Two owner-authorized approval retries — 24 October 2026

The owner explicitly requested two retries and reversal of the test controls. A temporary development-only, loopback/customer-authenticated signature control was shown inside the actual checkout popup, scoped to this exact workflow/reference. The customer supplied a signature and checked acceptance; signature bytes were encrypted locally for the test. No signature was invented or taken from another application.

A fresh approval-code request at 18:09:23 Lagos returned a matching activity token; the latest Gmail code arrived at 18:09:26 Lagos and was retrieved for the test. Two approval calls were made within the five-minute window: retry 1 with this fresh pair, retry 2 with that exact same code/token/signature and selected reference. Both returned HTTP 400, sanitized message `loan not found`. Neither returned a repayment/payment link. Bounded encrypted response evidence and private intent/result receipts were retained. These were diagnostic calls; they did not reset or resolve the existing indeterminate workflow command.

This establishes that requesting a new approval code alone does not recover this reference. Because both approval calls were rejected at reference lookup, it does not establish successful-approval replay semantics, OTP consumption rules, or the correct mechanism to resend a hosted link. The original breakdown read also returned `loan not found`, while payment/setup status returned setup complete and upfront incomplete. Oxygen must reconcile the booking versus approved reference and identify the link-retrigger endpoint and its required reference.

The temporary component, capture route and flow edits were removed; the flow was restored byte-for-byte to the pre-test backup. The encrypted test signature and activity-token file were removed. Existing staged work, saved workflow snapshot, and all indeterminate-command rows were unchanged. Activation and settlement remained false. No cancellation, new application/booking, payment, activation, settlement or production deployment occurred.

## Documentation correction — verified live 24 October 2026

The public GitBook Markdown pages were fetched directly after the normal web reader could not open them. The recovery endpoints are documented; earlier statements that Oxygen must identify the link-retrigger endpoint are superseded by this verification:

- Support APIs: `POST /v1/partner-loans/send/payment-setup`, Bearer authentication, JSON `{ "loan_reference": "..." }`. This resends the repayment setup flow. Its sample response contains `message` and `url`.
- Booking and activation: `POST /v1/partner-loans/send/split/payment-setup` with the same `loan_reference` resends the down-payment setup link. Saved equity plus charges is reused; request amounts cannot override it.
- The approval page says corresponding setup links may be omitted when setup is already complete. Missing charges must not be treated as zero.

Neither recovery request lists OTP, activity token or signature. These endpoints were not invoked during this documentation check. For the observed setup-complete/upfront-incomplete status, the split/down-payment link recovery endpoint is the relevant one to test next. Approval replay is not the documented link recovery mechanism. Do not infer these endpoints will succeed for the selected reference until actually tested; the reference/state inconsistency and original indeterminate approval remain recorded.

Sources: https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis.md and https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-booking-and-activation.md

## Correct recovery endpoint tested

The owner-authorized single split-payment setup retrigger returned HTTP 200 with `message` and `url` for the selected reference. No OTP/signature or approval was submitted. The URL did not pass the current evidence trusted-link filter and was not opened or applied to state; the rejected URL itself was not retained by that allowlisted projection. Original workflow and indeterminate-command fingerprint remained unchanged; activation and settlement stayed false. See `RECOVERY-ENDPOINT-AUDIT-2026-10-24.md` for the full current-docs coverage audit and remaining recovery gaps.

## Payment recovery implemented

The exact returned payment host was `payment.hydrogenpay.com`, confirmed in Hydrogen's official docs. The subsequent payment-specific recovery implementation stores a validated link and payment/setup status separately, with ordinary customer/worker authorization and durable intents/evidence. The actual checkout now restores Continue to payment on reload. No original approval/workflow state was overwritten. See `PAYMENT-RECOVERY-2026-10-24.md`.
