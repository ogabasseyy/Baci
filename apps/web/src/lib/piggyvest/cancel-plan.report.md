# Cancellation preparation — READY FOR PARENT REVIEW

## 602 snapshot preservation — final handoff

Leibniz relay completed: added `tools/test/cancel-plan-customer-runtime-fixture.sql` and `cancel-plan-customer-runtime-assert.sql`; the local runner now seeds separate goals `30000000-0000-4000-8000-000000000201` (success/replay) and `30000000-0000-4000-8000-000000000202` (stale quote), revisions `70000000-0000-4000-8000-000000000201/202`, with the existing merchant/customer/actor and reviewed `synthetic-v1` / 64 `a` hash. Each has 100 principal, 7 paid and 3 pending interest. Standard policy_writer retains only quote/prepare grants after seeding; goal 101 is not reused. Invocation is `PIGGYVEST_RUN_CUSTOMER_CANCEL_RUNTIME=1 PIGGYVEST_LOCAL_TEST_SOCKET="$test_root/socket" pnpm exec vitest run src/lib/piggyvest/customer-cancel-flow.integration.test.tsx --maxWorkers=1`, port 55446. Post-SQL requires exactly one success intent/reservation, no stale-goal reservation, unchanged interest, preserved principal and no terminal operations. Latest run reached this connected invocation after all existing SQL/adapter checks passed; it stopped on Leibniz's not-yet-present `customer-cancel-flow.test-support` import. No edits made to Leibniz's files. This relay supersedes the earlier instruction below that no connected invocation had been added.

Verified production migration `20260521130000_customer_wallet_dva_and_device_savings_tables.sql:265` installs `customer_savings_goals_updated_at` BEFORE UPDATE; baseline `20260418000000_baseline.sql:6989` defines its unconditional `NEW.updated_at = now()` behavior. Frozen 601 redundantly updated an already-required-paused goal, invalidating the immutable policy snapshot timestamp.

RED reproduced using that production-like trigger: prepare succeeded, then SQL quote failed with `goal policy revision stale`. New append-only `20260912160200_cancel_plan_preserve_goal_snapshot.sql` removes only the redundant public-goal UPDATE from the 601 prepare implementation. Already-paused isolation remains checked under the same goal lock; all reservation, reviewed-consent, scope and replay checks are preserved. No trigger disablement, timestamp restoration, adapter changes or new financial capabilities.

Final migration SHA256:

- 600 unchanged: `b1b702dc20b46cb2e4f5e9ad18debc42a4dc6d773f9587918f0664497d6a64ad`
- 601 unchanged: `470bee8c38a647a1ca09cc41badabafc10bfdd6a3f549e8bee510ccb2b6b4171`
- 602: `9922d854a2bfa7b3706b9a715d6631aa215a3296bc6b4758c225c0d19a750470` (71 lines)

Only five files changed for this batch:

- New `supabase/migrations/20260912160200_cancel_plan_preserve_goal_snapshot.sql`
- New `tools/test/cancel-plan-updated-at.test.sql`
- `tools/test/cancel-plan-local.test.sh` loads 602 and the trigger regression
- `apps/web/src/lib/piggyvest/cancel-plan-runtime.integration.test.ts` verifies the committed policy remains readable through the actual executor with the one existing reservation
- This report

GREEN: `bash tools/test/cancel-plan-local.test.sh` passes the 28 isolation mutations, five lock-observed races, rollback/restart checks, new trigger/unchanged-timestamp/idempotency SQL regression, and actual standard-role executor integration test (1 passed). Parent has now registered the catalog; the earlier catalog-blocked result below is historical and resolved. Scoped Biome on the one changed TS test passes. No full application/infrastructure checks or provider execution claimed.

### Leibniz fixture/script handoff

