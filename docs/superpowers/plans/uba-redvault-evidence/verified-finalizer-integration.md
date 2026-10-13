# Verified finalizer integration — 12 September 2026

Status: implemented locally with scoped parent review; release acceptance remains blocked and availability remains disabled.

## Latest step-1 review

Supersedes the historical-replay and 917-only status below: parent passed native ordered migrations through 923 and both chronological/production-effect historical Supabase PG17 replays with enforced convergence and current-tree SQL checks. Final local lint/typecheck pass; focused web/mobile reruns pass 110/36 tests. The full monorepo run failed and is not final-tree acceptance; the corrected regression passes on focused rerun. Clean reviewed-source/inventory gates remain. See `step-1-review.md` for exact logs, review dispositions, additional guards and remaining external acceptance gates. No commit, remote migration, activation, deployment or real payment occurred.

## Atomic inventory review update

Parent independently ran `node supabase/migrations/tests/run-redvault-native.mjs` through 916 successfully: `/private/tmp/redvault-parent-native-916.log`. The runner loads the current gateway-completion wrapper chain through `20260806000200` and the real inventory-confirmation function definitions. Direct SQL tests show null/malformed inventory results and strict inventory failures roll back approval, redemption, order/transaction payment changes and outbox seed together; retry then approves and returns a stable inventory-confirmed receipt. The fixture still stubs stock-sync/event dependencies and does not model the complete production schema. Ordered migration smoke and refund-race coverage are being finalized separately.

Independent TypeScript rereview accepted the inventory-proof guard. Parent atomic-inventory integration tests passed: five files / 58 tests in `/private/tmp/redvault-atomic-inventory-integration.log`. Finalizer skips generic paid-status rollback only after validated atomic inventory proof; ordinary gateways retain their existing inventory path. Aggregate lint/typecheck and the live authority verifier also pass after that change (`/private/tmp/redvault-atomic-lint.log`, `/private/tmp/redvault-atomic-types.log`, `/private/tmp/redvault-atomic-boundary.log`).

Parent also independently passed `run-redvault-ordered-migration-smoke.mjs`: `/private/tmp/redvault-parent-ordered-smoke.log`. This applies REDVAULT migrations 900–916 in timestamp order and exercises a tier-correct draft, attempt, held capture, negative evidence/inventory cases and successful atomic approval/replay. It uses the same modeled legacy schema and is not full production Supabase replay. The independent SQL reviewer found no additional defect in active 916; no production readiness conclusion follows from that scoped review.

The subsequent parent ordered run through 917 also passed (`/private/tmp/redvault-parent-ordered-917.log`), including the null transaction-status guard. Parent's latest REDVAULT/finalizer run passed 36 files / 267 tests (`/private/tmp/redvault-integrated-final-focused.log`). The ordered runner now executes true concurrent approval/refund coverage: two approvals produce one first receipt and one replay; a refund-first transaction blocks approval and prevents redemption/payment; approval-first forces the refund to wait and preserves approved, paid, inventory-confirmed receipt state. Barriers inspect actual database blocking, not sleep-only timing. Parent rerun evidence: `/private/tmp/redvault-parent-final-concurrency.log`. These remain disposable modeled-schema tests, not live provider or production database evidence.

## Parent implementation

- Extracted gateway completion routing from the existing finalizer, preserving ordinary payment handling and keeping the modified finalizer under 300 lines.
- A held Paystack REDVAULT capture can proceed only through an Ogabassey-only server adapter. The adapter checks availability, obtains an order/transaction-bound private context through a restricted RPC, fetches fresh Paystack verification, normalizes only required fields, and calls atomic approval. Callback payloads and requested filters do not supply eligibility proof.
- Invalid context, provider failure, mismatched issuer/domain/reference/customer/amount/currency and missing evidence remain held. An ambiguous approval result cannot fall through to ordinary completion.
- Approved completion uses the database's standard completion receipt. A duplicate receipt does not replay the original first-payment flags or treat the same transaction as an additional settlement capture. Existing inventory/outbox recovery remains the downstream authority.
- Review identified that generic post-payment inventory rollback could leave an approved REDVAULT application attached to an unpaid order. The active integration now requires `inventoryConfirmed: true` and a validated reclaimed-unit count from atomic SQL completion before bypassing generic inventory compensation. Missing proof fails closed. Migration 916 and its native inventory/rollback tests passed scoped review; cached-stock revalidation remains a best-effort postcommit step.
- No credentials, service-role client factory, activation flag, production migration, deployment or real payment was introduced or executed.

