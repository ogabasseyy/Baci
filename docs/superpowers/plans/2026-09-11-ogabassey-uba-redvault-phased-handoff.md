# Ogabassey REDVAULT — Terra Implementation and Review Handoff

## Authority and working model

Feature specification: [Ogabassey UBA REDVAULT implementation plan](2026-09-11-ogabassey-uba-redvault.md). This handoff defines execution order and review gates; the feature specification defines behavior. Latest owner corrections always prevail.

The owner requests phased Terra implementation with the parent assistant reviewing each phase. Use `gpt-5.6-terra` implementers. The parent assistant owns acceptance and cannot accept a phase solely on the implementer's summary. No phase auto-advances past a review gate.

Use one backend implementer at a time for Phases 1–3. After the backend contract is approved, web and mobile may run in parallel with disjoint ownership. Use fresh agents for new phases and the same implementer for fixes within its phase. Do not create user-visible Codex tasks merely to run internal subtasks.

The execution boundary is local implementation, local test fixtures and review. No production/database access, remote migration application, real payments, emails, deployment, pushes, merges or commits are authorized by this handoff. Authenticated provider sandbox operations need explicit authorization; mock provider tests and public documentation research do not. The feature remains disabled pending commercial and provider release conditions.

## Non-negotiable requirements for every worker

- Ogabassey-specific opportunity: other merchants cannot enable or invoke it.
- Website, iOS and Android are all included.
- Owner-confirmed tiers: 10% below ₦200,000 eligible pre-discount merchandise subtotal, 5% at or above it. Only products permitted by shared `isProductNegotiable` count toward the threshold or receive the discount. Non-negotiable brands, Samsung A series and all fees are EXCLUDED.
- Reuse the existing discount system, with a protected partnership/payment constraint. Do not create a parallel generic campaign platform or introduce a campaign budget.
- Customers enter card details only in Paystack hosted checkout; no Baci PAN, CVV, PIN or OTP collection.
- UBA already accepted this journey subject to testing. Investigate actual provider gaps; do not reopen approval of an unchanged journey.
- Preserve ordinary discount, negotiation and payment behavior. Respect current AGENTS.md files, RLS, protected-file restrictions and append-only migrations.
- Do not silently choose commercial defaults for stacking, mixed payments, caps, usage or campaign dates. Implement explicit configuration/disabled-state validation and use clearly synthetic test settings where needed.

## Review gate protocol

1. Parent records the workspace, baseline HEAD, dirty/untracked files and exact phase write scope before dispatch.
2. Terra implements only that phase, runs its focused tests plus required lint/typecheck, self-reviews and returns a phase evidence report. It then stops.
3. Parent reviews the actual diff including untracked files, traces security-sensitive call sites, inspects migrations and tests, and runs targeted checks where needed. Parent reviews both specification compliance and code quality.
4. Parent records `CHANGES_REQUESTED`, `ACCEPTED` or `BLOCKED` with precise findings. Terra fixes actionable findings in the same scope and returns new evidence; parent rechecks changed code and affected behavior.
5. Only parent `ACCEPTED` unlocks dependent phases. Test-environment failures must be reported, not described as passing. Do not waive unresolved payment, tenant-isolation, amount or idempotency defects.
6. Update the progress table with the reviewed artifact identity. Because commits are not authorized, use HEAD plus a SHA-256 manifest of changed/new file contents and the exact diff/report; HEAD alone does not identify an uncommitted phase. Any later change invalidates acceptance for affected behavior until re-reviewed.

Reports belong in `docs/superpowers/plans/uba-redvault-evidence/phase-N.md` when execution starts. Include scope, changed files, interfaces produced, commands/results, failing-before/passing-after evidence, migration validation method, known blockers and a statement that prohibited operations were not performed. The parent, not the implementer, records acceptance.

## Phase 0 — Workspace and contract freeze

**Owner:** one Terra preflight worker; parent approves the contract. **Dependencies:** none. **Write scope:** evidence/contract documentation only; no feature implementation.

