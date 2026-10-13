# READY FOR PARENT REVIEW — local scheduling proposal planner

## Scope and evidence

Read `AGENTS.md`, `docs/piggyvest-goal-execution.md`, the connected implementation
report, contract register and original product/staging plans referenced by the
goal document before editing. Original plans are absent from this checkout and
were read at their explicitly documented original paths; all implementation is
in `/Users/mac/Baci-worktrees/cursor-savings-phase1`.

Inspected `customer-savings-auto-debit-schedule.ts` and the existing Paystack
collection processor. Its daily/weekly/monthly periods and money transport are
not reinterpreted as PiggyVest contracts. Existing Paystack files are unchanged.

New files only:

- `apps/web/src/lib/piggyvest/schedule-lifecycle.ts`
- `apps/web/src/lib/piggyvest/schedule-lifecycle.test.ts`
- `apps/web/src/lib/piggyvest/schedule-lifecycle.transitions.test.ts`
- `apps/web/src/lib/piggyvest/schedule-lifecycle.test-support.ts`
- `apps/web/src/schemas/piggyvest-schedule-lifecycle.ts`
- `apps/web/src/schemas/piggyvest-schedule-lifecycle.test.ts`
- This report.

## Contract

`planPiggyvestScheduleLifecycle(unknown)` is server-only, synchronous and pure.
Its trusted snapshot and previous local state must match integration, merchant,
customer and goal. Commands assert the exact goal and expected local version.
Resume proposals additionally require `accepted: true`, operation ID and exact
current revision/hash. Prior proposals are invalidated on actor/revision/hash
replacement. These are internal consistency assertions with synthetic tests,
not authentication or a replacement for an authenticated ownership binder.

The result is explicitly `stateProposal`, with `consentProposal` only in
`resume_proposed`, and `persisted: false`. It is not a stored consent, durable
acknowledgement or permission to debit. `collectionPaused: true` describes this
disabled proposal path; it does not claim to pause an existing Paystack debit.
Every output has `dispatch: disabled` and `due: cadence_contract_unresolved`.

Existing `evaluateSavingsPolicy` decides readiness, grace expiry, reversal and
reservation constraints. The planner maps those decisions into paused/review/
stopped proposals. Resume needs a fresh explicit command after readiness pause;
observing offer expiry or a late credit never resumes collection. A stopped
proposal is not reopened, including after a failed cancellation/recovery.
`none`/Paystack ownership cannot propose a PiggyVest resume. No ownership
handover is performed.

Maturity is a constant-time comparison against supplied authoritative lifecycle
timestamps: before maturity, grace, then review required at grace expiry. The
grace timestamp must match the policy snapshot. Calendar-month/date derivation
stays with the existing persisted lifecycle. At maturity, automatic collection
remains blocked pending its explicit policy. There is no recurrence calculation,
catch-up loop, due claim, retry, fee, ledger mutation or collection restart.

## Tests

Test-first RED: the initial passthrough stub failed the exact resume proposal
assertion plus four cancellation/purchase pending/terminal late-credit cases
(5 failed). This proves missing new planner behavior, not a pre-existing
production transport bug. The same assertions are GREEN after implementation.

New scoped suites: **23 passed** across planner, transitions and schema tests.
Expanded scoped run: **57 passed** across seven suites, including all three
existing savings-policy suites and `customer-savings-auto-debit-schedule.test.ts`.
Cases include exact protected-offer expiry, explicit pause, maturity/grace
boundaries, cancellation plus late credit, no unilateral restart, actor/scope/
revision/hash mismatches, version overflow, owner exclusion and input purity.
No duplicate due-claim test is claimed: no claim implementation exists.

Commands (from `apps/web`):

```sh
pnpm exec vitest run src/lib/piggyvest/schedule-lifecycle.test.ts src/lib/piggyvest/schedule-lifecycle.transitions.test.ts src/schemas/piggyvest-schedule-lifecycle.test.ts src/lib/piggyvest/savings-policy.test.ts src/lib/piggyvest/savings-policy.transitions.test.ts src/lib/piggyvest/savings-policy.reservation.test.ts src/lib/customer-savings-auto-debit-schedule.test.ts --maxWorkers=1
pnpm exec biome check src/lib/piggyvest/schedule-lifecycle* src/schemas/piggyvest-schedule-lifecycle*
```

Scoped Biome passed. Root `pnpm turbo typecheck` passed (6 tasks).
Root `pnpm turbo lint` failed on concurrent unowned mobile cancellation binding/
screen-test formatting and import ordering; these files were not changed.
Full monorepo tests were not run. Every new runtime/schema/test file is under
300 lines. No provider call or local database operation was used.

## Remaining contracts and integration

- Parent catalog registrations: **none**. No SQL, executor statement or endpoint
  was added; there is no persistence or scheduler to register.
- Authenticated binder must derive actor/tenant/goal, read current accepted
  terms/lifecycle and collection ownership, and revalidate under the same
  transaction/lock as any future consent write. The local version is not a
  database compare-and-swap receipt or durable replay fence.
- Define the actual collection-to-plan funding bridge and single-owner handover
  before enabling a second scheduling path. A Paystack success is not another
  PiggyVest deposit.
- Confirm cadence/timezone/amount authorization, maturity collection policy,
  pause/resume semantics, in-flight recovery and provider idempotency before
  implementing dispatch or durable due claims. No withdrawal rules are inferred.
- Cancellation/refund, late-credit accounting and expiry disposition remain in
  their existing ledger/policy boundaries. This planner neither posts credits
  nor resolves fee/refund/interest contracts.

No live behavior, durable scheduling consent, actual reservation, refund,
provider collection, cron enablement, deployment or certification is claimed.
