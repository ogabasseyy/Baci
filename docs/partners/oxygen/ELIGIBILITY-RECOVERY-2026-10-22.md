# Eligibility refresh recovery test — 22 October 2026

Tested against the same existing staging application, without creating a replacement application. No approval, activation, payment or settlement was performed.

## Observed sequence

1. Earlier booking attempts failed. A controlled diagnostic attempt returned HTTP 400 with the provider message: `User does not have a valid statement and user has option to add another bank`.
2. Oxygen suggested eligibility might have expired. This is a provider hypothesis, not a confirmed expiry rule or root cause.
3. A fresh authenticated `POST /v1/loan-request/get` for the same request returned HTTP 200, `status: COMPLETED`, `is_eligible: true`, eligible amount NGN 400,000, minimum NGN 10,000 and maximum tenure 12 months.
4. Immediately afterwards, one explicit retry through the persisted checkout workflow requested the customer's selected NGN 396,000 plan: 25% down payment and 3 months. The implied principal was NGN 297,000, within the returned limit.
5. The retry returned local HTTP 409. Its durable command ended as `failed`; the workflow remained `plan_required` with no saved booking reference. The raw provider response for this latest retry was not captured. Do not assert that its rejection message was identical to the earlier statement rejection.

The direct diagnostic eligibility read did not update the local workflow state. That state already recorded eligible=true and matching limits. This verifies a fresh provider read followed by a persisted booking attempt, not a newly implemented automatic recovery feature.

## Recovery conclusion

Eligibility refresh succeeds, but this test did **not** establish successful booking recovery. Do not infer that fetching eligibility renews its lifetime, re-fetches a bank statement, or repairs the missing-statement condition. No eligibility expiry timestamp or duration was returned by the checked response.

For a future recovery implementation:

- Confirm with Oxygen whether this endpoint refreshes assessment/statement validity or only reads it, the applicable expiry rule and a machine-readable expiry error.
- Preserve the same application when supported and validate current limits before a booking submission.
- Only retry a rejected booking after its durable outcome is confirmed and recovery is supported. Reconcile an indeterminate booking before any retry.
- Do not automatically loop refresh → book, replace the application, or ask for bank details solely from a generic error.
- Keep activation and settlement separately disabled in this staging flow.

Related evidence: [staging results](STAGING-RESULTS-2026-10-20.md) and [contract register](CONTRACT-REGISTER.md), especially CR-09 for statement handling.
