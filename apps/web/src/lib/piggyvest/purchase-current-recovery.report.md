# READY FOR PARENT REVIEW — registered purchase current recovery

171000 remains frozen. After Fermat completed the parent-owned exact catalog, three registries and planner-prefix registration, both actual integration commands below passed with the real standard executor/catalog. No catalog substitute, provider or external operation occurred.

## Final registered integration checkpoint

- `PIGGYVEST_RUN_PURCHASE_CURRENT_RECOVERY=1 PIGGYVEST_RUN_PURCHASE_CURRENT_RECOVERY_EXECUTOR=1 bash tools/test/purchase-pricing-local.sh`: **exit 0**, `/tmp/purchase-current-recovery-registered.log`. Direct SQL/ACL/current-original actor checks, both observed credit/read lock orders and PostgreSQL restart pass; **four registered standard-executor/actual HTTP tests pass**, plus the five existing pricing-executor tests.
- `PIGGYVEST_RUN_CUSTOMER_PURCHASE_HTTP=1 bash tools/test/purchase-pricing-local.sh`: **exit 0**, `/tmp/purchase-http-recovery-regression.log`. **Three purchase/lifecycle HTTP cases before restart and one recovery case after restart pass**, plus the same five pricing-executor tests. Complementary phase skips are intentional, not untested scenarios.
- Exact historical receipt and prepare replay remain unchanged; current reservation/balance evidence adds no financial authority. The two disposable clusters/listeners and all owned test processes closed normally. No runtime or SQL correction was needed after registration.
- Prior focused evidence remains 36 passing tests, scoped Biome clean and direct web TypeScript pass. Hooke's independent review was reported closed by parent with no P1/P2 and 19 passing focused tests; that is separate reviewer evidence.

## Frozen artifact and exact catalog request

Migration: `supabase/migrations/20260912171000_purchase_current_recovery.sql`

SHA-256: `f5893cd714494113e66ebff4ed134870228452d08b3238faa5e77e29c4b6555d`

New metadata export: `PURCHASE_CURRENT_RECOVERY_STATEMENTS` in `apps/web/src/lib/piggyvest/purchase-current-recovery-statements.ts`; key `purchaseCurrentRecovery`, seven parameters, only `piggyvest_staging_policy_writer`:

```sql
SELECT piggyvest_purchase_preparation.read_current_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result
```

Parameters: integration, merchant, customer, fixed goal, expected business, server-authenticated actor, original operation. No actor7/8 policy-binder assumption. Parent owns catalog/manifest and grants review. Migration seeds no grants or enabled capabilities, creates no tables and changes no existing function. Existing frozen 164000/164100/164200 hashes remain unchanged.

## Behavior and interface

Existing `/purchase/status?goalId=...&operationId=...` adds `current` to the unchanged immutable preparation receipt. Prepare and exact-command replay are unchanged; historical `surplusKobo` remains historical, not replaced with current funds. No new route/options or UI edit.

`current` contains:

- `observedAt`: database UTC timestamp; point-in-time evidence only.
- `evidence: internal_ledger_only`, `fundsUse: not_authorized`, `retry: not_authorized`.
- Either `status: observed`, `reservation: retained`, and `balances: {unreservedPrincipalKobo, unreservedPaidInterestKobo, pendingInterestKobo}`;
- Or `status: requires_reconciliation`, `reservation: unknown`, `balances: null`.

No spendability, withdrawal, paid-order, provider cash, finality, interest entitlement, release or retry permission follows. Pending interest is never added to principal/paid buckets. Missing/malformed read evidence returns generic unavailable/may-be-retained; it never falls back to cached historical success.

The SQL uses the existing registry/ledger-binding/policy/customer/goal lock ordering and existing ledger snapshot. It verifies current and original actor, exact operation scope, original reservation postings, active reservation, references, funding reversals and bounded numeric totals. Resolution/reversal/mismatch produces review, not a new financial state. No fresh quote/maturity check blocks historical recovery. The function writes no ledger, intent, goal or balance data.

## Verified now

From `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

```sh
PIGGYVEST_RUN_PURCHASE_CURRENT_RECOVERY=1 bash tools/test/purchase-pricing-local.sh
```

GREEN exit 0: `/tmp/purchase-current-recovery-sql-final.log`. Existing direct pricing assertions/five existing pricing-executor cases run first. **New recovery evidence is direct SQL**, proving:

- Identical historical receipt and retained 95000 principal/2000 paid-interest reservation; original surplus 1000.
- Later principal 500 is fully preserved; pending 300 remains separate; unreserved paid interest remains 1000.
- Reversal/resolution fixtures require review, leave history untouched, and are rolled back. No recovery financial writes.
- Wrong operation/goal/actor, changed current owner, public role and a separately granted wrong login are denied.
- Two observed lock waits: read-before-credit sees 500; credit-before-read sees the complete committed 700 after two additional 100 credits. Reservation stays unchanged.
- PostgreSQL restart preserves 700 principal/1000 paid/300 pending evidence. The owned temporary cluster and child processes clean up on exit.

The initial test fixture lacked schema USAGE for its public-role rejection helper; adding only fixture helper access corrected it. Runtime authorization was not relaxed.

The handler regression was observed RED (503 instead of expected projected 200) before connecting the new adapter, then GREEN. Final focused run: **36 tests across six files pass**. Scoped Biome: **11 files clean**. Direct web TypeScript passed, log `/tmp/purchase-current-recovery-tsc.log`. Shell syntax checks pass. New runtime/schema files remain under 300 lines. No running owned processes remain at handoff.

## Registered command

```sh
PIGGYVEST_RUN_PURCHASE_CURRENT_RECOVERY=1 PIGGYVEST_RUN_PURCHASE_CURRENT_RECOVERY_EXECUTOR=1 bash tools/test/purchase-pricing-local.sh
```

This runs `purchase-current-recovery-runtime.integration.test.ts`: real catalog presence, real standard restricted executor, role/actor/scope denial, actual listener/CSRF/status after restart, exact historical receipt and no ledger writes. It imports the real catalog, never clones/injects authorization metadata and never mocks node-pg. **All four cases passed after registration.**

The prior full purchase/lifecycle HTTP command also applies 171000 plus explicit local fixture grant now, since status consumes the new operation. Its exact replay assertion excludes only additive `current`; all historical fields remain identical. This rerun also passed:

```sh
PIGGYVEST_RUN_CUSTOMER_PURCHASE_HTTP=1 bash tools/test/purchase-pricing-local.sh
```

## Owned files / boundaries

New `purchase-current-recovery.ts`, statements, synthetic fixture, colocated adapter/schema/statement tests, handler regression and opt-in integration test; new `schemas/purchase-current-recovery.ts`; migration171000; `tools/test/purchase-current-recovery-cases.sql` and `purchase-current-recovery-race.sh`. Narrow existing edits: customer purchase status, owned pricing harness/HTTP fixture and exact replay assertion. No router, UI, global catalog/manifest, existing migration or incoming-reconciliation172000 edit.

Real provider classification/settlement/compensation and incoming evidence verification remain separate gates. Leibniz owns incoming reconciliation. This observation neither creates nor classifies incoming credits and cannot authorize financial dispatch.
