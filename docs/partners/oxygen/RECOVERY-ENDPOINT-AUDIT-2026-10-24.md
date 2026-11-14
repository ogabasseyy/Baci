# Oxygen recovery endpoint audit — 24 October 2026

This records the pre-fix audit. See [implemented payment recovery](PAYMENT-RECOVERY-2026-10-24.md) for the subsequent fix and live verification.

Reviewed all seven pages listed by the live public GitBook `llms.txt`, fetched as Markdown. Compared those contracts with the actual provider allowlist, runtime executor/policy, callback reconciliation, and checkout controls. This is a scoped recovery audit through the current payment step, not a production release review.

## Current selected booking: live link recovery test

- Workflow: `b1c11c04-ef5c-4519-963e-a5a9a8d2f951`.
- Booking: `438f96ee-37c4-49bb-a56c-51451f9cb624`.
- One owner-authorized POST to `/v1/partner-loans/send/split/payment-setup` using that booking reference returned HTTP 200 and response fields `message` and `url`.
- No OTP, signature, approval, new booking or cancellation was submitted. No payment was made. The response's URL did not pass the current response-evidence trusted-link filter; it was not opened, published or added to workflow state. The safe receipt records URL presence; the encrypted allowlisted evidence does not retain the rejected URL value. Do not claim the usable link has been cached. Determine whether scheme, hostname, port, user-info or length caused rejection before changing trust policy.
- The saved workflow snapshot and fingerprint of all indeterminate commands were unchanged. Activation and settlement stayed false.
- Existing approval remains indeterminate. A successful link retrigger is not proof of matching approved terms and must not silently resolve that command.

## Coverage by journey step

| Step | Documented endpoint / recovery | Current implementation | Finding |
| --- | --- | --- | --- |
| Partner authentication | `/v1/partner/login` | `transport.ts`, runtime connection | Present. Reauthenticate without recreating a customer or booking. Docs do not promise replay safety for financial mutations after an auth error. |
| Customer validation code | `/v1/loan-request/retrigger/otp/existing/user` and `/new/user` | `resend_existing`, `resend_new`; customer resend action | Present. Preserve the saved customer branch and original application reference. |
| Face verification | `/v1/loan-request/validate/selfie` returns a hosted URL | `selfie_link` action, hosted-link validation, guided verification | Present. There is no separately documented selfie-link retrigger endpoint in the reviewed pages. Re-requesting/reusing the normal link is distinct from proving a face check completed. |
| NIN and address progression | `/v1/loan-request/validate/kyc/status` | `refresh_kyc`, bounded polling and callback reconciliation | Present. NIN processing must be polled; do not resubmit while PROCESSING or DONE. Docs say not to wait for a selfie/NIN webhook. Recovery reads are blocked by the global reconciliation hold. |
| Eligibility still processing / failed read | `/v1/loan-request/get` | `refresh_eligibility`, eligibility-only retry | Present. This is eligibility retrieval, not a general approved-booking status endpoint. A credit-score retrieval response is not automatically terminal decline. |
| Missing booked schedule | `/v1/partner-loans/details` | `refresh_details`, cache and details-only retry | Present. Never repeat booking merely because schedule retrieval failed. The current selected reference returns `loan not found` here. |
| Approval-code resend | `/v1/partner-loans/approve-loan/trigger-otp` | `trigger_approval_otp`, five-minute code UI | Present. Capture each returned activity token with its corresponding OTP; this is not repayment-link recovery. The reviewed docs do not promise approval replay idempotency. |
| Repayment setup link missing/expired | `/v1/partner-loans/send/payment-setup` | Not in provider allowlist/action schema/executor or checkout recovery controls | **Missing.** Bearer + JSON loan_reference; sample response contains message and url. No OTP/signature listed. Not invoked in this audit because saved setup status is already complete. |
| Upfront payment link missing/expired | `/v1/partner-loans/send/split/payment-setup` | Not in provider allowlist/action schema/executor or checkout recovery controls | **Missing.** Same booking reference; saved equity plus charges is reused. Live diagnostic returned HTTP 200 with url. |
| Returning from hosted setup/payment | `/v1/partner-loans/split-payment-setup/confirmation` | `refresh_payment_setup`, bounded polling and transaction callback reconciliation | Present, but restricted to payment-required/ready stages. Broad reconciliation gating prevents recovery reads in the current hold. Redirect or email delivery is not payment confirmation. |

## Related findings

1. **Known provider reads are inaccessible in the uncertain state.** `runtime-policy.ts` rejects all actions when stage is reconciliation_required. `runtime-reconciliation.ts` applies the same policy before status-read work. `OxygenConfirmationNotice` calls `refresh`, which reloads the saved snapshot. A dedicated, scoped reconciliation read path is needed; do not remove the blanket guard for approval, booking, cancellation, activation or settlement.
2. **Response capture is not the same as a resumable checkout.** Evidence is encrypted before validation, but provider links must also be validated and durably stored with the exact selected reference for a successful return/reopen. The URL filter currently discards untrusted/oversized link values, so the live diagnostic did not retain that URL for later use. Add safe URL-rejection metadata and an explicit review path rather than weakening hostname checks. The retrigger response uses `url`, not the approval response's `split_payment_link`/`repayment_setup_link` field names.
3. **Suggested equity lookup is also absent**, though it is not recovery: `/v1/partner-loans/equity/configuration`. Docs permit 25–90 percent inclusive with at most two decimals; the response's suggested options exclude charges, monthly repayments and tenure. Current custom-input bounds match that documented range. Do not use this endpoint as an instant final repayment quote.
4. **No dedicated recovery endpoint found** in these seven pages for an indeterminate create/book/approval response or for looking up an approved booking by original request/idempotency key. No general idempotency guarantee, automatic cancellation/rebooking policy, or application-expiry-at-midnight rule was found. Those remain provider-contract questions, not reasons to reset a customer application.
5. Docs state approval links may be omitted when the corresponding setup is already complete. `first_repayment` means the upfront amount in the approval response, not the recurring monthly instalment. Keep setup/payment status separate.

## Recommended implementation order

1. Add the two distinct link-retrigger operations with exact-reference binding, normal customer authorization, durable intent/result capture, rate limits and explicit retry classification. Do not replay approval to recover links.
2. Validate the returned hosted URL's environment, origin and purpose; preserve rejected-link metadata without exposing signed query values. Save a valid URL under the matching booking and use a customer-facing Resume payment / Send a new link control.
3. Add scoped read-only reconciliation for uncertain approval outcomes. Keep the original attempt and approved-term checks intact; payment/setup status alone cannot supply missing approved financial terms.
4. Cover response loss, malformed responses, expired links, repeated explicit clicks, reopen/resume, wrong/stale reference, untrusted URLs and status mismatch with mocked provider tests. A retrigger transport timeout still has an uncertain send outcome; do not classify it as confirmed failure and loop automatically.

## Sources

- [Documentation index](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/llms.txt)
- [Authentication](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/authentication)
- [Customer requests and validation](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-requests-and-validation)
- [KYC and address](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/kyc-and-address-validation)
- [Eligibility](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/eligibility-checks)
- [Booking, equity and approval](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-booking-and-activation)
- [Support and setup-link recovery](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis)

No runtime source, environment configuration, customer ownership or staged index was changed for this audit. No deployment, approval, cancellation, new application/booking, payment, activation or settlement was performed.
