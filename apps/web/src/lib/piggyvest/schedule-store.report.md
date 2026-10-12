# Durable local schedule proposals — implementation verified

Hooke accepted the corrected source with no additional P1/P2 findings; the final
local PostgreSQL expiry/restart harness passed. SQL 165000/165100 is now frozen
for parent review. This is not live scheduling.

## Implemented connection

`createAuthenticatedScheduleStore` resolves the actual authenticated policy
context first, using the existing Supabase ownership/allowlist resolver. It
revalidates that exact actor/context before each SQL operation and again before
returning data. The caller supplies only an operation ID and strict planner
command, never authoritative balances, owner selection, actor, source token or
stored proposal. This is an internal authenticated boundary, not a user route.
A future HTTP route must also enforce CSRF and bounded request parsing.

`createScheduleStore` reads the real locked source and current metadata, invokes
the existing `planPiggyvestScheduleLifecycle`, and submits the resulting proposal
with an optimistic token/version. SQL independently revalidates/reconstructs the
permitted state and exact consent fields before committing state plus immutable
command receipt atomically. Thus a client-supplied proposal never becomes SQL
authority, even if the restricted function is called directly.

The result proves a **persisted proposal**, not a bank/card mandate, enabled
provider schedule or collection permission. Receipts contain `persisted: true`,
`dispatch: disabled`, `debitPermission: false`. They retain the original
`resume_proposed`/`consentProposal` naming. No planner `persisted: false` output
is mislabelled as a durable acknowledgement.

## Exact state and token contracts

Read parameters: integration, merchant, customer, goal, business, current actor,
optional operation UUID. SQL returns:

- `trusted`: server-owned local environment, exact scope/actor, enabled gate's
  collection owner, accepted policy revision/hash, real internal ledger snapshot,
  persisted activation/duration-derived maturity dates and DB-clock `now`.
  `policy.activationQuote` carries the existing immutable accepted quote's ID,
  exact device, amount and expiry; its presence does not imply activation.
- `state`: latest proposal/version, or version-zero default. Existing financial
  reservation/settlement history gives a stopped default even when no schedule
  row existed before cancellation. This does not claim the goal is cancelled.
- `token`: MD5 of canonical DB JSON for `trusted` **before** insertion of `now`,
  plus immutable accepted `quoteExpiresAt`. This is a staleness checksum, not a
  signature, credential or ownership proof. SQL rebuilds it under locks; scope,
  actor, version, exact command and proposal checks are independent.
- `historical`: nullable exact command plus its immutable receipt, scoped to
  goal and current actor. Historical success does not override current state.

Write parameters share the first six read parameters. Parameter seven is a
strict object with `operationId`, `command`, `token`, `proposal`. Pause/observe
commands have action/goalId/expectedVersion. Resume also has operationId,
accepted=true, revisionId and termsHash. Each committed command advances version
once, including an unchanged observation. Version overflow fails closed.

SQL checks exact command keys, scope, current actor, accepted revision/hash,
current ownership gate, source token and version. It reconstructs the expected
proposal under locks, including reservation, reversal, readiness, owner and
maturity/grace blockers. Resume crossing quote expiry or maturity between read
and commit is rejected using the fresh database clock. It never trusts a
client-projected readiness result. The source uses the accepted exact-device
quote, not an invented live catalogue offer; authoritative live pricing remains
a separate connection before collection can be enabled.

Post-expiry observe independently reconstructs paused/null consent in SQL and
commits that invalidation. A fresh resume is rejected. If a pre-expiry proposal
arrives after expiry, rollback leaves its version unchanged, allowing a new safe
observe to invalidate it. Historical replay remains available but never restores
current consent or grants debit permission.

## Locks, invalidation and replay

