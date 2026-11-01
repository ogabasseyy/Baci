# Paid staging plan: automatic activation and actual response

The owner authorized one manual activation test for the currently selected paid staging booking, then automatic activation after verified payment completion. Settlement, production activation, cancellation, booking and approval replay remain disabled.

## Exact scope and observed response

- Order: `690a9d2e-33b7-4106-8c68-b9019f814dce`
- Workflow: `52ab6696-762b-4e9f-8f99-a9d926a29b2c`
- Booking: `b75cd437-28af-4008-a1af-7e6810282833`
- Fresh payment read: HTTP 200 at 2026-10-30 03:39:09 WAT, both payment/setup completion flags true.
- Exactly one activation request: HTTP 400 at 03:39:25 WAT, message `Failed to fetch loan history. Please try again later.`
- Trial terminal state: `rejected`. Complete response bodies are encrypted in the private activation-trial ledger, with a private encrypted export in the portable runtime. No retry was sent.
- Before/after normal workflow snapshots and older indeterminate-command fingerprints matched. No settlement, order-paid, dispatch or ownership mutation occurred.

## Implementation

The existing one-use staging activation capability now targets this exact booking. Its older trial row and evidence remain unchanged. General runtime `activationEnabled` and `settlementEnabled` remain literal false. New append-only migration updates the restricted capability; it was applied only to the isolated staging database.

A confirmed transaction callback first performs the existing authoritative payment status read. Only both completed flags allow the activation follow-up. The popup also reads durable activation status on opening the confirmed-payment screen and starts a ready trial without a button. Server-side row locks and durable claim prevent duplicate provider mutations across callbacks, concurrent requests, refreshes or remounts. Executing, rejected and indeterminate trials never replay automatically. An uncertain response remains uncertain.

Activation rechecks payment with Oxygen before sending. Durable admission accepts confirmation from either the canonical workflow's ready-for-activation state or the payment-recovery ledger, bound to the same reference. Unpaid/cancelled bookings and unrelated customers are rejected. This is a staging test capability, not production-wide activation enablement or a deployed callback worker.

The actual popup preserves the paid amount and tells the customer confirmation could not be completed, with no repeated payment or activation button. A confirmed activation would show `Payment plan confirmed`. It does not assert merchant settlement or fulfilment. Production order-paid/dispatch requires authoritative finance/settlement evidence and the commerce finalization contract, which this change does not enable.

## Verification

- 34 focused activation, payment callback, API, connection and UI tests passed.
- Expanded isolated SQL checks passed inside a rollback-only transaction: customer/worker roles, stranger denial, unpaid and cancelled admission, exact reference, claim once and terminal no-repeat.
- Broader Oxygen suite: 1187 passed, 9 failed across existing signature acceptance, OTP digit visibility, saved plan, offer-completion and selfie journey expectations. These failures were not changed as part of the activation task; no clean whole-suite claim is made.
- Full lint and typecheck passed. The repository-wide test run was stopped after 13 minutes; mobile-admin completed 4724 tests, while the web run was incomplete. No clean repository-wide test claim is made.

## Explicitly authorized retry — 30 October, 04:17 WAT

The user requested “Try again now”. Before admitting one retry, the rejected trial was privately archived with its evidence and a SHA-256 fingerprint. Only this exact rejected staging trial was returned to ready; the prior two encrypted response captures were retained. No uncertain or older booking was rearmed.

The fresh payment check returned HTTP 200 at 04:16:59 WAT, with payment/setup completed. One activation retry returned HTTP 400 at 04:17:15 WAT with the same message: `Failed to fetch loan history. Please try again later.` The trial is terminal rejected again, with four encrypted response captures. Normal workflow and older indeterminate-command fingerprints were unchanged. No settlement or further retry was sent.

## Explicitly authorized retry — 30 October, 06:29 WAT

The user requested “try now”. The prior rejected trial and four encrypted response captures were privately archived before admitting one retry for the same booking. Fresh payment status returned HTTP 200 at 06:29:00 WAT. One activation attempt returned HTTP 400 at 06:29:02 WAT with a different message: `User does not have a valid statement and user has option to add another bank`.

The trial is rejected with six retained encrypted response captures. Normal workflow and older indeterminate-command fingerprints matched their before/after values. No bank change, application creation, booking, approval or settlement was performed. Activation requires resolving the provider's statement/bank prerequisite; this response does not authorize silently switching bank details or creating another application.

## Explicit retry and confirmation-screen cleanup — 30 October, 06:50 WAT

The user requested one additional retry and removal of the repeated plan/product on the paid screen. The prior six response captures were privately archived and retained. A bounded evidence-retention migration raises the restricted trial capture limit to 32; it does not change claim, reference, payment or settlement guards. Its SQL regression passed after aligning rollback-fixture lock order with the live workflow lock order.

Fresh payment status returned HTTP 200 at 06:50:54 WAT. Exactly one activation request returned HTTP 400 at 06:50:54 WAT: `User does not have a valid statement and user has option to add another bank`. The trial is rejected with eight encrypted response captures; earlier evidence, normal workflow and old indeterminate commands are preserved. No bank change or settlement occurred.

The provider flow no longer renders its outer product card or plan on the confirmed-payment screen. The success component retains one product card and removes its optional plan expansion. Payment recovery owns the product card while that step is unpaid, then passes ownership to the success component. Regression coverage checks both APPROVED and stale BOOKED booking projections, so a completed payment cannot expose plan selectors again.

## Provider fix verified — 30 October, 07:56 WAT

After the owner reported Oxygen had fixed the issue, one verification retry was admitted for the same previously rejected booking, preserving all eight earlier encrypted response captures and a private before-state archive. Fresh payment status returned HTTP 200 at 07:55:56 WAT. Exactly one activation request returned HTTP 200 at 07:56:07 WAT with `status: ACTIVATED` for `b75cd437-28af-4008-a1af-7e6810282833`.

The captured safe projection is product_amount 198000, loan_amount 148500, equity_percentage 25, equity_amount 49500, total_charges 2932.88, total_upfront_payment 52432.88, first_repayment 52432.88 and loan_tenure 3. As in the earlier trial, first_repayment equals the upfront amount and must not replace the saved monthly schedule.

The trial is now terminal activated with ten encrypted response captures. Reopening reads the stored terminal result and cannot send another activation. Original normal-workflow snapshot and older indeterminate-command fingerprints remained unchanged. General activation/settlement flags are still false; no settlement, order-paid, dispatch, bank change, cancellation, new application or approval replay occurred. Activation confirms the finance plan; commerce order/fulfilment finalization remains a separate uncompleted boundary.

## Automatic order-confirmation navigation

Removed the Back to checkout button. The owned Oxygen checkout now supplies a navigation-only context. On a stored terminal activation whose result status is ACTIVATED and whose loan_reference matches the selected reference, the popup invokes that context once. It replaces the route with the existing merchant order-success page, carrying only orderId and type=oxygen. Custom-domain empty base paths and slug-based storefront paths are covered. Failed, uncertain or mismatched activation results never navigate. Existing activated state on a reopened checkout also advances without another activation request.

The actual localhost browser automatically reached the same order's Order Confirmed page, showing order ORD-261025-00E9-K and total NGN198000. This is the existing order-received presentation, not a new order-paid/settlement mutation. No provider mutation, new application, booking, OTP or bank change was needed for this UI transition.

96 focused UI/navigation/order-success regression tests passed. Full lint passed with six existing warnings and full typecheck passed. A screenshot is saved locally at /tmp/oxygen-automatic-order-confirmation-20261030.png. No production deployment was performed.
