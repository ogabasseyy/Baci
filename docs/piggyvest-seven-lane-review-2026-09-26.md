# Seven-lane PiggyVest implementation review

User request: assign one Terra/Luna agent to each of the seven integration gaps, review their work, and report the outcome.

## Scope and execution rules

The findings and intended outcome are in `docs/piggyvest-integration-gap-audit-2026-09-26.md`. Implementation is limited to established contracts and local, tested changes. Missing financial policy, provider settlement evidence, or wallet ownership must remain explicit blockers, not guessed configuration. No production changes, provider mutations, card charges, real fund movements, credential changes, VPS changes, or lease extension are part of this pass.

The worktrees contain substantial pre-existing changes. Every implementation agent must preserve a pre-edit copy of existing files, use disjoint write ownership, and report its exact patch and tests. No commits, branches, resets, stashes, dependency updates, existing-migration edits, or proxy/environment edits are authorized. The parent owns shared replay wiring and combined validation.

## Assignments

| Lane | Owner/model | Write boundary | Status |
| --- | --- | --- | --- |
| 1 Interest receipts to Earnings | Euclid / Terra | New replay-interest assessment/tests; no shared dispatcher edits | Reviewed; assessment only, bridge outstanding |
| 2 Prefunded card contributions | Hooke / Terra | New advisory state classifier/schemas/tests; no charging or ledger edits | Reviewed and typecheck corrected by parent; durable bridge outstanding |
| 3 Outgoing finality/TSQ | Leibniz / Terra | New terminal correlation and read-only TSQ adapters/tests | Reviewed; live normalizer, writer, and wiring outstanding |
| 4 Purchase/cancellation | Aquinas / Terra | Existing preparation reviewed; execution design | Reviewed; design only |
| 5 Existing-customer recovery | Goodall / Luna | Provisioning client/coordinator and tests | Reviewed; unowned-customer refusal fixed locally |
| 6 Whole-wallet interest policy | Pasteur / Luna | Policy/readiness design only | Reviewed and corrected by parent |
| 7 Phone push registration | Einstein / Luna, parent completion | Mobile registration hooks/tests; no manufactured token or permission bypass | Retry integration corrected locally; native staging capability outstanding |

All seven agents were dispatched: four Terra and three Luna. Six ran concurrently; lane 7 started after lane 6 released a slot. No Astra subagent was used.

## Parent verification

- Shared replay baselines copied to `/private/tmp/baci-seven-lanes-parent-baseline` before any parent edits.
- Existing replay regression baseline and both worktrees' lint/typecheck commands started separately. A failing pre-existing gate is recorded, not repaired outside scope.
- Each returned patch must pass a spec/authority review and a code review before shared integration. Tests prove local behavior only; mocked provider success cannot certify settlement or phone delivery.
- Financial flows requiring a new architecture or unresolved provider contract receive an implementation-ready design and exact acceptance gates instead of unsafe runtime activation.
- Baseline: receiver replay regression tests 27/27 pass; receiver-tree typecheck passes, lint has 20 existing errors. Savings-tree lint/typecheck fail before integration, including the existing savings submission fixture missing goal-idempotency fields. Logs are under `/private/tmp/baci-seven-lanes-*`.

## Reviewed deliverables and actual remaining work

### 1. Interest receipts to Earnings — assessed, not connected

`apps/web/tools/piggyvest-staging/replay-interest-dispatch.ts` is a side-effect-free preparatory assessment. It checks customer, accrued-interest source, payout destination, eligibility, and gross-minus-tax arithmetic. It always returns deferred: it is not a payout dispatcher or a credit operation. Parent required support for a nullable corroborating destination and clarified that economic deduplication must not depend on transport event ID.

The new `replay-interest-bridge-contract.md` identifies the restricted atomic bridge still needed. The existing worker's mapping/dispatch remains unchanged. A payout-table row alone still does not reach canonical Earnings. Currency/business scope can come from independently verified receipt provenance or authenticated reconciliation; they must not be invented from missing event fields. The approved allocation and actual nonzero provider payout remain unproven.

