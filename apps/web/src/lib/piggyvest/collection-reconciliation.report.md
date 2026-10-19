# Collection correlation — READY FOR PARENT REVIEW

This is pending/unknown metadata coordination, **not a financial processor**.
The initially proposed synthetic-confirmation capability was rejected by parent
before SQL was written. No fixture-proof table, synthetic-confirmed action, new
ledger apply call/grant, provider classification or public credit endpoint exists
in this implementation. Synthetic credits remain exclusively in the local harness.

## Reuse and missing connection

Existing immutable `piggyvest_staging.wallet_goal_mappings` supplies the exact
integration/wallet/provider-customer to merchant/customer/goal binding.
Existing `piggyvest_savings_ledger.operations` already has an operation primary
key and `UNIQUE(integration_id,evidence_id)`; this slice does not replace that
economic identity or introduce another ledger. Exact canonical replay uses the
same operation/content. A different operation or amount for the same evidence
conflicts under the existing ledger contract.

The new tables hold only a stable collection-reference correlation and immutable
observation receipts. They do not hold account balances or grant money-use rights.
Different observation IDs can report the same correlation; the caller retains its
stable operation ID. Changed correlation identity or reused observation ID with
changed content fails closed. Correlation-reference uniqueness is metadata
identity, not a second economic-credit mechanism.

## Exact contracts

Factory: `collection-reconciliation.ts#createCollectionReconciliation`, explicit
trusted internal configuration and the existing executor; no HTTP route.
Configuration is staging/local_test with integration, merchant, customer, goal,
business and current actor. SQL checks current actor and existing mapping/scope
on every call, including historical replay.

Observe accepts only:
`operationId, observationId, collectionReference, evidenceId, providerWalletId,
providerCustomerId, observation`. Observation is **pending or unknown only**.
No amount, principal/interest classification, actor override, proof or confirmation
field is accepted. Provider observations remain financially unclassified.

Observe returns `persisted_observation` with a receipt containing operation,
observation, goal, pending/unknown status, financialEffects UNKNOWN,
dispatch disabled and debitPermission false. Lost response returns correlated
unconfirmed/readbackRequired, not success or an automatic retry.

Read takes operationId and optional observationId. It returns separate current
metadata, optional historical receipt, actual existing ledger snapshot and
optional same-scope `credit_principal` evidence. That evidence is explicitly
`internal_ledger_only` / `not_authorized`; it is not proof of provider cash,
external settlement or an available/recoverable refund. Correlation remains
pending/unknown even when canonical evidence exists. Unknown cannot be downgraded
to pending by a later event or replay.

The existing ledger snapshot includes reversal/reservation information; historical
credit evidence is not a current spendability assertion.

## Atomic boundary and permissions

172000 calls existing `piggyvest_goal_policy.lock_scope`: registry share, ledger
binding update, policy binding/customer share, then goal update. It checks current
actor and exact immutable wallet mapping before accessing metadata. Correlation
reads never lock a different goal's row before denying a mismatched operation.
Metadata and receipt commit together; neither function invokes ledger apply.

Identity fields and receipts are immutable; only monotonic pending→unknown status
can change. New tables have RLS, restrictive deny policies and no public,
authenticated or service-role privileges. No default function grants, new role,
rollout gate, provider transport, scheduler or Paystack modification exists.
Only the disposable fixture supplies explicit local test privileges.

## Registration handoff

Migration: `supabase/migrations/20260912172000_collection_reconciliation.sql`

SHA-256: `f3f29cfa7311498075ac16a207457a057945059d1880b41e18b0a20ac947d40c`.
Frozen after Hooke and parent acceptance; Fermat completed parent-owned exact
statement/catalog/manifest/planner registration. Existing frozen 165000/165100
were not changed. Fermat independently reread the metadata-only boundary and
reported no verified actionable finding; test executions are attributed below.

Register exactly `COLLECTION_RECONCILIATION_STATEMENTS` from
`collection-reconciliation-statements.ts`, both policy-writer-only:

```sql
SELECT piggyvest_collection_reconciliation.observe($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::jsonb) AS result
SELECT piggyvest_collection_reconciliation.read($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::uuid) AS result
```

Names: observeCollectionReconciliation (7 parameters), readCollectionReconciliation
(8 parameters). First six: integration, merchant, customer, goal, business, actor.
Observe seventh is strict command JSON; read seventh/eighth are operation and
nullable observation IDs. No alternate executor/catalog bypass was added.

## Tests and provenance

```sh
bash tools/test/collection-reconciliation-local.test.sh
```

Direct restricted PostgreSQL GREEN exit 0. New checks prove pending→unknown,
historical replay without downgrade, malformed/financial authority rejection,
wrong wallet, identity/content conflict, rollback, immutable fields/receipts,
current-actor revocation and denied user/service-role access.

Four new **observed lock waits** cover metadata versus canonical incoming credit
in both orders, plus cancel-before-credit and credit-before-cancel. The existing
eight schedule/ledger races also pass. Cancel-first retains 100 reserved out of
150 principal; credit-first reserves all 150. Both leave schedule metadata stopped.
Exact canonical replay leaves one credit; changed amount or operation conflicts.
After PostgreSQL restart, metadata/history/evidence assertions pass again.

TDD: adapter stub returned an uncorrelated failure instead of attempting SQL
(RED), then the test passed. SQL initially returned pending for an unknown
observation (cases.sql line 5, RED exit 3); monotonic unknown logic made the same
assertion GREEN. A harness setup error (cancel quote used paid/pending-interest
amounts absent from the principal-only fixture) was corrected only in test input;
it is not counted as a runtime defect.

14 focused unit/schema/statement tests pass. Scoped Biome passes. Root typecheck
passes. An earlier root lint attempt failed on two unowned import-sort diagnostics
in postgres-executor.goal-policy.test.ts and postgres-statements.test.ts; those
were corrected by their owner, and the fresh root lint rerun passed with existing
warnings. Final post-registration broad gates remain parent-owned.

**Completed after parent registration**, standard-executor acceptance command:

```sh
PIGGYVEST_COLLECTION_EXECUTOR_ACCEPTANCE=1 bash tools/test/collection-reconciliation-local.test.sh
```

The provided `collection-reconciliation.runtime.test.ts` covers committed-response
loss, readback, exact observation replay, same-scope canonical evidence and
restart through the actual registered executor. Final command exited 0:
**1 passed / 1 skipped before restart**, **1 passed / 1 skipped after restart**.
The normal non-opt-in run correctly skips these two integration cases. No
alternate catalog, SQL executor, fixture-proof table or new financial grant was
used for acceptance. All twelve observed lock waits and the SQL assertions passed
in the same standard-executor run. Log: `/tmp/collection-standard-executor.log`.

## Remaining work, not hidden authority

Actual economic/provider identity, amount/currency/finality/fee/reversal linkage
and financial inbox completion remain unimplemented/contract-gated. This slice
cannot resolve a bridge, credit a goal, release a reservation, clear a reversal
or resume collection. Existing canonical ledger evidence alone cannot promote
pending/unknown to provider-confirmed. No synthetic test establishes provider
sandbox compatibility or live financial acceptance. Root final gates and
independent review remain parent-coordinated.