- Inspect the current branch-attached implementation workspace and active changes. The planning workspace was detached at `d0d1cbd2fd4b5867a980644acf5e29fd7c451c0c`; it is not a verified current implementation branch. Record the chosen baseline without resetting, checking out or overwriting another worker's changes. Branch creation requires owner authorization.
- Ensure the master plan and this untracked handoff actually exist in the implementer's workspace. A fresh worktree does not automatically contain uncommitted planning files.
- Map the discount/order/payment RPCs, existing proof provisioning, guest authentication, direct RPC reachability, side-effect finalizers and actual web/mobile entrypoints.
- Freeze the concrete shared types and API additions: payment choice, eligibility/discount summary, amount units, attempt identity, order version, payment hold state and response/error handling. Freeze the new proof payload/action/version, nonce replay semantics, persisted line identity, migration order and restricted worker permissions.
- Explicitly include product subtotal, eligible subtotal, tax treatment, shipping/assurance treatment and final payable total in contract fixtures. Reuse the repo's current payment request shape where possible; a new discriminator must be validated and its authority derived server-side, never accepted as proof of entitlement.
- Establish how Ogabassey's immutable merchant identity is verified without adding user-facing service-role access. Document any protected-file change needed instead of silently editing it.
- Specify a consistent lock order, redemption uniqueness key, quote/attempt validity behavior and persisted initialization state needed by later phases. Commercial values remain unresolved rather than invented.
- Check installed test tooling and local database availability; do not install dependencies or run remote services merely to complete preflight.

**Acceptance:** parent can give each implementer exact interfaces, file ownership and test commands; security boundaries and local test environment are known. A contract defect or unavailable required tooling is recorded before dependent work starts.

## Phase 1 — Shared eligibility, calculation and refund allocations

**Owner:** one Terra implementation worker. **Dependencies:** Phase 0 accepted. **Write scope:** approved shared modules, pure calculation helpers and colocated tests; no API routes, payment handlers or migrations.

- Reuse the shared negotiation policy; add REDVAULT-specific composition without duplicating the exclusion list or changing ordinary negotiation behavior.
- Implement authoritative-input calculation contracts, canonical line grouping with complete identity/pricing/tax fields, tier-selected half-up kobo rounding and stable original-item allocations.
- Implement refund allocation helpers so partial returns sum to the original net amount.
- Cover excluded brands, Samsung A versus S/Z, mixed/all-excluded baskets, variants/condition/tax differences, duplicate-line splitting, malformed numeric inputs and rounding boundaries.

**Parent gate:** independently check the 100,000 eligible + 50,000 excluded example gives exactly 5,000 discount; confirm no delivery-charge discount, tax-policy drift, duplicate brand policy or frontend authority. Approve the exported contract before Phase 2.

## Phase 2 — Protected discount persistence and database proof

**Owner:** one Terra backend worker. **Dependencies:** Phase 1 accepted. **Write scope:** discount schemas and server proof helpers, order-discount integration, additive migrations and database tests. No hosted-payment integration or UI changes.

- Reuse discount records while preventing ordinary APIs/RPCs from assigning/removing the protected partnership restriction.
- Add `storefront_redvault_discount` proof version 1 with all frozen bindings and replay protection. Preserve legacy negotiation action/version behavior.
- Add protected order creation/validation that checks signed authoritative line allocations, actual order-item binding and exact eligible subtotal rather than discounting the full basket.
- Persist pending REDVAULT discount applications without counting usage at order creation. Define the atomic approval/redemption operation and unique constraints that Phase 3 will call.
- Enforce Ogabassey identity, authenticated/authorized guest ownership and least-privilege RPC grants. Validate locally with a disposable database where available; never apply to production.

**Parent gate:** inspect SQL privileges and concurrency; attempt synthetic direct-RPC forgery, cross-merchant access, proof substitution/replay and over-discount. Verify ordinary discounts remain compatible. Missing executable database evidence prevents treating database behavior as verified.

## Phase 3 — Payment initialization, completion and recovery

**Owner:** one Terra backend worker. **Dependencies:** Phase 2 accepted. **Write scope:** payment initialization/verification/webhook integration, shared finalizer/reconciliation/refund paths and their tests; any further SQL change returns through the database review gate.

- Persist/reuse attempt identity before provider initialization and use server-selected card-only UBA restrictions and required brands. Test provider requests through mocks.
- Bind server totals, proof/application and order version to the attempt; prevent generic/manual-code and alternate-gateway bypasses.
- Implement response-loss reconciliation, superseded-attempt handling and protected completion across every existing completion/fallback path.
- Validate raw webhook signatures and provider results, then atomically approve/redemption-count once. Record captured-but-held money without fulfilment or spendable credit.
- Preserve idempotent notifications, reconciliation and refunds; add the operational disable behavior without disabling recovery for earlier attempts.
- Record provider-verification evidence still needed. Do not invent an undocumented Paystack eligibility field or claim mocked restrictions prove provider enforcement.