Reads and writes reuse `piggyvest_goal_policy.read/lock_scope`: registry share,
ledger binding update, policy binding/customer share, goal update. The schedule
gate is read under share lock; schedule metadata is written last. Existing
ledger apply already holds the same financial scope lock before inserting its
operation. The new AFTER INSERT trigger touches only `piggyvest_schedule.states`
at the end of that order. It never calls back into financial scope locks.

Every new ledger operation increments any existing schedule metadata version
and clears its proposal consent. Reservation/settlement operations retain a
stopped proposal; other credits pause it. A late contribution on a stopped
proposal does not reopen it. An exact ledger replay inserts no operation and
does not invoke the trigger a second time. Trigger execution rolls back together
with a failed ledger transaction. There are no financial/Paystack writes in the
trigger, no network calls, due claims or scheduler activation.

Temporary purchase reservations are conservatively treated as stopped scheduling
proposals, matching the existing planner. This is not a permanent customer-goal
state transition or a claim that purchase/cancellation completed. An explicit
recovery/restart policy is required before relaxing that conservative boundary.

Exact operation replay checks current actor and goal scope, then returns the
stored command's original receipt without changing state, even if a later credit
revoked that proposal. A mismatched command for the same operation is rejected.
SQL historical receipts and current state are both available via readback.

Response loss or post-write authentication change produces `unconfirmed`, never
a successful acknowledgement. The caller retains the same operation ID and
reads back; there is no automatic write retry. A fresh authenticated store
instance can reconstruct the original receipt after process/database restart.

## Files and registration

New source/schema/test files:

- `apps/web/src/lib/piggyvest/schedule-store.ts`
- `apps/web/src/lib/piggyvest/schedule-store-authenticated.ts`
- `apps/web/src/lib/piggyvest/schedule-store-statements.ts`
- Their three colocated `.test.ts` files
- `apps/web/src/lib/piggyvest/schedule-store.runtime-support.ts`
- `apps/web/src/lib/piggyvest/schedule-store.runtime.test.ts`
- `apps/web/src/lib/piggyvest/schedule-store.expiry.runtime.test.ts`
- `apps/web/src/lib/piggyvest/schedule-lifecycle.expiry.test.ts`
- `apps/web/src/schemas/piggyvest-schedule-store.ts` and `.test.ts`
- `tools/test/schedule-store-local.test.sh`
- `tools/test/schedule-store-fixture.sql`
- `tools/test/schedule-store-expiry-fixture.sql`
- `tools/test/schedule-store-assert.sql`
- `tools/test/schedule-store-rejections.sql`

New SQL and current SHA-256:

| Migration | SHA-256 |
| --- | --- |
| `supabase/migrations/20260912165000_schedule_proposal_storage.sql` | `e47b30078e23e9f0e5ce42397df16b3aef186c4c0cab2cc21b9cbe084caa56ce` |
| `supabase/migrations/20260912165100_schedule_proposal_commit.sql` | `3149aa40018c69a888e627f80ff5d73680ff83c5c1304e8839076075eddf882f` |

Parent registered exactly `readScheduleProposal` and `writeScheduleProposal`,
seven parameters each, policy-writer role only. No global catalog or manifest was
edited by this task. Migrations create default-disabled gates and revoke public,
authenticated and service-role access. There are no migration-time runtime
grants; the disposable fixture supplies explicit restricted test grants.
SQL additionally requires socket-only `piggyvest_local` and the exact policy
writer login. Tables have deny-all RLS and no writer DML access; receipts are
immutable. Existing migrations, Paystack, environment and proxy are unchanged.

## Validation and regression evidence

- Initial test-first adapter RED: passthrough stub made zero SQL calls instead
  of the required read+write. Same test GREEN after connection, preserving
  unconfirmed state on a simulated lost committed response.
- Trigger mutation RED: test-only removal of the invalidation trigger in the
  disposable database makes the unchanged post-credit state assertion fail
  (exit 1). Restored normal harness GREEN.
