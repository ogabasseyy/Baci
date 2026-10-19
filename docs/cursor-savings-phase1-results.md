# Savings variant Phase 1 — takeover review checkpoint

Status: in progress, not approved for shipping. Base HEAD: `d0d1cbd2fd4b5867a980644acf5e29fd7c451c0c`; detached worktree `/Users/mac/Baci-worktrees/cursor-savings-phase1`. Cursor's existing patch was preserved. No production, provider or remote database access was used for this review.

## Reproduced and repaired during takeover

- A stale/deleted route variant silently selected the sole remaining variant. Added a hook regression, observed failure, then required an absent requested ID before single-variant fallback.
- Products whose variants all have invalid prices produced a selectable product-level fallback. Added a failing regression and restricted fallback to products with no variants.
- An unresolved auto-debit goal displayed an instruction to choose a variant without exposing Change device. Added a failing modal regression and separated device correction from manual top-up eligibility, preserving the completed-goal restriction.
- Fixed TypeScript failures in the inherited query-client boundary, explicit result union, synthetic fixture typing, partial controller test fixture and duplicate `selection_unresolved` field. Adapted the query boundary without weakening runtime validation or using casts to hide Supabase incompatibility.
- Applied Biome formatting to affected patch files only. Did not change provider logic, cancellation economics or price-guarantee rules.

## Evidence

- `/private/tmp/savings-phase1-red.log`: stale-route regression failed before fix.
- `/private/tmp/savings-phase1-rows-red.log`: invalid-variant fallback regression failed before fix.
- `/private/tmp/savings-phase1-modal-red.log`: unresolved auto-debit correction regression failed before fix.
- `/private/tmp/savings-phase1-mobile-final.log`: 22 focused suites, 144 tests passed.
- `/private/tmp/savings-phase1-modal-green.log`: 7 modal tests passed, including new regression.
- `/private/tmp/savings-phase1-web-final.log`: 3 backend suites, 17 tests passed after the query-boundary correction. Earlier swap-device route coverage also passed; counts overlap and must not be added together.
- Full-workspace lint/typecheck passed at a preceding checkpoint; latest reruns are `/private/tmp/savings-phase1-lint-completion.log` and `/private/tmp/savings-phase1-typecheck-completion.log`. Verify final exit status before reporting latest-patch success.
- Full suite is logged at `/private/tmp/savings-phase1-full-tests.log`. It began before later fixes; even a passing result is not an immutable latest-patch verdict. Latest affected tests must be rerun after final edits.
- CodeRabbit completed with seven findings in `/private/tmp/savings-phase1-review.log`. It reviewed an earlier snapshot; this is not a clean final review. Two behavioral findings were independently reproduced and repaired (invalid fallback and unresolved auto-debit correction).

## Remaining review and acceptance work

### Follow-up checkpoint

- API device resolution now selects and preserves `is_inventory_anchor` through schema parsing, ignores anchors when requiring a customer variant, and rejects explicitly selected anchor IDs. Two synthetic regressions failed before the fix; four backend suites (25 tests) passed afterward (`/private/tmp/savings-anchor-red.log`, `/private/tmp/savings-anchor-green.log`). Mobile wallet projection and database safeguards still need corresponding review; this is not an end-to-end closure of the anchor finding.

- Mobile worker completed loading, empty, blank-search, preselected, missing-product and disabled-option coverage: two suites, nine tests passed. Coordinator corrected formatting in the suggestions test afterward.
- RPC status classification now maps the exact unavailable saved-payment-method error to 409, retains the known variant error as 404, and leaves unknown unavailable failures as 500. Two new regressions failed before the fix; all seven route-helper tests then passed (`/private/tmp/savings-status-red.log`, `/private/tmp/savings-status-green.log`).
- Full-suite run finished: web had seven failing files (including two suite-load failures), nine failed tests and 33,388 passed tests. Failures are in database-history replay and cost/evidence tooling; baseline causality is not yet proven. This is not a green full-suite verdict.
- Backend reviewer flagged internal inventory-anchor selection, direct-RPC price/snapshot bypass and completed legacy-goal recovery/redemption inconsistency. These remain release blockers pending independently verified corrections.
- A Terra worker is preparing append-only database corrections and synthetic behavioral tests, with no permission to apply migrations, access a remote database or edit existing migrations. Its output requires coordinator review; no database fix or SQL execution is claimed yet.

- The proposed migration test checks catalog existence only. Add behavioral SQL cases for valid/invalid variants, merchant/product mismatch, no-variant products and legacy unrelated updates, and execute only on a verified isolated local database. No running Docker database was listed during inspection; no remote fallback was attempted. Do not edit the existing proposed migration without owner approval under repository protected-file rules; new corrections must be append-only.
- Resolve the discrepancy between disabled out-of-stock variant buttons and route/search selection. Do not blindly turn inventory into a new savings eligibility policy: the owner can source devices later. Determine the existing intended eligibility model and enforce it consistently with tests.
- Audit colour/condition labels: existing formatters omit colour, and options may otherwise be indistinguishable. Confirm actual catalogue dimensions and preserve the exact selected variant through display and purchase.
- Expand loading/empty/disabled-option component coverage identified by CodeRabbit.
- Narrow overly broad `not_available` RPC error classification after a reproducing test.
- Validate legacy unresolved-goal correction through the complete UI/API path, not just modal rendering. Verify no route callback reintroduces the manual-only restriction.
- Rerun affected tests, lint/typecheck and final exact-patch review; record full-suite failures separately. Do not bypass guards or discard unrelated work.

## Safety and next phase

All work remains uncommitted. Nothing was pushed, deployed, sent as a partner message, provisioned as a secret, or applied to a remote database. The proposed migration is not applied. Automated review was requested; no clean-review or production-readiness claim is made.

Do not start PiggyVest activation until this savings patch is reviewed and the original integration gates are satisfied. The next step is finishing the remaining Phase 1 acceptance work, not deploying this checkpoint.
