# Verification order clarified on 26 October 2026

The owner supplied a partner conversation clarifying that eligibility runs after
BVN confirmation; NIN must be completed before booking. This replaces the local
assumption that NIN or bank completion must precede eligibility.

The storefront sequence is:

1. Create the application with explicit consent and validate the onboarding OTP.
2. Complete the hosted selfie/BVN check and confirm phone, BVN and selfie status
   through Oxygen's KYC-status endpoint.
3. Request eligibility without requiring NIN or bank status to be `DONE`.
4. Only after successful eligibility, submit NIN once if it is `NOT_DONE`.
   Read KYC status while NIN is processing; never resubmit a processing NIN.
5. Require confirmed NIN and bank status before offering booking. Booking remains
   a customer action; no background verification check books or approves a plan.

Eligibility failure or an uncertain command stops automatic progression. A
completed identity check is preserved; there is no application reset or new OTP
as part of this ordering repair. Existing applications that already have NIN
`DONE` skip NIN submission. Activation and settlement remain disabled.

This sequencing correction does not establish that ordering caused the observed
staging eligibility failures, nor that retrying will resolve a failed assessment.
