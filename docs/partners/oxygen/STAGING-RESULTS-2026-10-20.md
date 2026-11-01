# Oxygen staging results and remaining checkout work

Checked 20 October 2026 (Africa/Lagos). Staging evidence only; no production
payment, settlement or rollout certification. No runtime checkout change is
delivered by this document.

## Confirmed staging results

- The original application was reused for cancellation/rebooking tests at 25%,
  30% and 35% down payment. Product amount remained NGN 400,000, tenure 3.
- The latest replacement booking reached `ACTIVATED` on 20 October at 10:49 WAT.
  Its financed principal is NGN 260,000, equity NGN 140,000, charges NGN 5,135
  and total upfront payment NGN 145,135.
- All six observed KYC checks completed, including address. The address entered
  Oxygen's manual review queue; automatic address verification was not proven.
- Charges were 1.975% of principal across the three tested equity choices.
  Provider breakdown: management 1%, credit life insurance 0.9%, VAT 0.075%
  of principal. For NGN 260,000: NGN 2,600 + NGN 2,340 + NGN 195.
- The current activation response contains no offer-letter PDF or download link.
  An offer-letter email with a PDF attachment arrived immediately afterwards.
  The user confirmed Oxygen delivers the letter by email; a PDF API is not a
  requirement for the current flow.

Private raw test records remain outside Git in the existing local staging
evidence directory. They contain personal data and must not be copied into docs,
logs, analytics or client bundles.

## Customer offer-letter message

After successful activation, show: **Your offer letter has been sent to your email
address. Please check your inbox and spam folder.**

This is provider-directed delivery wording, not a delivery receipt. If a customer
cannot find it, provide a support route. Do not claim an in-app download exists,
fabricate a PDF URL or treat the repayment breakdown as the actual letter.

## Checkout stages and evidence boundaries

| Stage | Confirmed behaviour | Remaining implementation or proof |
| --- | --- | --- |
| Application and eligibility | Same application reused; customer limit NGN 400,000; minimum NGN 10,000 | Read limits from the provider response; do not hardcode staging values for all customers. Pending is not a decline. |
| Booking and breakdown | Booking returns a reference; details provide schedule; change terms by cancelling and booking again before activation | Persist application and booking identities separately, preserve history and reconcile indeterminate mutations. |
| Address | Submission accepted after booking; manual review eventually completed | Represent review/pending states and resume by status lookup. |
| Approval | OTP and signature accepted; approval can return payment/setup links | Do not equate approval with payment or activation. |
| Upfront payment and repayment setup | Confirmation exposes two completion flags; an already-completed setup link can be absent | Both flags must be true before activation. Customer-driven hosted completion remains unverified. |
| Activation | Latest replacement booking successfully activated | Prevent duplicate activation attempts; reconcile timeouts before retrying. |
| Offer letter | Oxygen emails the PDF | Display email delivery guidance and support for missing mail. |
| Merchant settlement | Provider screenshot shows NGN 260,000 + NGN 140,000 credits and NGN 400,000 withdrawal | Dashboard/destination reconciliation and authenticated settlement callback remain unverified. |

The approval field `first_repayment` represents equity plus upfront charges in
this tested flow. It must not be displayed as the monthly instalment. The loan
details' initial fee entry is separate from scheduled instalments; it previously
contained a date despite the provider describing it as undated. Do not filter
solely by date presence or discard the charge from upfront totals.

## Hosted payment gap

Bank Transfer, Card and OPay failed in the sandbox. Oxygen manually completed
the staging prerequisites; this allowed activation but did not validate the
customer payment journey. The replacement booking inherited completed repayment
setup; this is not evidence that every customer can skip setup.

Do not use the already-activated loan for further payment attempts. A separate
unactivated staging booking and provider-supported test payment instructions are
needed to complete the remaining hosted-flow test without duplicate obligations.

## Settlement check

Local implementation update: [the webhook contract and full synthetic samples](WEBHOOK-CONTRACT-2026-10-20.md) now have matching payload validation, normalisation and authenticated receiver logic. The [standalone staging receiver](../../../apps/web/tools/oxygen-staging-webhook/README.md) now supplies durable local SQLite acceptance and a temporary HTTPS endpoint. Oxygen confirmed the updated active staging registration (HTTP 200). Relevant Oxygen tests (484) and web lint/typecheck passed. Actual provider delivery and settlement reconciliation remain unverified; this is not a production deployment.

