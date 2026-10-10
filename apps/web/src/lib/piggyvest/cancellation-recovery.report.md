# Cancellation recovery — READY FOR PARENT REVIEW

## Scope and current verification gate

Durable read-only recovery is implemented. Local SQL ownership/restart/locking tests and synthetic handler tests pass. Real restricted-executor integration is written but currently fails because parent catalog registration is absent; do not interpret this as a fully passing connected recovery flow. No existing cancellation handler, harness, migration, shared schema, global manifest or executor catalog was edited.

Required execution/connected/contract docs were read. The original staging/product plans were read from the explicitly approved original worktree paths; no writes occurred outside `/Users/mac/Baci-worktrees/cursor-savings-phase1`.

## Callable API / shared protocol

`createCancellationRecoveryHandler({supabase, goalId, configuration, execute}).GET(request: NextRequest): Promise<Response>`.

- `supabase`: request-scoped authenticated RLS client. `goalId`: server-bound UUID. `configuration`: existing strict customer-policy staging/local_test configuration with project identity and merchant/customer allowlists. `execute`: existing `PiggyvestProvisioningExecutor`.
- GET query is exactly `goalId=<uuid>` plus optional `operationId=<original uuid>`. Unknown/duplicate parameters and non-GET requests reject. No request actor/tenant, balances, new operation creation, fresh quote, or mutation endpoint.
- Goal-only lookup returns its unique original durable intent, enabling recovery after client state is gone. An operation-filtered lookup exposes only that matching intent, never a different goal operation.
- Uses Sartre's actual `piggyvestCancellationRecoverySchemas` export from `@baci/shared/contracts`. No duplicate public DTO. The only new web schema validates the database one-row envelope.
- All public states include `goalId`, `requestedOperationId`, `retry: 'not_authorized'`, `dispatch: 'contract_gap'`. Prepared includes original operation ID, retained reservation and saved disclosure. Absent has unknown reservation, not safe-retry authority. Requires-reconciliation never means settlement. Unavailable means the reservation may be retained.
- `originalDisclosure` is the immutable original revision/terms/amount assertion, not current available money or a reconstructed submission command. Internal actor/business/customer/provider identities are not projected.
- HTTP 200 for prepared/absent/requires_reconciliation; correlated 503 for unavailable; generic 401/403 for auth/scope rejection and 400/405 for malformed/method rejection. Responses are no-store. Canonical UUID comparisons accommodate preserved wire case.

## Authentication and durability

`getUser` is first, before method/query/config processing or RLS reads. The concrete existing customer-policy RLS resolver derives actor/tenant/customer/goal; scope is revalidated before SQL and before response. A changed actor, goal or scope cannot receive prior results. One bounded executor read only; no automatic retries. Unknown exceptions, timeouts and malformed/cross-correlated rows are not converted to absent.

SQL calls the existing registry/binding/customer/goal lock routine, checks matching dedicated policy/ledger login bindings, verifies current customer actor and the original intent actor, then verifies the original operation's exact scope and still-unconsumed principal reservation. A corrupt/non-reservation reference reports requires-reconciliation rather than a financial success. Scope-disabled reads fail closed.

Recovery deliberately does not require a fresh device quote, current reviewed-policy enablement or cancellation eligibility: it reads historical evidence only. A policy disabled after preparation does not erase the customer's retained reservation. Ownership checks still apply. No release, refund, settlement, interest mutation, provider request, service/admin client, new ledger or production route is introduced. Row locks serialize observation with preparation; this is read-only with respect to persistent data, not a lock-free PostgreSQL transaction.

## Parent registration (only outstanding connected gate)

Import/spread `CANCELLATION_RECOVERY_STATEMENTS` from `./cancellation-recovery-statements` into the parent-owned catalog and its expected-operation/role tests:

```ts
readCancellationRecovery: {
  text: 'SELECT piggyvest_cancel_plan.read_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
  parameters: 7,
  roles: ['piggyvest_staging_policy_writer'],
}
```