602 work is complete; I will make no further fixture/script edits. Leibniz can now coordinate the connected handler test's invocation against `tools/test/cancel-plan-local.test.sh`; existing fixture files were not modified in this batch. The script creates a disposable Unix-socket-only PostgreSQL cluster at `/tmp/baci-piggyvest-runtime.*/socket`, database `piggyvest_local`, port 55446, and sets `PIGGYVEST_RUN_CANCEL_PLAN_RUNTIME=1` plus `PIGGYVEST_LOCAL_TEST_SOCKET` for the existing adapter test. It currently runs only `src/lib/piggyvest/cancel-plan-runtime.integration.test.ts` and then checks one persisted intent/reservation for goal suffix 101.

`cancel-plan-runtime-fixture.sql` seeds goal 101 with matching standard `piggyvest_staging_policy_writer` bindings, synthetic accepted/reviewed terms, 100 principal/7 paid/3 pending interest. The existing adapter test consumes that goal's reservation. Use a distinct goal/operation fixture for the NEW handler integration test, or a separate disposable run; do not reuse goal 101 expecting no reservation. The production-like updated_at trigger remains installed after the SQL regression rolls back, so the actual executor test runs with the trigger active. No new opt-in invocation for Leibniz's not-yet-known test path has been guessed.

Direct agent handoff tooling did not expose a Leibniz destination in the available thread inventory; this explicit local ownership release and invocation contract are ready for parent/Leibniz to consume.

## 601 isolation correction and restricted-executor handoff

Frozen 600 was not edited. New `20260912160100_cancel_plan_legacy_isolation.sql` replaces the two entry points without renaming them or introducing callable bypass wrappers. Both acquire the existing shared registry/binding/customer/goal locks and invoke a new private `assert_isolated(uuid)` guard before quote or preparation/replay proceeds. It requires paused/manual, exactly zero legacy current/initial amounts, no legacy contributions of any status, and no completed/cancelled/spent timestamp. Null/missing source or amounts fail closed. Existing internal ledger funding remains allowed; `assert_unfunded` is deliberately not used. Freshness rejection preserves existing reservations.

SHA256:

- `20260912160000_cancel_plan_preparation.sql`: `b1b702dc20b46cb2e4f5e9ad18debc42a4dc6d773f9587918f0664497d6a64ad` (identical before/after correction)
- `20260912160100_cancel_plan_legacy_isolation.sql`: `470bee8c38a647a1ca09cc41badabafc10bfdd6a3f549e8bee510ccb2b6b4171`

RED: with 600 alone, new isolation test observed both quote and preparation accepting goal 6 with `current_amount=1`. GREEN: 601 rejects 28 mixed-state mutations against both quote and prepare/replay (56 rejection assertions), while valid internally funded goal 6 prepares and goal 1 replays. Coverage includes current/initial amounts, active status, auto_debit/null source, null amounts, terminal timestamps and pending/completed/cancelled/failed legacy contributions. Five observed-lock races pass, including concurrent legacy amount mutation and legacy contribution insertion. Rollback, restart and preserved-interest checks continue passing. The harness runs frozen 600 baseline cases first, then applies 601 before isolation, races and adapter integration.

New statement constants: `CANCEL_PLAN_STATEMENTS` in `cancel-plan-statements.ts`; adapter now references constants rather than inline SQL. Parent owns importing/spreading this object into `postgres-statements.ts` and catalog/allowed-role tests. Exact additions:

```ts
quoteCancelPlan: {
  text: 'SELECT piggyvest_cancel_plan.quote($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid) AS result',
  parameters: 6,
  roles: ['piggyvest_staging_policy_writer'],
}
prepareCancelPlan: {
  text: 'SELECT piggyvest_cancel_plan.prepare($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb) AS result',
  parameters: 6,
  roles: ['piggyvest_staging_policy_writer'],
}
```

Never register/grant `assert_isolated`. No role widening or financial dispatch additions are needed. Invalid adapter configuration now throws only `Cancellation preparation unavailable` (regression red then green).