### 2. Prefunded cards — advisory boundary, not a funding implementation

Savings tree: `apps/web/src/lib/piggyvest/prefunded-card-contribution-gate.ts` plus the matching schema and tests classify trusted operation snapshots. Parent rejected the first version's claim-only completion and required a fully correlated canonical projection, explicit failed collection, zero-fee staging enforcement, and reconciliation for a collected payment whose reservation is unavailable.

No durable treasury/capacity reservation, charge worker, provider-transfer worker, or canonical projection was added. The helper cannot certify exactly-once behavior or authorize callers' arbitrary evidence. Card controls remain unchanged. The integration and crash/concurrency tests in the lane-2 handoff are still to implement.

### 3. Outgoing finality — validated adapter contracts, not a live reconciler

Receiver tree: `replay-outflow-terminal.ts`, `transfer-reconciliation.ts`, `transfer-reconciliation-status.ts`, and their schemas/tests. Parent required customer/business/integration and economic-field comparisons, runtime validation, opposite-terminal conflict handling, and a full-identity atomic compare-and-set interface instead of the old reference-only writer.

The current adapters have no real identity normalizer, scoped SQL writer, or replay entry-point wiring. TSQ performs a bounded read and deliberately leaves incomplete terminal evidence unresolved; no scheduler or database atomicity was tested. Ordinary HTTP 202 acceptance is not a provider blocker. Genuine terminal evidence and implementing the documented async lifecycle are distinct remaining tasks.

### 4. Purchase/cancellation — existing safe behavior retained

Savings tree: `docs/piggyvest-purchase-cancellation-execution-lane4-2026-09-26.md`. Existing preparation handlers passed their focused tests; no handler changed. Parent corrected the design to distinguish normal asynchronous transfer implementation from genuinely undecided economics. No special PiggyVest cancellation endpoint is required to implement a refund using documented transfers.

Remaining product decisions: treatment of purchase shortfall (`otherPaymentKobo`) and fulfilment, refund destination/amount, and paid/pending interest plus fee disposition. Preparation still does not fulfil an order or return funds.

### 5. Existing customer — safer immediate error, not automatic adoption

Savings tree: `provisioning-client.ts` now distinguishes a valid `new_customer:false` response whose ownership is not established. `customer-plan-funding-ensure.ts` returns `unavailable / PROVIDER_UNAVAILABLE` immediately, without creating a wallet, recovering, or accepting response identities. This is a real customer-facing source change. The ownership rule and no-resend behavior remain intact.

The specific result is not persisted as a new durable status, so this does not solve all retry UX. Safe tenant-scoped adoption/recovery of an existing provider customer remains outstanding; the first response must not be described as completed account recovery. Parent extracted the existing test data into `provisioning-client.fixture.ts` to keep the touched test below 300 lines.

### 6. Whole-wallet interest — design, not changed economics

Savings tree: `docs/piggyvest-interest-allocation-design-2026-09-26.md`. It separates ordinary principal, plan principal, pending accrual, customer-eligible paid interest, and business interest. Parent clarified target-versus-current state and removed unnecessary requests for provider confirmation where bounded tests can establish the facts.

The provider's global split is already confirmed. Per-wallet accrual/destination fields are not per-wallet split percentages. No rates, allocations, provider flags, or ordinary-wallet balances changed. Product allocation, payout evidence, and migration/reconciliation remain required.

### 7. Phone notifications — retry hardening and a newly identified staging blocker

Savings tree: mobile registration lifecycle and regression coverage were revised under parent review. The first attempt added a parallel retry while the old automatic save could still race; parent required one scoped in-flight boundary and stale-response rejection across logout/user/merchant changes. The agent's larger revision still failed regression tests, so the parent stopped that agent and completed the changes directly rather than accepting its completion claim.

