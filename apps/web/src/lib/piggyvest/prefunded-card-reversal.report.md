# Prefunded collection reversal handoff

Implemented locally in the existing dirty worktree. These additions are staging SQL, not deployed migrations.

## Parent integration

Load after the existing storage/functions, treasury, and projection bundles:

1. `tools/staging/prefunded-card/reversal-storage.sql`
2. `tools/staging/prefunded-card/reversal-functions.sql`
3. `tools/staging/prefunded-card/reversal-guard.sql`

The authorized treasury worker needs schema usage and execute on only the two external entry points:

- `prefunded_card.read_reversal_context(uuid,text)`
- `prefunded_card.record_collection_reversal(text,jsonb)`

Both reuse the binding-first `lock_scoped_operation`, require the enrolled canonical route and physical PostgreSQL system identifier, and check current customer/goal ownership. No shared SQL file or operation column was changed. No migration version was assigned.

`createPrefundedCardReversalHandler({execute,expectedSystemId,settings,fetchImplementation,resolveSavedMethod})` returns `(operationId,deliveryId) => Promise<receipt | {outcome:'reconciliation_required'}>`. The existing provider settings and saved-method resolver contracts are reused. `execute` must use the authorized worker and commit the SQL call before acknowledging delivery. `deliveryId` is the stable delivery key supplied by the parent, not a fabricated provider event identifier. Retry thrown storage errors with the same delivery key.

The handler performs a bounded Paystack transaction-verification GET, checks test domain, reversed status, exact transaction/reference, original collection amount/currency, saved authorization, and customer identity. HTTP transport is injected; tests mock it. Evidence values come from the verified response. A deactivated saved method may verify historical evidence; it cannot authorize a new charge through this handler.

The persisted `collectionAmountKobo` is the original transaction amount reported by verification. It does not assert a refund amount, compensation entitlement, or settlement finality. Unknown, partial/mismatched, live-domain, and unverified responses return reconciliation-required without creating financial effects. No secrets or provider bodies enter SQL or logs.

## Durable behavior

- `collection_reversal_events` deduplicates `(integration_id,event_id)` and refuses conflicting reuse. Different delivery keys can retain separate observations, with only one obligation per operation.
- `collection_reversal_obligations` retains original integration/merchant/customer/goal/treasury scope, first evidence reference, original collection amount, transfer/projection state, transfer identity, and budget at observation. It remains `review_required`; there is no automatic clearance API.
- Before the transfer claim commits, a reversal winning the binding lock prevents new dispatch. Once the claim commits, provider exposure is conservatively in-flight; an external request already admitted cannot be recalled by SQL.
- Collection reversal is terminal. Old collection success/failure callbacks and verification leases cannot restore success or release reserved float.
- An already-dispatched transfer can still record verified settlement using its existing claim or verification lease. Reserved float converts to consumed float once. The reversal obligation remains unresolved.
- Recording reversal never releases reserved float, restores consumed float, posts refunds, debits customer savings, or changes an already applied canonical contribution. An unprojected operation cannot project after reversal.
- Tables have RLS enabled with default deny and no worker table grants; evidence and obligations reject update/delete/truncate. Restricted definer entry points enforce login and scope. Superuser/DDL administration remains outside this role boundary.

## Verification

- Baseline regression reproduced: a direct late success update restored a reversed collection before the new terminal guard; the exact assertion now passes.
- `pnpm turbo test --filter=@baci/web -- src/lib/piggyvest/prefunded-card-reversal.test.ts src/lib/piggyvest/prefunded-card-reversal.store.test.ts src/schemas/prefunded-card-reversal.test.ts`: 38 tests pass.
- `bash tools/test/run-prefunded-reversal-local.sh`: disposable private Unix socket, actual treasury/canonical projection SQL, before/after/in-flight reversal, duplicate/conflict/tenant rejection, stale collection and transfer verification leases, restart, both dispatch lock orders, simultaneous replay, and real TypeScript handler/store with mocked provider GET pass.
- `pnpm --dir apps/web exec tsc --noEmit -p ../../tools/test/prefunded-card-reversal.typecheck.json`: pass.
- Focused Biome check on the six source/test TypeScript files and the driver/config: pass.
- Web typecheck was attempted and stopped on another lane's `savings-exit-evidence.test.ts:71` duplicate `reference` property (TS2783). That file was not changed here.

## Remaining integration and live gates

Parent owns persistent delivery ingestion/retries, worker drain invocation, operator reconciliation presentation, and combined application composition. This lane supplies a real callable verification-to-SQL path and durable obligations; it does not install a webhook or scheduler. Parent must wire the handler and load/grant these additions in its combined harness.

Provider tests use explicit synthetic responses. Live provider reversal finality, partial reversals, disputes, fee disposition, refunds, compensation and operator resolution remain unproven. None is inferred from the original transaction amount. No provider request, real credential use, deployment or money movement occurred.

## Changed files

- `apps/web/src/lib/piggyvest/prefunded-card-reversal.ts`
- `apps/web/src/lib/piggyvest/prefunded-card-reversal.test.ts`
- `apps/web/src/lib/piggyvest/prefunded-card-reversal.store.ts`
- `apps/web/src/lib/piggyvest/prefunded-card-reversal.store.test.ts`
- `apps/web/src/lib/piggyvest/prefunded-card-reversal.report.md`
- `apps/web/src/schemas/prefunded-card-reversal.ts`
- `apps/web/src/schemas/prefunded-card-reversal.test.ts`
- `tools/staging/prefunded-card/reversal-storage.sql`
- `tools/staging/prefunded-card/reversal-functions.sql`
- `tools/staging/prefunded-card/reversal-guard.sql`
- `tools/staging/prefunded-card/reversal-setup.test.sql`
- `tools/staging/prefunded-card/reversal-fixture.test.sql`
- `tools/staging/prefunded-card/reversal-regression.test.sql`
- `tools/staging/prefunded-card/reversal-functions.test.sql`
- `tools/staging/prefunded-card/reversal-boundaries.test.sql`
- `tools/staging/prefunded-card/reversal-ordering.test.sql`
- `tools/staging/prefunded-card/reversal-restart.test.sql`
- `tools/test/run-prefunded-reversal-local.sh`
- `tools/test/prefunded-card-reversal.driver.ts`
- `tools/test/prefunded-card-reversal.typecheck.json`

Baseline inventory and copies of the shared contracts read before this lane: `/private/tmp/baci-prefunded-reversal-baseline.WZcGhT`. All files in this manifest were newly created; no pre-existing dirty source was edited.
