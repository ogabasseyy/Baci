# Goal policy persistence foundation — parent review

## Scope and activation limitation

Private immutable initial policy snapshot and consent receipt storage only. No activation, public grants, provider calls, financial effects, interest eligibility, withdrawal/refund execution, or production migration application. Tables have deny-all RLS; policy bindings and registered terms default disabled. The SQL acceptance actor must match the currently linked customer.user_id while the customer row is locked. Caller authentication/acceptance ceremony must still be established by a future trusted writer; supplying an actor UUID is not authentication.

`assert_unfunded` proves only the locked local prerequisite: zero legacy current/initial amount, no legacy contribution of any status, no internal ledger operation, and no terminal legacy goal state. Empty local history DOES NOT prove absence of external/provider inflow, unreconciled funds, or removed historical records. Customer activation remains blocked until a reviewed authenticated acceptance writer and provider reconciliation can establish before-funding chronology. No legacy metadata or acceptance timestamps are promoted.

The writer must obtain an authoritative integer-kobo quote; this store does not issue or authenticate quotes independently. Explicit quote ID/amount/expiry are separate from legacy target/snapshot price. Only lifecycle `draft`, collectionPaused `true`, and guarantee `null` are supported. Non-null guarantees are rejected rather than invented. This is initial-only persistence: no policy replacement, revision supersession, lifecycle transitions, or balance reads. Any changed stored goal revision/snapshot invalidates reads; future revision handling needs a separate reviewed contract.

## Stable interface

Factory: `createGoalPolicyStore({ configuration, execute })`; methods `stage(command)`, `accept({ revisionId, actorId })`, `read()`. Configuration requires staging plus integrationId, merchantId, customerId, goalId, expectedBusinessId. All inputs/results validated; errors redacted; no automatic retry on ambiguous storage failures.

Exact catalog statements are exported by `goal-policy-store-statements.ts`. Stage/accept/read arities remain 6/7/5 and exclusive role remains `piggyvest_staging_policy_writer`. First five parameters are integration UUID, merchant UUID, customer UUID, goal UUID, expected business string. Stage adds JSON-encoded command string; acceptance adds revision UUID and actor UUID. Read adds nothing. No boolean/object executor arguments.

Stage command requires exactly revisionId, expectedGoalUpdatedAt, productId, variantId (explicit nullable), termsVersion, termsHash, quoteId, quoteKobo, quoteExpiresAt, guarantee (null), lifecycle (draft), collectionPaused (true). Device presentation is copied from the same locked exact-variant goal snapshot, not independently supplied labels.

Parent owns catalog/config integration, manifest registration and any future grant review. No migrations provision the writer role or grant execution. Harness-only roles/grants are synthetic. Parent's local_test-only driver restriction is compatible. Do not expose these functions to authenticated/service_role or wire customer activation.

## Append-only correction

140000–140200 were not edited after registration. New `20260912140300_goal_policy_canonical_commands.sql` adds absolute timezone-qualified timestamp validation at stage and persisted read/accept boundaries. Historical relative timestamps fail closed, not reinterpreted. UUID-valued command fields are canonicalized for comparisons/read responses; existing immutable uppercase commands remain physically untouched and can replay canonically. TypeScript normalizes UUID inputs/results too. API signatures are unchanged.

SHA-256:

```
63fc591f97a3231c050a4bd96fc13c77b5758c132767377ad29b6d0c6ba5305a  20260912140000_goal_policy_tables.sql
dad8166518420742779e0a1bbca93bdaabdf127fc0bfe06bba4afabb18c27e66  20260912140100_goal_policy_scope.sql
adddc167467f9282925c381a91cd4a4884cb985349c0c1ce5e2b158399f8d9f4  20260912140200_goal_policy_api.sql
0f9536df0216ebd26a75be9c0ad1b53c8d1f9ddb0eac1d1baff6e42147c0a24c  20260912140300_goal_policy_canonical_commands.sql
```

## Owned file list

- supabase/migrations/20260912140000_goal_policy_tables.sql
- supabase/migrations/20260912140100_goal_policy_scope.sql
- supabase/migrations/20260912140200_goal_policy_api.sql
- supabase/migrations/20260912140300_goal_policy_canonical_commands.sql
- apps/web/src/lib/piggyvest/goal-policy-store.ts
- apps/web/src/lib/piggyvest/goal-policy-store.test.ts
- apps/web/src/lib/piggyvest/goal-policy-store-statements.ts
- apps/web/src/lib/piggyvest/goal-policy-store-statements.test.ts
- apps/web/src/lib/piggyvest/goal-policy-store.report.md
- apps/web/src/schemas/piggyvest-goal-policy.ts
- apps/web/src/schemas/piggyvest-goal-policy.test.ts
- tools/test/goal-policy-setup.sql
- tools/test/goal-policy-fixture.sql
- tools/test/goal-policy-cases.sql
- tools/test/goal-policy-boundary.sql
- tools/test/goal-policy-local.sh

## Verification commands and regression evidence

```
pnpm exec biome check apps/web/src/lib/piggyvest/goal-policy-store*.ts apps/web/src/schemas/piggyvest-goal-policy*.ts
pnpm --filter @baci/web exec vitest run src/lib/piggyvest/goal-policy-store.test.ts src/lib/piggyvest/goal-policy-store-statements.test.ts src/schemas/piggyvest-goal-policy.test.ts --maxWorkers=1
bash tools/test/goal-policy-local.sh
```

TDD evidence: initial store stub failed five behavioral tests; uppercase UUID regression failed with `Goal policy storage unavailable` before normalization. Direct SQL relative-expiry regression failed with `expected failure 22023` before 140300. SQL boundary fixtures also cover timezone-less timestamps, uppercase initial/replay/accept/read and immutable pre-correction uppercase replay, plus rejection of pre-correction relative-expiry rows. Harness uses a fresh disposable Unix-socket PostgreSQL 18 cluster, no remote connection; teardown removes only its private temporary directory.

Final local run, 2026-09-12, exit 0:

```
Biome: Checked 6 files in 55ms. No fixes applied.
Test Files  3 passed (3)
Tests       12 passed (12)
Duration    20.83s
PASS scoped stage/consent/idempotency/old revision/permissions
PASS funded/history/disabled registry/stale snapshot/immutability
PASS synchronized ledger credit prevents initial acceptance
PASS synchronized double acceptance and restart durability
```

Boundary SQL regression file completed before those PASS markers under ON_ERROR_STOP. Both races verified an actual PostgreSQL lock waiter before releasing the first transaction. Double acceptance creates one receipt; prior locked ledger credit rejects acceptance. Restart retained exactly the two intended receipts. Runtime files are 17, 67 and 73 lines. Only scoped checks ran; parent owns root lint/type/test checks and combined runtime harness review.
