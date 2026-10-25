# Fresh staging application — 2026-10-24

User authorized a fresh staging application to test 30% and 37.25%, without cancellation, approval, activation or settlement.

- New order: `99744178-6b29-4273-9bac-f8a495c5583d`; created through the normal checkout API with the existing customer and product, NGN396,000.
- New workflow: `b1c11c04-ef5c-4519-963e-a5a9a8d2f951`.
- New Oxygen application: `d56bcf46-5d3d-4aef-84cd-f9a8ace8bb0a`.
- Application creation called once, accepted. Customer validation completed with the supplied customer OTP. No loan-approval OTP was submitted. All six KYC statuses are DONE. Eligibility subsequently returned FAILED; no booking on this new application has been attempted.
- Activation and settlement remain false. No approval requested/submitted.
- Original order, workflow and bookings are preserved; new intent and exclusive provider-create lock retained privately. Never replay the create call.
- Tests of 30% and 37.25% remain blocked on successful eligibility. No new financial breakdown can be claimed yet.
- A successful fresh request would not establish a midnight expiry contract. Do not implement automatic midnight resets or replacement of booked/indeterminate workflows based on this comparison alone.

The initial direct order RPC was rejected with `storefront_order_route_context_required`; it created no order. The normal checkout API then created the new order. Draft restore initially stopped on missing process-injected encryption key, then resumed on this same new order/workflow with the local key and preserved ownership. These local setup recoveries made no extra Oxygen application calls.

Latest eligibility report: status FAILED, is_eligible false, message “Failed to fetch loan history. Please try again later.” This matches the older application’s decimal-booking error and occurred on the fresh application, so expiry is not established as the cause. No midnight reset behavior was introduced.

## Recovery and successful plan tests

A later single eligibility retry returned COMPLETED and is_eligible true. All six KYC checks remained DONE. No fresh application or OTP resend was needed.

| Percentage | Reference | Equity | Principal | Charges | Upfront (equity + charges) | Repayments |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 30% | bec37629-6e22-4f5b-8e5d-de44f8d9f93a | 118800 | 277200 | 5474.70 | 124274.70 | 103895, 103895, 103895.53 |
| 37.25% | 93bfcfe2-9a98-48c4-83f0-81cc877a01e3 | 147510 | 248490 | 4907.68 | 152417.68 | 93135, 93135, 93133.71 |

Both plans cover NGN396,000 over three months. Repayment dates: 27 November 2026, 27 December 2026, 27 January 2027. Charges and schedule are from Oxygen details, validated with the existing breakdown parser. Upfront is calculated as confirmed equity plus confirmed charges; the initial booking response itself returned null upfront/charges.

The first script completed 30% booking/details, then stopped locally before issuing the decimal booking because the public snapshot correctly omits the phone. A separate exclusive decimal-only script supplied the same authorized checkout phone and made exactly one 37.25% booking and one details call. The 30% call was not repeated.

Both confirmed plans are in the fresh workflow cache with three schedule rows each. Saved comparison preference is 37.25%; canonical workflow reference remains 30%. Preference does not approve or replace canonical provider state. No approval OTP, approval, cancellation, activation or settlement was called. Original workflow snapshot and existing indeterminate-command fingerprint were unchanged in both audits. Activation and settlement remained false.

The fresh checkout URL was queued in Codex for display. No screenshot/rendered UI verification was obtained because browser observation was previously blocked; database cache verification succeeded. This recovery supports a transient provider issue, and establishes no midnight expiry rule.