- Exact SQL reconstruction RED: cancellation before any schedule row initially
  returned a paused default. Added assertion failed at rejections SQL line 21
  (exit 3); consulting locked reservation history changed it to stopped and
  the identical assertion passed. No claim that the prior version could debit.
- Final local harness: **4 pre-expiry/connected tests passed**, three skipped;
  **1 post-expiry test passed**, two skipped; after PostgreSQL restart
  **2 read-only recovery tests passed**, five skipped. Real restricted executor, actual authenticated binder,
  real SQL; Supabase identity is explicitly synthetic, not a real login.
- **8 synchronized, observed PostgreSQL lock waits**: ledger/write in both
  orders, cancellation/write in both orders, resume/pause in both orders and
  ownership revocation/write in both orders. Wrong actor cannot read after
  revocation; stale writes lose. Revocation fixtures are synthetic only.
- SQL tests reject forged token, actor, consent, scope and proposal; explicit
  rollback leaves no receipt; historical replay cannot reinstate revoked state.
  Late principal remains 150 kobo with 7 paid-interest kobo after a 100-kobo
  cancellation reservation; metadata remains stopped. No debit/fee/settlement
  or legacy contribution operation is created.
- Expiry P2 RED: real pre-expiry resume persisted version 1, then post-expiry
  observe returned unconfirmed instead of durable paused version 2 (exit 1).
  Exact-boundary planner tests also retained resume consent in both draft and
  active states (2 failures). Restored GREEN proves paused/null consent at
  now == expiry; SQL clock-driven expiry invalidation, rejected delayed proposal,
  fresh resume rejection, exact historical replay and separate current/history
  reads after restart all pass. The test-only accepted snapshot expires after
  30 seconds; the harness waits against its actual PostgreSQL deadline, without
  altering immutable snapshots or using a fake runtime clock.
- New store plus existing planner/schema suites: **33 tests passed** across
  eight suites. Scoped Biome passed. No runtime/schema/test exceeds 300 lines.
- Earlier root lint failed on concurrent unowned `runtime-composition*` formatting.
  Root typecheck failed on unowned shared `piggyvest-cancellation-client.ts:69`
  (possibly undefined goalId); parent delegated that correction. These failures
  are not bypassed or represented as a clean root gate. Full monorepo tests
  were not run by this task.
- A subsequent direct web `pnpm exec tsc --noEmit` reported only unowned
  `cancellation-client-http.integration.test.ts:166` (union narrowing) and
  `purchase-pricing.ts:77` (possibly undefined actor). No owned file diagnostic
  was emitted; this is still a failed web-wide check, not a passing type gate.
- Final fresh `pnpm turbo lint` passed (existing warnings, including cached mobile warnings), and
  `pnpm turbo typecheck` passed. Earlier failures above are historical, not current
  blockers. Full monorepo tests remain parent-owned and were not run here.

Commands:

```sh
bash tools/test/schedule-store-local.test.sh
PIGGYVEST_SCHEDULE_TEST_DISABLE_INVALIDATION=1 bash tools/test/schedule-store-local.test.sh
```

The second command is an explicit negative mutation test and must fail. Both
use disposable socket-only PostgreSQL, existing synthetic setup/seed helpers,
strict local executor configuration and automatic cleanup. Nothing is deployed.

## Remaining external and integration gates

Durable local metadata and authenticated scope binding are now implemented, not
provider blockers. External collection remains disabled pending a verified
funding bridge/one-owner handover, appropriate mandate/amount consent, provider
cadence/timezone/in-flight cancellation/retry/reference semantics and separately
approved synthetic provider operations. A documented funded-wallet schedule is
not a bank/card mandate. No withdrawal/interest/fee rules are inferred.

No authenticated HTTP route, browser/native scheduling ceremony, cron worker or
due-claim mechanism is enabled here. No rollout grants or manifest activation
occurred. Future packaging/route consent and current pricing integration remain
local work; provider terms block only their affected external money operations.