The final hooks keep cached registration keyed by user, merchant, and token; share automatic/foreground saves; honor isolation, OS permission and opt-out; and discard stale responses. Parent tests exposed and fixed a null merchant-override crash on logout and covered late token acquisition without a stuck loading state. Parent removed an unreviewed native token-refresh expansion. Existing response/deep-link tests remain in the validation set. New source hooks are below 300 lines.

Parent also found a separate source blocker: `services/push-notifications.ts` suppresses fresh native token creation when `isStorefrontTelemetryExcluded()` is true, including hosted staging. `hosted-storefront-runtime.ts` additionally rejects an EAS project ID in its sanitized profile. Expo token endpoints and the authenticated `register_push_token` RPC are already allowlisted; another gateway route is not the missing piece. Granting permission alone does not overcome these source guards. A separately isolated native push configuration and real device/token/delivery verification remain outstanding; telemetry isolation was not weakened.

## Deployment and completion boundary

These are local patches and reviewed contracts across two existing dirty worktrees. No shared replay entry point, migration, provider setting, deployment, VPS service, lease, customer balance, or production environment changed. Seven reviewed assignments is not seven completed live features. The next implementation phase must build the restricted durable adapters and consolidate/deploy an exact artifact set, then exercise real staging settlement and phone delivery.

## Final validation

- Receiver tree: 60 tests across eight replay/interest/outflow suites pass. All ten changed/new code/test files pass focused Biome; isolated replay-tools TypeScript passes. Whole-tree typecheck passes. Whole-tree lint still has the original 20 unrelated errors and four warnings; no new-file lint failures remain.
- Savings web: 92 tests across eight provisioning, prefunded-card schema/gate, purchase, and cancellation suites pass. All nine changed/new web code/test/fixture files pass focused Biome. Web typecheck passes after parent corrected a transfer-result union narrowing error caught by the independent typecheck.
- Mobile: 47 tests across six registration/lifecycle/response suites pass, including the parent-added logout regression that failed before the null-override fix. All nine touched/new mobile code/test files pass focused Biome without warnings. Native refresh and phone delivery are not included in that claim.
- Savings whole-tree lint still fails on unrelated pre-existing files; none of the touched push files appears in the final diagnostics. Whole-tree typecheck reports only the two original mobile fixture failures: `components/ui/format-date-time-display.test.ts:26` (readonly tuple typing) and `components/wallet/savings/run-savings-goal-submission.idempotency.test.ts:33` (missing goal-idempotency fields). No new TypeScript errors remain. Unrelated failures were not changed.
- Total focused verification: **199 passing tests** across 22 suites (60 receiver, 92 savings web, 47 mobile). Final logs: `/private/tmp/baci-seven-lanes-replay-final.log`, `/private/tmp/baci-seven-lanes-cursor-web-final.log`, `/private/tmp/baci-seven-lanes-mobile-final.log`; whole-tree logs use the `baci-seven-lanes-*-final.log` prefix.
- These checks use local fixtures/mocks. No genuine provider payout, card collection/transfer, refund, SQL compare-and-set race, native token acquisition, or phone delivery was performed in this pass. No whole-repository test-pass or release-readiness claim is made.

## Next implementation priorities

1. Implement the restricted durable transfer/receipt adapters and canonical ledger bridge, including business-scoped bindings and disposable-database concurrency/restart tests. The current pure helpers are not those adapters.
2. Finish prefunded reservation/collection/transfer/projection orchestration against that same durable state. Keep card controls disabled until complete; do not fork the accounting into another ledger.
3. Establish the isolated native staging push profile and test device delivery. Permission alone cannot bypass the current hosted capability guard.
4. Settle the explicit purchase/refund and interest allocation decisions, then wire their execution. In parallel, obtain a nonzero staging interest configuration and genuine accelerated payout evidence from PiggyVest if its public API cannot produce one.
5. Consolidate an exact artifact/migration/runtime manifest, deploy staging separately, and verify the actual bank/card/interest/exit journey. Most of this remaining work is our integration and validation, not another request for already-documented provider endpoints.