Additional files this correction: `cancel-plan-statements.ts`, its colocated test, `cancel-plan-runtime.integration.test.ts`, `tools/test/cancel-plan-isolation.test.sql`, `tools/test/cancel-plan-runtime-fixture.sql`, and migration 601. Changed owned files: adapter, adapter test, local test shell and this report. No pre-existing SQL file, registry or common executor was edited.

Latest focused result: 21 tests pass across adapter/constants/schema/pure-policy suites; scoped Biome passes five touched TS files. Local SQL portion of `bash tools/test/cancel-plan-local.test.sh` passes. Its new real-adapter test currently FAILS because parent catalog registration is still absent: standard executor rejects the unregistered quote and adapter returns unavailable. This is not a passing runtime integration claim. The test uses actual `createCancelPlan -> createPiggyvestPostgresExecutor -> pg`, no catalog/pg mocks, standard `piggyvest_staging_policy_writer`, both matching bindings, private Unix socket and synthetic-only credentials. Temporary fixture stage/credit grants are revoked before adapter execution, leaving only quote/prepare function grants and no table/helper access. Parent registration followed by rerunning that command is the remaining local runtime gate.

Earlier implementation details/results below describe the original 600 batch; the 601 restrictions and current runtime-test limitation above supersede its broader active/paused acceptance and integration status.

## Delivered, not activated

Durable local-only cancellation confirmation preparation uses the existing canonical ledger reservation. There is no parallel balance ledger, provider refund, forfeiture posting, settlement, release, deployed route, or active dispatch. Existing policy/lifecycle/shared modules and executor/statement registries are unchanged.

## Exact callable API

`createCancelPlan({ configuration, execute })` exports:

- `quote()`: `quote_available` with `revisionId`, `termsVersion`, `termsHash`, `consentVersion`, integer internal `principalKobo`, `paidInterestKobo`, `pendingInterestKobo`, `interestDisposition: 'unresolved'`, `dispatch: 'contract_gap'`; or `requires_policy_specific_handling`; or `unavailable`.
- `prepare(confirmation)`: matching immutable `prepared` receipt containing `operationId`, `collectionPaused: true`, `dispatch: 'contract_gap'`, `interestDisposition: 'unresolved'`. Error/unknown response returns `unavailable`, `reservation: 'may_be_retained'`, `dispatch: 'contract_gap'`.
- `dispatch()`: always `{status:'contract_gap', reason:'provider_cancellation_mechanism_unverified'}`; no executor/network call.

Configuration is strict `{environment:'staging', transport:'local_test', integrationId, merchantId, customerId, goalId, expectedBusinessId, actorId}`. UUID identities and actor are server-owned, never browser-authoritative. Executor signature is `(statement: string, parameters: readonly string[]) => Promise<{rows: unknown}>`. This is an internal dedicated-writer adapter, not an authenticated customer HTTP endpoint; parent must supply the authenticated server scope.

Confirmation is strict `{operationId, actorId, revisionId, termsVersion, termsHash, consentVersion:'2026-09-11', accepted:true, principalKobo, paidInterestKobo, pendingInterestKobo}`. Generate one operation UUID for the confirmation and preserve the exact command on retries, including when the response is lost. Actor must equal configured server actor. All money values are internal safe integer kobo, not guessed provider units.

The pure quote reuses `evaluateSavingsPolicy`; only cancellation disclosure values are projected. Stored device/quote fields satisfy that evaluator's input contract and are not advertised as a current price, activation, guarantee or purchasing entitlement. Paid/pending interest labels are neutral disclosures; no claim that interest was forfeited/cancelled.

## Transaction and reviewed consent gate

New private schema `piggyvest_cancel_plan` provides `quote(uuid,uuid,uuid,uuid,text,uuid)` and `prepare(uuid,uuid,uuid,uuid,text,jsonb)`.

