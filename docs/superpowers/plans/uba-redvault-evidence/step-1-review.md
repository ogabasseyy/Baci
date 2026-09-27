# Step 1 — full patch review and historical replay

## Current result — source checks and full suite passed

Supersedes the earlier source-governance/full-suite blockers below: reviewed inventory regeneration and clean-snapshot validation passed at `751f3f67991ce70594addd3ee61f8290e58e5f48`. All six test tasks pass, including 33715 web tests and 6011 mobile storefront tests. The unrelated CLI cache change was restored byte-identically. Exact evidence and the remaining CodeRabbit-rate-limit/provider/device/release boundaries are in `local-source-review.md`. REDVAULT remains disabled; nothing was pushed, merged or deployed.

## Local snapshot authorization — subsequent owner instruction

The owner subsequently authorized preparing a local commit. This supersedes the earlier no-local-commit boundary below, but does not authorize push, merge, deployment, activation, production migrations or real payments. The commit records the reviewed implementation, not full-suite or provider acceptance. The unrelated tracked `supabase/.temp/cli-latest` change is excluded and preserved. Source/inventory authority must still be legitimately reviewed; a local commit does not automatically approve a replacement inventory artifact.

The final mobile review rerun completed over 11 files (`/private/tmp/redvault-local-commit-review.log`). Its major finding was confirmed: an all-excluded persisted quote could still show the separate initialization button. The button and start handler now share the positive-discount eligibility guard; a colocated all-excluded regression failed before the fix. Its minor validation-side-effect assertion request was also addressed. Evidence: `/private/tmp/redvault-commit-eligibility-red.log`, `/private/tmp/redvault-commit-eligibility-green.log`, `/private/tmp/redvault-local-commit-lint.log`, `/private/tmp/redvault-local-commit-types.log`. This local checkpoint does not override the full-suite failures recorded below.

Owner authorized this local review/replay step on 12 September 2026. No production activation, migration, deployment, payment, email, commit or production-attestation update is authorized by this step.

## Corrections and evidence

- Registered the exact hashes of REDVAULT 900–923 as pending replay sources, not production-attested post-replay sources. Existing frozen sources, validators and production receipts remain unchanged. Added byte-drift coverage and synchronized the pending-source test expectation.
- A REDVAULT order no longer accepts a contradictory `not_redvault` capture RPC result. That response now fails closed instead of reaching ordinary completion. Whitespace-only checkout retry keys are also rejected. Both regressions failed before correction; the four-file routing/guard rerun passed 26 tests (`/private/tmp/redvault-step1-regression-red.log`, `/private/tmp/redvault-step1-regression-green.log`).
- The scoped order signer omits whitespace-only customer-email claims after normalization. Its new regression failed before correction; signer/authority rerun passed 12 tests (`/private/tmp/redvault-step1-claim-red.log`, `/private/tmp/redvault-step1-claims-authority-green.log`).
- Refund receipts require positive safe-integer amounts. Zero/negative regression cases failed before correction. Draft-order tests now cover failure at every RPC stage without advancing; refund-request tests cover full capture and unsafe ordinals. Combined rerun passed 17 tests (`/private/tmp/redvault-step1-backend-tests.log`).
- Added `supabase/migrations/tests/redvault-current-tree-replay.sql`, a read-only schema/RLS/grant check used by the historical runner's `--sql-check` option. The ordered disposable native fixture passes this check and its existing approval/refund races (`/private/tmp/redvault-step1-native.log`). It does not substitute for historical Supabase replay.

## Review dispositions

CodeRabbit full-patch invocation with `--include-untracked` rejected 190 files against a 150-file limit. Scoped apps, database and shared-package reviews completed: 50, 27 and 2 findings respectively (`/private/tmp/redvault-review-apps.log`, `/private/tmp/redvault-review-sql.log`, `/private/tmp/redvault-review-shared.log`). No subscription upgrade or credits purchase occurred. These are review inputs, not 79 confirmed defects. Subsequent corrections received parent/agent review; they are not represented as a fresh final-tree CodeRabbit clean report.