**Parent gate:** trace all ways an order becomes paid or a settlement credit is created; verify none bypass the partnership gate. Review duplicate, wrong-amount/currency, other-merchant, stale-session and late-capture tests. Freeze the UI-facing contract before Phase 4.

Collision ownership: `apps/web/src/app/api/orders/route.ts` passes from the Phase 2 owner to the Phase 3 owner only after acceptance. Phase 3 exclusively owns `apps/web/src/app/api/payments/initialize/route.ts`, `apps/web/src/lib/payments/finalize-order-gateway-payment.ts` and the related recovery integration. Extract focused REDVAULT modules when touching oversized files; never run competing backend edits in these seams.

## Phase 4 — Website and mobile integration

**Dependencies:** Phase 3 accepted. **Parallelism:** optional two Terra workers with no shared writes.

**4A web owner:** Ogabassey website checkout components/hooks and their tests only. Add Pay with UBA, server-priced line/total display, mixed-basket explanation, hosted redirect, method switching and pending/error/cancel states.

**4B mobile owner:** `apps/mobile-storefront` checkout/payment components/hooks, app-owned order request schemas/payload builders and their tests only. Implement the same behavior for iOS and Android using existing hosted-checkout and platform primitives. Treat redirects/WebView messages only as verification triggers.

Neither worker edits shared packages, backend APIs or migrations. Proposed contract changes return to the parent/backend owner before implementation. Serialize edits if the chosen execution tool cannot guarantee disjoint ownership; do not let agents race over shared lockfiles or configuration.

**Parent gates:** independently accept web and mobile diffs, verify both use server results rather than calculating authoritative discounts, and inspect app/browser callback handling. Both must pass before Phase 5.

## Phase 5 — Integration, regression and release evidence

**Owner:** one Terra integration worker; parent performs final whole-change review. **Dependencies:** Phases 4A and 4B accepted.

- Run the complete master-plan matrix on the assembled change, including ordinary checkout regressions, database concurrency, payment recovery and all three client surfaces.
- Run required `pnpm turbo lint`, `pnpm turbo typecheck`, `pnpm turbo test` and CodeRabbit review. Distinguish pre-existing failures and unavailable tooling from passing evidence; do not fix unrelated issues.
- Produce a final changed-file manifest, test results, migration rollout/rollback considerations, unresolved commercial/provider checklist and an unsent UBA results-report draft.
- Keep provider sandbox execution separate unless authorized. Never substitute fabricated cards or mock results for actual provider coverage evidence.

**Parent gate:** review the aggregate change, interactions across phases and all unresolved findings. Final status distinguishes `IMPLEMENTATION_REVIEWED` from `RELEASE_READY`; neither implies deployed, migrated, tested with real payments or reported to UBA.

## Initial progress ledger

Handoff preparation: Terra agent Singer (`01a091e4-c306-7991-93e9-c8c74d4b7e46`) performed a read-only phase-boundary review. Parent incorporated its backend collision and mobile payload ownership recommendations. No feature code was changed by that review; Phase 0's full contract/workspace deliverable remains unstarted.

| Phase | Status | Parent review |
| --- | --- | --- |
| 0 Contract/workspace preflight | NOT_STARTED | Pending execution contract and baseline |
| 1 Shared calculation | LOCKED | Requires Phase 0 |
| 2 Database and discount persistence | LOCKED | Requires Phase 1 |
| 3 Payment backend | LOCKED | Requires Phase 2 |
| 4A Web | LOCKED | Requires Phase 3 |
| 4B iOS/Android | LOCKED | Requires Phase 3 |
| 5 Integration and final review | LOCKED | Requires 4A and 4B |

## Copyable Terra dispatch instruction

Read the master REDVAULT plan and this phased handoff. Execute only Phase <assigned phase>, whose dependencies the parent has explicitly accepted. Follow current AGENTS.md instructions. Work only in the assigned workspace/write scope and preserve other changes. Add meaningful colocated regression tests and run the required checks. Do not invent unresolved commercial terms or extend the scope. Do not commit, push, merge, deploy, access production, apply remote migrations, send messages or run real payments. Return the phase report with exact changed paths and test outcomes, then stop for parent review. Do not begin the next phase or claim parent acceptance yourself.