Lock ordering reuses policy `lock_scope`: enabled registry, ledger binding, policy binding, customer and goal. The dedicated session login must match BOTH existing policy and ledger bindings. DB checks the actor against current customer ownership and immutable accepted policy receipt. No admin/service client is constructed.

`reviewed_policies` has exact terms-version/SHA256 mapping plus cancellation consent version. It defaults disabled, has no migration seeds or public grants, and allows only enabled-state updates. Owner review must establish that the actual mapped document covers the cancellation policy. Neither a generic receipt nor an arbitrary synthetic version implies all-interest consent. Missing/disabled mapping rejects preparation and leaves principal untouched; quote reports policy-specific handling. Synthetic test mappings are not business approval.

Under the same locks, SQL compares all three disclosed amounts and the revision/terms against live ledger/policy data; existing reservations or funding reversal reject. It atomically calls existing ledger `reserve_refund` for principal only, inserts immutable confirmation intent, and changes the local goal status to paused. The historical ledger command name does NOT dispatch or prove a refund. Interest postings remain unchanged. Exact replay returns the same preparation receipt; competing commands reject. All release/settlement/interest disposition paths are absent.

Local collection pause does not prove provider debit cancellation or prevent already-in-flight credits. Generic ledger terminal APIs are not exposed by this adapter. Real provider execution and resulting evidence remain unresolved.

## Files

- `apps/web/src/lib/piggyvest/cancel-plan.ts` (111 runtime lines)
- `apps/web/src/lib/piggyvest/cancel-plan.test.ts`
- `apps/web/src/lib/piggyvest/cancel-plan.report.md`
- `apps/web/src/schemas/cancel-plan.ts` (55 runtime lines)
- `apps/web/src/schemas/cancel-plan.test.ts`
- `supabase/migrations/20260912160000_cancel_plan_preparation.sql` (new append-only migration)
- `tools/test/cancel-plan-fixture.sql`
- `tools/test/cancel-plan-cases.sql`
- `tools/test/cancel-plan-local.test.sh`

## Verification

From worktree root: `bash tools/test/cancel-plan-local.test.sh` passes using disposable PostgreSQL 18 over an isolated Unix socket, TCP disabled. Applies actual ledger/policy/new preparation migrations; no remote database or credentials. Tests stale amount/consent/actor rejection, missing and default-disabled reviewed mapping, exact replay, changed replay rejection, atomic rollback of reservation+intent+pause, retained interest, denied API-role grants, replay/reservation after restart, and three two-session races with observed PostgreSQL lock waits: cancel wins purchase, purchase wins cancel, duplicate cancel records once.

From `apps/web`:

```sh
pnpm exec vitest run src/lib/piggyvest/cancel-plan.test.ts src/schemas/cancel-plan.test.ts src/lib/piggyvest/savings-policy.test.ts
pnpm exec biome check src/lib/piggyvest/cancel-plan.ts src/lib/piggyvest/cancel-plan.test.ts src/schemas/cancel-plan.ts src/schemas/cancel-plan.test.ts
```

20 scoped tests passed (6 new adapter/schema tests plus existing pure-policy tests); Biome passed all four owned TS files. TDD red runs preceded both SQL and TS implementation. The generic-consent regression specifically failed against the first SQL implementation and passed after introducing the reviewed mapping gate.

## Parent coordination / limitations

No registry/common executor edits were made. Parent must review/register the two exact parameterized statements in `cancel-plan.ts`, arrange matching restricted login bindings if appropriate, and review actual cancellation terms before any configuration/grants. Current policy writer and ledger writer bindings can differ; this deliberately fails closed rather than inventing authority or bypassing a binding.

Zero-principal preparation is unavailable because the existing shared reservation requires positive principal. Legacy/unmapped policies need policy-specific handling; no alternative interest disposition or entitlement is inferred. There is no connection to the concurrently added lifecycle module. No whole integration, production SQL compatibility, root checks/typecheck, provider behavior or customer authentication ceremony is claimed; parent owns those subsequent gates.
