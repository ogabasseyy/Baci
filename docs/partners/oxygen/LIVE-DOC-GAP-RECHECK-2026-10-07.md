# Live documentation gap recheck — 7 October 2026

Read all seven live GitBook pages through the in-app browser's read-only
getPage tool; documentation search also returned the same seven-page set.
No API calls, partner messages or application changes. No example tokens,
customer identifiers or embedded document content retained here.

## Corrections to broad earlier questions

- Loan request creation includes accept_terms_and_condition. Terms acceptance
  is not wholly absent; the terms document/version, offer disclosure and
  acceptance evidence requirements remain unspecified.
- Hosted selfie validation exists via the URL returned by
  POST /v1/loan-request/validate/selfie.
- Repayment setup resend returns a URL via
  POST /v1/partner-loans/send/payment-setup.
- POST /v1/loan-request/get checks eligibility using a known request reference;
  POST /v1/loan-request/validate/kyc/status checks KYC;
  POST /v1/partner-loans/split-payment-setup/confirmation checks setup completion.
  Status checking is not wholly absent. General booked-loan/settlement lookup
  and correlation after a lost create/book response remain undocumented.
- Partner/standalone merchant verification and dashboard reference acquisition
  are described. Submerchant provisioning and reference-to-beneficiary binding
  remain unspecified. A single standalone merchant may not need the complete
  Baci multi-merchant model; confirm our account category before finalising it.
- Dev permits real test data and says no disbursement occurs there. This is
  documented for Dev only, not a production guarantee.

## Remaining gaps in the reviewed pages

1. Account mapping: which partner/standalone merchant/submerchant category our
   account uses, when merchant_reference is required, and payout beneficiary binding.
2. Customer completion: new-user validation token origin; bank-statement handling;
   offer, fees, equity and repayment schedule retrieval; terms version/evidence.
   Hosted selfie and repayment pages do not establish a complete hosted application
   or its return protocol. A full hosted flow is a capability question, not a
   prerequisite if Baci implements the API-driven application itself.
3. Financial safety: amount currency/units and gross vs financed amount; tenure
   units; BNPL equity versus repayment setup prerequisites; webhook delivery auth,
   payloads and event identities; idempotency/status recovery; dispatch authority.

Eligibility introduction says check before creating a request, but its required
loan_request_reference and the overview place the check after creation/validation.
Booking introduction distinguishes cash repayment setup from BNPL equity, while
its flow notes describe repayment setup for both. These contradictions remain.

## Short provider follow-up

We have reviewed the API flow, including hosted selfie and repayment setup.
Please help with three remaining areas:

1. Confirm our account category, required merchant reference and payout mapping.
2. Provide one complete BNPL customer example, including where the new-user token
   comes from, any bank-statement step, offer/fees/schedule/terms, amount units and
   equity/repayment prerequisites. Is there a full hosted application, or should
   we build the customer application using the documented APIs?
3. Provide webhook payload/auth examples and loan-status/idempotency recovery,
   and confirm the verified status/event that permits goods dispatch.

## Sources

- https://oxygenxfinance.gitbook.io/oxygenxfinance-docs
- https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/authentication
- https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-requests-and-validation
- https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/kyc-and-address-validation
- https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/eligibility-checks
- https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-booking-and-activation
- https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis

Validation: source links taken from live page tool results; note manually checked
against all seven page bodies. Whitespace checked separately. No runtime tests needed.