- Accepted and corrected: contradictory capture receipt, whitespace retry key/customer claim, nonpositive refund receipt.
- Unsafe refund ordinal: existing Zod integer validation already rejects values above the safe-integer limit; added coverage without an unnecessary schema change.
- Rejected suggested `sourceGraph(true)` changes to the two negative import fixtures: that changes ordinary server-only helpers into server-action boundaries. The static module graph intentionally stops ordinary import traversal at `use server` modules. The actual REDVAULT helpers use `import 'server-only'`, not `use server`; their negative fixtures must retain the ordinary module shape. No authority validator was weakened.
- Corrected initialization retry behavior, draft infrastructure error classification, explicit missing refund-reference handling, and canonical attribute-key normalization before group rounding. Shared pricing's collision/group regression failed before correction and its three-file rerun passed 27 tests. Independent agent review found no issue with the normalization/group mutation changes.
- Append-only 918–923 permit only durable-approved fulfillment updates, reject cancelled/invalid states, preserve inventory RPC writes, protect both old/new item membership, add missing foreign-key indexes, and hold fulfillment after any pending/processing/processed refund. Refund restoration policy is not invented. The native ordered run through 923 passed real fulfillment/inventory RPC, refund/approval race and reparenting regressions (`/private/tmp/redvault-step1-parent-native-final.log`). It still models some legacy stock/event dependencies.
- Frontend fixes preserve ordinary payment behavior while blocking missing REDVAULT callbacks, invalid quotes, incompatible discount reuse and repeat initialization. Mobile pending dismissal now navigates to orders rather than resetting checkout to a different payment method. Independent review caught a deferred-response race: a dismissed request could later push the gateway and reset checkout. Active-lifecycle checks now suppress late navigation/state changes without treating cancellation as payment failure; nullable, order-keyed content resets correctly when reopened. Deferred-response regression failed before correction and final scoped tests pass; agent rereview found no remaining issue in this change (`/private/tmp/redvault-step1-pending-close-red.log`, `/private/tmp/redvault-step1-late-init-red.log`, `/private/tmp/redvault-step1-mobile-final.log`). This does not prove real-device/provider acceptance.
- Paystack's current [metadata documentation](https://paystack.com/docs/payments/metadata/) places `custom_filters` inside `metadata`; the review suggestion to move it to the top level was rejected. Unsigned capture evidence must remain held; the suggestion to approve it was also rejected.

## Historical replay

Command from the implementation worktree:

```sh
pnpm --filter @baci/web exec tsx tools/db/run-supabase-history-replay.ts --mode chronological --pending-repair-state materialized --comparison-mode enforce --sql-check supabase/migrations/tests/redvault-current-tree-replay.sql
```

The initial attempt stopped at the unavailable Docker daemon. After starting local Colima, both `chronological` and `production-effect` runs completed successfully against Supabase PostgreSQL 17.6 (server version 170006), including current-tree pending sources through 923 and the read-only SQL checks. Both report enforced convergence with no changed components. Evidence: `/private/tmp/redvault-step1-replay-chronological-final.log` and `/private/tmp/redvault-step1-replay-production-effect-final.log`. This is local historical schema replay, not production migration/attestation or provider acceptance. Owned replay containers were removed; the local runtime remains available.

## Final local validation

- `pnpm turbo lint`: 4/4 tasks passed, warnings remain (`/private/tmp/redvault-step1-current-lint.log`).
- `pnpm turbo typecheck`: 6/6 tasks passed (`/private/tmp/redvault-step1-current-typecheck.log`).
- Parent final frontend reruns: web 5 files / 110 tests; mobile 9 suites / 36 tests (`/private/tmp/redvault-step1-web-final.log`, `/private/tmp/redvault-step1-mobile-final.log`). The final mobile rerun uses the default test timeout. An earlier run under concurrent full-suite load timed out, followed by a passing 15-second-budget run and this passing default-budget run; those failed runs are not relabeled green.
- Parent backend/registry slice: 12 files / 111 tests; final refund reconciliation/recovery: 2 files / 13 tests (`/private/tmp/redvault-step1-parent-focused-final.log`, `/private/tmp/redvault-step1-reconcile-green.log`). Counts overlap earlier evidence and must not be summed into a unique test count.
- The broader history-test run had three timeouts; its exact serial reruns passed in agent review. Do not describe that earlier broad run as green.
- The fresh full monorepo run failed after 7m41s: 4/6 tasks passed; mobile reported 1022 suites / 6008 tests passing and the then-unfixed deferred-dismissal regression failing. Turbo interrupted web when mobile failed. This run overlapped that correction and is not final-tree acceptance. Web had also reported the two source-authority failures and one 30-second manifest timeout. The timeout's exact default-budget serial rerun passes (`/private/tmp/redvault-step1-history-timeout-rerun.log`). Full output: `/private/tmp/redvault-step1-full-tests-final.log`.
- Independently reproduced remaining source-governance failures: `tooling worktree is not clean` and `source tree does not match the approved commit` (`/private/tmp/redvault-step1-source-gates.log`: 2 failures / 11 passes). Do not disable these validators, reset dirty work, or fabricate new reviewed authority. A clean reviewed implementation snapshot and legitimate inventory/source approval are prerequisites for a final full-suite acceptance run. No local commit has been authorized; committing alone is not proof of updated inventory approval.

## Handoff disposition

Local review corrections and historical replay are complete; step-1 aggregate acceptance remains blocked by the source-governance prerequisites and a final immutable full-suite run. Actual Ogabassey web/app nonproduction setup, provider/issuer coverage, commercial sign-off and authorized UBA acceptance tests remain subsequent gates. Availability remains hardcoded false. No production readiness claim is made.

No UBA card is needed for this step. Mocked tests and isolated database replay do not charge a card. Actual UBA acceptance testing is a later separately authorized gate.