The local observer contains one unverified selfie-shaped delivery from 12 October
and no settlement callback for the activated booking. The old diagnostic receiver was not running at the initial check. The later authenticated staging receiver is now running and registered; the historical observation remains separate.

Current official support documentation describes `partner_settlement` and
`vendor_settlement` callbacks. `SUBMITTED` indicates a submitted payout, not bank
receipt. The `activated_loans` list is partner-wide audit information, not a
payout allocation; a payment transaction's `amount_sent` is not settlement proof.
No settlement-status lookup endpoint was found in the indexed documentation.

The staging receiver now covers durable capture, callback authentication and scoped deduplication, and registration is confirmed. Remaining evidence needed: an actual Oxygen test/resend settlement event and merchant/destination reconciliation. Production route/queue integration remains separate. Neither the old unverified observer nor this staging inbox advances an order to paid or fulfilled.

## Remaining provider questions

1. Which sandbox test methods/details allow successful upfront payment and
   repayment setup without manual completion?
2. Can Oxygen resend the settlement event for this activated staging booking,
   and what destination/reference should reconcile the NGN 400,000 payout?
3. What exact time/timezone closes unactivated bookings, and which API status
   identifies closure?
4. If a customer paid before closure, how must we recover or reconcile the
   payment without collecting equity twice? What can resume automatically and
   what requires Oxygen operations?

Support's next-day recovery messages are ambiguous. Do not encode a universal
24-hour expiry, automatic paid-booking replacement or payment carryover rule.
Keep paid-but-closed cases in reconciliation until the contract is confirmed.

## Sources

- [Booking and activation](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-booking-and-activation), checked 20 October.
- [Support APIs](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis), checked 20 October.
- Saved staging results, provider messages supplied by the user, email attachment
  metadata and the current local observer log. Screenshot ledger movements do not
  independently establish merchant receipt.

## Isolated callback simulation completed

On 20 October, the documented transaction, address, vendor-settlement and
partner-settlement samples were delivered through an ephemeral loopback HTTP
receiver into a separate simulation SQLite inbox. All four returned HTTP 200.
Three keyed duplicate deliveries were acknowledged without extra records; wrong
authentication returned 401, unsupported shape 400 and a conflicting replay 503.
Database reopen retained one address, one transaction and two settlement records.
The live staging inbox remained empty and unchanged.

Run this again with `tools/oxygen-staging-webhook/simulate-cli.ts` as documented
in the receiver README. Each run writes a separately labelled private simulation
report. No provider requests, order changes or activation occur. Relevant tests
now total 486 passing; web lint and typecheck passed. SQLite emits Node's existing
experimental-feature warning. This verifies callback transport/storage, not the
customer checkout integration or actual settlement receipt.

## Simulated customer checkout wired

The reusable web checkout now runs against a simulation-only adapter in an
[isolated local preview](../../../apps/web/tools/oxygen-checkout-preview/README.md).
It covers plan replacement and renewed acceptance, separate upfront and instalment
breakdowns, combined total payable, simulated hosted payment/setup returns, both
completion flags, error/retry states and a labelled simulated confirmation with
email-letter guidance. The full journey passed browser verification.

No real activation/settlement API exists on this adapter. It does not read keys,
create real bookings/orders, send email or enable an Oxygen option in the live
storefront. Reload/reset starts a fresh simulation. Real server-side activation,
durable customer attempts and settlement reconciliation remain separate work.

Final verification: 620 relevant tests across 22 files passed, web lint/typecheck
passed, and the isolated preview's TypeScript check passed. No commit, merge or
production deployment was performed.

## New provider adapter: live read-only verification

The new application provider adapter authenticated using the existing bound
staging credentials and read the saved application's KYC status and current
booking's payment/setup confirmation. All six KYC fields returned `DONE`;
`split_payment.completed` and `repayment_setup.completed` returned `true`.
No booking, approval, activation or settlement call was made. This read does not
prove customer payment collection or bank settlement. The new Auth-worker-backed
application forms/callback route remain local until staging provisioning and
deployment; the registered callback URL was not changed in this step.
