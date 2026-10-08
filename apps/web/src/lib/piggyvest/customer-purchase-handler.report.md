# READY FOR PARENT REVIEW — purchase/lifecycle HTTP connections

Local synthetic evidence only. No provider operations, customer data, order/payment/settlement/release calls, SQL edits, deployment or production authentication claim.

## Runnable connected verification

From `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

```sh
PIGGYVEST_RUN_CUSTOMER_PURCHASE_HTTP=1 bash tools/test/purchase-pricing-local.sh
```

GREEN exit 0, log `/tmp/customer-purchase-http-green.log`: existing direct SQL assertions/source-change matrix and five actual pricing/driver tests pass; three actual HTTP/PG tests pass before restart, one recovery test passes after PostgreSQL restart. The complementary restart-phase cases are deliberately skipped, not missing coverage. Disposable Unix-socket PG18 cluster is removed on exit. This script never connects to provider or remote databases.

- Actual loopback listener/router -> authenticated synthetic session -> actual session-bound CSRF bootstrap and forwarded Set-Cookie -> new handlers -> RLS-scoped PostgreSQL reads -> existing pricing/preparation/lifecycle stores -> registered restricted node-pg executor -> frozen SQL.
- Purchase publishes actual catalogue variant, merchant-owned pickup, explicit VAT and reviewed fee policy. Customer confirms exact quote. Injected response loss occurs **after the real preparation commits**. Status and exact-command replay return the same retained history after catalogue price changes. A new command cannot use that old authority. Exactly one intent remains; restart preserves it; no settlement/release exists.
- Lifecycle prepares selected duration 1, reads actual terms text/revision/duration, rejects acceptance missing duration, accepts exact duration before synthetic funding. Persisted quote is **100001 kobo**: `ceil(100001 / 20) = 5001`. Confirmed principal 5000 is denied; adding exactly 1 activates the immutable guarantee with collection paused/no collection consent. Same activation command replays the same receipt. No first-funding dependency on activation is introduced.
- Separate consented quote expires on database clock; activation fails without an activation record. Test-only waits are at most three one-second waits in the disposable database, within the existing query timeout. No runtime wait or SQL migration change.

An earlier fixture run failed because goal 211 was already occupied; the new test uses 241–243. The next run exposed the test's single wait exceeding its two-second query bound; bounded one-second waits fixed the fixture, not financial rules. Both failed clusters were cleaned up.

## Exact router interface

Both factories accept `{supabase, goalId, configuration: context, execute, checkCsrfProtection}`; Fermat owns actual router registration/service flags.

| Factory/module | Method/path | Strict input |
| --- | --- | --- |
| `createPiggyvestCustomerPurchaseHandler` / `customer-purchase-handler.ts` | `quote` POST `/purchase/quote` | goalId, quoteId, shippingRateId, savingsKobo, fulfilmentMode: pickup |
| Same | `prepare` POST `/purchase/prepare` | goalId, operationId, accepted: true, exact existing purchase quote, fulfilmentMode: pickup |
| Same | `status` GET `/purchase/status` | exactly goalId + operationId query |
| `createPiggyvestCustomerLifecycleHandler` / `customer-lifecycle-handler.ts` | `terms` POST `/lifecycle/terms` | goalId, revisionId, durationMonths integer 1–6 |
| Same | `activate` POST `/lifecycle/activate` | goalId, revisionId, operationId |

Duration preparation does not record acceptance. Existing `/policy` GET/POST performs exact versioned SHA-matched terms acceptance. There is no generic lifecycle GET. Activation replay uses the same identifiers. Unknown outcomes are indeterminate, not rollback, refund or renewed permission.

## Owned changes and boundaries

- New shared web-local `customer-operation-handler.ts` supplies getUser-first auth, canonical fixed-goal validation, exact RLS scope/actor revalidation, shared 4KiB/64-chunk/two-second body reader, CSRF, executor deadline, abort checks and redacted no-store responses. Exact statement/parameters are checked by each operation; no generic caller-selected RPC.
- New purchase/lifecycle handlers and corresponding `schemas/piggyvest-customer-{purchase,lifecycle}-handler.ts`, all with colocated tests. Runtime modules remain below 300 lines.
- Narrow parent-approved optional executor injection in existing `goal-lifecycle.ts` / `goal-lifecycle-terms.ts`. Existing database-config callers unchanged; injected path separately validates enabled/local_test/scope/command and reuses the same statements/result validation. Default/injected/disabled tests cover both paths. The activation injection test was observed RED before implementation, then GREEN.
- Owned integration helpers reuse the former pricing RLS fixture rather than a second catalogue/quote mock: `purchase-pricing-runtime.fixture.ts`, `customer-purchase-http.fixture.ts`, `customer-purchase-http.integration.test.ts`, `tools/test/customer-purchase-http-fixture.sql`, opt-in bridge in `tools/test/purchase-pricing-local.sh`.
- Scoped Biome: 18 files clean; 66 scoped tests across 10 files pass. Direct web TypeScript passed once during integration; the final concurrent rerun reports only `runtime-composition.ts(50,28)` TS18048 (`supabase` possibly undefined) in Fermat's subsequently changed router. Sent to Fermat; no owned errors. Log `/tmp/customer-purchase-http-tsc-ready.log`. Do not infer a current root typecheck pass.

## Remaining gates

This connects the callable local backend, not real login, customer UI, authoritative draft-quote issuance, carrier delivery or live acceptance. Existing policy drafts/approved fee capabilities and initial funding are explicit synthetic fixtures in this ceremony. Real provider dispatch, settlement, split-leg finality/fees, interest attribution and compensation remain disabled pending contracts/approval. New purchase at maturity remains review-required; no grace-period forfeiture or loss of guarantee rights is inferred. Parent owns router acceptance, global manifests and broader test gates.

Frozen migrations 150000/150100/150200 and 164000/164100/164200 were read only; no migration or catalogue additions are required by these handlers.