Parameters: integration, merchant, customer, goal, expected business, authenticated actor, nullable requested operation. No other role or financial operation is added. Migration has no public/API-role grants; local fixture grants only the read function to the existing standard writer for the driver test.

Frozen migration: `supabase/migrations/20260912161000_cancellation_recovery_read.sql`.
SHA256: `b223093e286b288ae7cfed3b76bcc45bfa79d50557301e99f6dcb1a05b882cdc`.
Migrations 600–602 remain untouched.

## Owned files (all new)

- `apps/web/src/lib/piggyvest/cancellation-recovery.ts` (134 runtime lines)
- `apps/web/src/lib/piggyvest/cancellation-recovery.test.ts`
- `apps/web/src/lib/piggyvest/cancellation-recovery.test-support.ts`
- `apps/web/src/lib/piggyvest/cancellation-recovery-runtime.integration.test.ts`
- `apps/web/src/lib/piggyvest/cancellation-recovery-statements.ts`
- `apps/web/src/lib/piggyvest/cancellation-recovery-statements.test.ts`
- `apps/web/src/lib/piggyvest/cancellation-recovery.report.md`
- `apps/web/src/schemas/cancellation-recovery.ts`
- `apps/web/src/schemas/cancellation-recovery.test.ts`
- `supabase/migrations/20260912161000_cancellation_recovery_read.sql`
- `tools/test/cancellation-recovery-cases.test.sql`
- `tools/test/cancellation-recovery-local.test.sh`
- `tools/test/cancellation-recovery-runtime-fixture.sql`

## Tests / evidence

From `apps/web`:

```sh
pnpm exec vitest run src/lib/piggyvest/cancellation-recovery.test.ts src/lib/piggyvest/cancellation-recovery-statements.test.ts src/schemas/cancellation-recovery.test.ts src/lib/piggyvest/customer-policy-context.test.ts
pnpm exec biome check src/lib/piggyvest/cancellation-recovery*.ts src/schemas/cancellation-recovery*.ts
```

47 tests pass across four suites (18 new scoped tests plus existing context tests). Biome passes all eight owned TS files. RED runs preceded SQL and handler implementations; exact unknown-read versus absent assertions require distinct states with no retry permission. Tests also cover timeout/no retry, post-read logout, wrong goal/operation correlation, private output rejection and request validation.

From worktree root: `bash tools/test/cancellation-recovery-local.test.sh`.

This new harness leaves the existing cancellation harness unchanged. It uses disposable local PostgreSQL over a Unix socket, TCP disabled, port 55445, synthetic fixtures and synthetic-only executor credentials. SQL portion passes: exact/goal-only lookup, unchanged original disclosures/reservation, absent with no retry authority, cross-tenant/customer/original actor/current actor and role denial, stale policy enablement not erasing history, inconsistent reservation evidence, no ledger changes, actual lock-observed in-flight preparation/read serialization, and post-restart recovery.

The subsequent real-driver test currently fails at its initial expected-absent GET because the standard executor rejects the unregistered statement. It is not mocked around this gate. Once parent registers it, the same harness runs two driver passes: simulated response lost AFTER actual prepare commit, then a separate post-restart GET/goal-only reload without any resubmission. Final SQL requires exactly one intent, four ledger operations (three original credits plus the one reservation), and retained principal. Opt-ins: `PIGGYVEST_RUN_CANCELLATION_RECOVERY=1`, socket passed as `PIGGYVEST_LOCAL_TEST_SOCKET`; second pass additionally sets `PIGGYVEST_RECOVERY_AFTER_RESTART=1`.

## Remaining contracts / limits

Parent owns catalog/manifest registration, connected rerun and root checks. Sartre owns public schema/controller; deployed recovery endpoint, authenticated runtime packaging and UI integration remain separate. Provider refund transport, fees/timing, interest disposition and financial finality are unresolved and remain disabled. No live integration, full production-schema replay, real customer authentication or provider result is claimed.