## Current parent evidence

- Focused REDVAULT/finalizer suites: 36 files / 261 tests passed, `/private/tmp/redvault-integrated-focused.log`.
- Surrounding payment/order route regressions: 5 files / 204 tests passed, `/private/tmp/redvault-parent-payment-regressions.log`.
- Shared REDVAULT pricing/refunds: 3 files / 25 tests passed, `/private/tmp/redvault-parent-shared-latest.log`.
- Native checkout screen switching, helper, availability and cancellation: 4 suites / 7 tests passed, `/private/tmp/redvault-parent-checkout-acceptance.log`. Parent accepts this corrected frontend slice for local integration, not physical-device acceptance.
- Aggregate lint and typecheck passed, `/private/tmp/redvault-integration-lint-final.log` and `/private/tmp/redvault-integration-types-final.log`.
- Live event-pipeline boundary verification passed (154 seed paths), `/private/tmp/redvault-integration-boundary.log`.
- Full monorepo test run finished unsuccessfully: five of six tasks passed; web had 5,411 passing files, 10 failing files and one skipped file, with 33,653 passing tests and 13 failures. Log: `/private/tmp/redvault-integration-all-tests.log`. This overlapped edits and is not an immutable final-snapshot run. Two cancellation-receipt failures now pass in a fresh 10-test schema rerun (`/private/tmp/redvault-receipt-final-rerun.log`). Two authority expectation failures concern the already approved three signing paths and orders receipt. Remaining failures concern the exact historical migration registry and clean/approved-source-tree prerequisites; these guards must not be disabled to claim success.
- Latest aggregate lint/typecheck passed: `/private/tmp/redvault-parent-final-lint.log`, `/private/tmp/redvault-parent-final-types.log`.

## Required before final acceptance

Scoped TypeScript, SQL and recovery reviews are complete; the ordered fixture includes migrations 900–917 and approval/refund race directions. This does not satisfy the complete release gate: full aggregate tests, full-patch review (the earlier CodeRabbit run excluded untracked files), historical Supabase replay, production recovery authority, provider acceptance/settlement evidence, commercial launch inputs and authorized web/native end-to-end acceptance remain required. No successful local fixture authorizes production activation.

The historical replay failures are an integration gate, not asserted to be unrelated bugs: its exact source registry does not yet include REDVAULT 900–917. Register the final reviewed migration bytes and their SHA-256 receipts in a clean approved replay snapshot, then execute the historical replay gate. Do not loosen the registry validator or bypass the clean/approved-tree requirements. Two failed suites and seven failed tests cascade from that missing registration; two additional cost-evidence tests require a clean, approved source tree. The current worktree must be preserved, not reset to force those tests green.

The two stale authority-test expectations have been updated only for the existing owner-approved three initialization signing paths and orders-route hash; authority source and permissions were not expanded. Parent rerun passed three files / 14 tests: `/private/tmp/redvault-parent-acceptance-rerun.log` (also includes the final cancellation-receipt tests). Final lint passed four tasks and typecheck passed six tasks: `/private/tmp/redvault-handoff-lint.log`, `/private/tmp/redvault-handoff-types.log`. That focused result does not retrospectively make the full run pass.

Provider contract rechecked against [Paystack verification documentation](https://paystack.com/docs/payments/verify-payments/). Production is not ready merely because synthetic tests pass.
