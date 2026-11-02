# Booked plan display and read-only retries

Official sources checked on 23 October 2026:
- https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-booking-and-activation
- https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis

The booking example returns `BOOKED` with equity, principal and tenure, while
`total_charges`, `total_upfront_payment` and `first_repayment` are null. The docs
explicitly direct partners to `/v1/partner-loans/details` for charges and the
repayment schedule before approval. Approval returns the final upfront collection
amount; it cannot override saved equity. Missing charges never mean zero.

The current staging details response includes a separate charge row of NGN
5,083.65 and three repayments: NGN 96,474.00 on 27 November 2026, NGN 96,474.00 on
27 December 2026 and NGN 96,474.26 on 27 January 2027. Repayment `period` values are
35, 30 and 31 rather than sequence numbers. Their semantics are not documented;
they must not be used as installment identifiers or to sort the schedule.
Normalize installments by validated, distinct due dates, retaining checks on
count, principal totals and principal-plus-interest amounts. Display equity plus
returned charges as the upfront total, without initiating its collection.

A failed details lookup offers a dedicated retry of `refresh_details` on the same
workflow and booking. It does not create, book, cancel, approve, activate or settle
anything. Pending/indeterminate commands retain the saved-status recovery path.
Automatic lookups remain bounded rather than looping after a provider failure.

No in-place equity amendment endpoint was found in these docs. Cancellation is
documented only after booking and before activation; approval and payment-link
resend cannot override saved equity. Cancellation followed by another booking is
not a confirmed safe amendment/recovery contract. Do not test it without provider
clarification and explicit authorization. No cancellation/rebooking or OTP action
was performed for this display fix. Activation and settlement remain disabled.
