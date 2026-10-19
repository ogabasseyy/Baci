# REDVAULT integration review — 12 September 2026

## Scope and current disposition

Latest step-1 evidence supersedes the 917-only/historical-replay-pending snapshots below: ordered native 900–923 and both historical Supabase PG17 replay modes pass, as do aggregate lint/typecheck and focused web/mobile checks. Full-suite acceptance and real Ogabassey nonproduction/provider/device acceptance remain separate gates. Details: `step-1-review.md`. Availability remains disabled; no deployment or activation occurred.

Owner clarification after rereading the UBA email and returned MOU: the rate is 10% below ₦200,000 eligible merchandise subtotal before discount, and 5% at or above that threshold. Only shared-policy negotiable merchandise counts; excluded products and fees do not. This supersedes every flat-5% planning reference. The accepted Paystack bank-filtered journey is not reopened; supplied ranges remain provider coverage-test inputs.

Implementation is in the detached local worktree at `449e604c434f7a9996e7284acf0dfd6c190f0187`. Changes are uncommitted. The standalone demo is deleted; the actual Ogabassey web and mobile checkout paths are being validated. No deployment, remote migration, email, real payment, or activation was performed.

The implementation remains unavailable by default. The positive path is now connected locally: fresh server verification, immutable policy/transaction binding, atomic inventory/approval/redemption/paid completion, and replay-safe finalizer routing. Parent passed the ordered 900–917 fixture, true concurrent approval/refund cases and focused integration tests. The full monorepo run finished with failures; it is not a release acceptance. No frontend switch bypasses the disabled gate. Current evidence and failure triage are in `verified-finalizer-integration.md`.

## Parent verification

- Backend/order/payment regression run: 65 files, 587 tests passed.
- Web checkout regression run: 88 files, 798 tests passed before the final callback follow-up.
- Parent final actual callback plus checkout-page rerun: four files, 73 tests passed. The earlier detached-element failure came from unstable test router/motion identities and was corrected with stable mocks and StrictMode replay coverage. Log: `/private/tmp/redvault-parent-callback-final.log`.
- Latest refund transport/orchestration and strict server-summary parsing: 3 files, 59 tests passed.
- Native PostgreSQL fixture through migration 910 and independent attempt-concurrency runner passed. Includes actual capture/refund reverse-lock concurrency, conflicting capture-status replay rejection, duplicate draft/initialization claims, and held-refund checks. The agent also demonstrated the old lock order deadlocks and old replay behavior accepts conflicting status.
- These native PG18 fixture tests are not a production PG17/Supabase historical migration replay.
- Final aggregate lint and typecheck passed (four lint tasks, six typecheck tasks). Existing warnings remain; mobile test typing errors were corrected. Logs: `/private/tmp/redvault-final-lint4.log`, `/private/tmp/redvault-final-types4.log`.
- Parent mobile focused regression run passed: eight suites, 46 tests. Agent's larger integration run passed 18 suites, 171 tests, with separate presentation/extraction checks recorded in phase-4b.
- Native runner through migration 911 passed independently, including refund lookup lease expiry, new fencing-token acquisition, stale/null-token rejection, and preservation of reserved funds. A timed-out lookup can retry after lease expiry; ambiguous refund submission still cannot resend.
- Full monorepo test run failed: web 5,398 files passed, 10 failed, one skipped; 33,536 tests passed, 12 failed. Shared passed 1,150 tests and mobile-admin passed 4,293 tests. This run overlapped fixes and is not final-snapshot acceptance. Failures include historical-source/approved-tree prerequisites, the new authority paths described below, and earlier UI/modularity snapshots. Final focused reruns do not turn that overall run green.
- CodeRabbit completed a tracked-diff review with five findings. Parent verified the order idempotency guard already accepts a key; a route regression was added. Web/mobile availability and state-coverage findings are being verified against final files. The reviewed-file list excludes new untracked files, so this is not a clean full-patch review.

## Security corrections made during parent review

1. SQL negative-test helper must fail when the tested statement does not throw; old false-positive results were superseded.
2. Frozen order/quote identity, trusted merchant/customer scope, canonical totals, integer arithmetic, and retry keys are checked before accepting the discounted draft.
3. Initialization has one durable claimant; response loss cannot create a second charge attempt automatically.
4. Capture evidence does not imply eligible payment. Unknown/mismatched evidence cannot fulfill, redeem a discount, or credit merchant spendable funds.
5. Capture and refund lock attempts before application rows. Duplicate receipts cannot change capture status silently.
6. Refunds use stored net allocations and verified capture amount, reserve cumulative amounts, and retain ambiguous submissions. Provider lookup is read-only and bound to the durable refund ID.
7. Initialization reconciliation and received-but-held payment states have distinct customer copy. Neither can clear the cart or claim payment success. Actual web callback coverage includes a held reference and an unpaid REDVAULT order lookup; native coverage includes verification errors and duplicate callbacks.

## Repository governance approval

The owner explicitly approved the narrow initialize/helper credential paths and reviewed orders-route receipt on 12 September. Exactly three paths and only the orders receipt were updated; the helper additionally rejects non-Ogabassey merchants before signing. No signer implementation, service-role permissions, or checker logic changed. Live repository boundary verification now passes (154 seed paths); eight focused suites / 209 tests, aggregate lint, and typecheck pass. Details and logs are in `initialization-authority-approval.md`. This resolves the governance blocker, not the outstanding successful-payment implementation or release gates.

## Remaining release gates

- Paystack/UBA testing evidence for the accepted bank-filtered journey: issuer coverage across online-enabled Verve, Visa, Mastercard using the supplied ranges as coverage inputs; trusted verification evidence needed to approve a captured payment. Bank-filtered route acceptance is already confirmed; do not reopen it as an owner scope decision or introduce merchant-side card collection.
- Confirm provider-side settlement/subaccount handling before enabling any discounted charge. A Baci ledger hold alone cannot prevent Paystack settlement.
- Owner commercial inputs not invented here: campaign dates, caps/minimums/usage rules if any, stacking/wallet/split policy, funding/fees, and cancellation/refund restoration terms. Fixed inputs remain Ogabassey-only, 10%/5% eligible-subtotal tiers at ₦200,000, and the shared non-negotiable-product exclusions.
- Finish final concurrency/integration acceptance of the implemented positive transition, separately authorize production refund/reconciliation transport, and complete operational/provider acceptance and final patch review. Local-test recovery transport is parent-accepted; that does not provision production authority.
- Full historical database replay, final aggregate validation, physical iOS/Android and real storefront end-to-end QA in an authorized nonproduction environment, then separately approved release. No successful UBA-card acceptance claim is supported by mocked tests.

## Official documentation rechecked

- [Paystack metadata](https://paystack.com/docs/payments/metadata/): documents selected bank and card-brand filters, not an exact eight-digit allowlist contract.
- [Paystack refund API](https://paystack.com/docs/api/refund/): source for refund submission and read-only refund lookup adapter; local tests use mocks only.

The provisional 5–10 working days was not validated and is not a delivery promise.
