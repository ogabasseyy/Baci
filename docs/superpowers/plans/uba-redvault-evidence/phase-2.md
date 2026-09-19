# Phase 2 — Protected REDVAULT orders and proof persistence

**Status: READY FOR PARENT REVIEW — PHASE2. Parent acceptance remains pending.**
Workspace: `/Users/mac/Baci-app/.worktrees/ogabassey-uba-redvault-phase-0`
HEAD: `449e604c434f7a9996e7284acf0dfd6c190f0187`

## Delivered boundary

- Four additive migrations separate protected tables/guards, snapshot validation, draft creation and proof attachment. No merchant activation or discount record is seeded. Runtime starts disabled; commercial confirmation and explicit decision records are required for fresh drafts.
- The existing scoped authenticated JWT now optionally binds the normalized REDVAULT customer email. Draft and attach require route, merchant, email and user/guest identity. No user-facing service-role client was introduced.
- Catalog quote construction uses the accepted shared eligibility/calculation policy. Missing requested variants and missing/invalid prices reject. VAT category/rate snapshots mirror persisted item defaults (`S`, 7.5), while the existing merchant-aware tax computation remains responsible for actual tax. Null request attributes normalize to the persisted empty object. Customer prices cannot define the quote.
- The existing order engine creates the order/items first. The specialized draft validates persisted product/variant/condition/attributes/price/quantity/VAT and catalog brand/name, then binds allocations to real item UUIDs and line ordinals. Group totals, half-up 5% arithmetic, deterministic per-unit distribution, uniqueness, and the 10,000-unit technical resource bound are checked before returning proof context.
- The server validates returned proof context with Zod and checks it against its authoritative quote before signing. Attachment compares the entire payload (apart from its required nonce) with the stored context, validates payload hash and HMAC, and binds proof ID to signature. All identity/proof checks precede pending replay returns.
- Draft recovery uses a merchant/email/checkout-key advisory lock, immutable request/quote hashes, and one application per order. Concurrent identical fresh retries create one order/application. A changed request/quote with the same key fails closed. A new proof can attach to a recovered draft; pending retries still require a valid complete proof.
- Applications and allocations stay private with explicit deny policies and revoked direct privileges. Generic usage insertion/update and protected discount commercial/merchant mutations are blocked. The protected binding cannot be removed/reassigned. Order updates cannot remove the payment marker or mark these orders paid; item changes are blocked after binding. The internal write capability is a private transaction row, not a caller-settable GUC.
- `/api/orders` rejects wrong merchants, missing retry keys and unsupported voucher/wallet/savings/code combinations before earlier voucher recovery can execute. It delegates draft/proof orchestration to a focused helper and returns before the generic redemption/provider/notification continuation. All new executable modules are below 300 lines.

## Local checks

Run from the workspace root:

```sh
pnpm --filter @baci/web exec vitest run src/app/api/orders/route.test.ts src/lib/checkout/compute-redvault-order-quote.test.ts src/lib/checkout/create-redvault-checkout-response.test.ts src/lib/checkout/create-redvault-discount-proof.test.ts src/lib/checkout/redvault-order-draft.test.ts src/lib/checkout/storefront-order-rpc-client.test.ts src/lib/checkout/validate-redvault-request.test.ts src/schemas/redvault-proof-context.test.ts src/lib/redvault-discount-persistence-migration.test.ts --no-file-parallelism
node supabase/migrations/tests/run-redvault-native.mjs
pnpm turbo lint --cache=local:r --concurrency=1
pnpm turbo typecheck --cache=local:r --concurrency=1
git diff --check
```

- Focused Vitest: **9 files, 158 tests passed**, including the complete existing orders-route suite and the actual REDVAULT disabled route path. Success signing/attachment, substituted context rejection and missing commercial/runtime errors are covered in focused helper/schema tests.
- Native PostgreSQL **18.6**: migration application and behavioral checks passed. Checks include anonymous/raw authenticated RPC denial, disabled/missing-commercial rejection, item-bound draft, same-key recovery, signed proof/valid retry, null/missing/substituted payload rejection after pending, wrong merchant/user, no usage at create/attach, immutable order/item/discount guards, invalid catalog/allocation rollback, GUC spoof rejection, and two concurrent fresh draft calls producing one additional order/application.
- `pnpm turbo lint`: **4/4 tasks successful**; pre-existing warnings remain. `pnpm turbo typecheck`: **6/6 tasks successful**. Final touched-source Biome check and `git diff --check` passed.
- Earlier `test -- <path>` accidentally selected broad suites. Those runs are **not passing evidence**. The owned broad process was stopped; subsequent runs use exact `exec vitest run` paths. No duplicate whole-suite rerun was used for this handoff.
- Saved outputs: `phase-2-vitest.log` and `phase-2-sql.log`.

## Native fixture coverage and cleanup

Parent identified a false-positive bug in the original `test_expect_error` fixture helper: its handler could catch the helper's own missing-error exception. Those earlier negative-test results are superseded. The corrected helper catches only the executed statement's error and raises a missing-error failure outside that handler. An explicit self-test calls it with `SELECT 1`, verifies that the missing-error exception propagates, and fails if it is swallowed. The complete native behavioral and concurrent-draft checks were rerun successfully with that corrected helper; the saved SQL log and manifest contain this rerun.

The runner uses installed `/opt/homebrew/bin/initdb`, `pg_ctl`, and `psql`. It creates a unique mode-0700 temporary directory/socket, a new postgres-owned cluster, socket-only port 55479 (no TCP listener), 12 connections and 32 MB shared buffers. Separate sockets isolate the port from existing clusters. Its finally block stops its own server and removes only its generated directory; no owned server remains running. Typical cluster storage is approximately 40 MB.

For an interrupted runner, use the directory printed by the process command/log:

```sh
/opt/homebrew/bin/pg_ctl -D '<owned-generated-root>/data' -m fast -w stop
```

Only after that succeeds may that exact generated root be removed. Do not target an existing cluster or a glob.

The fixture executes the four new migrations and the repository's real canonical JSON/hash and HMAC verifier definitions. Supabase auth claims/roles and the legacy order engine's catalog-to-item insert boundary are modeled locally in `redvault-native-fixture.sql`. It is **not a full historical replay of the legacy inventory/shipping/tax triggers or all Supabase extensions**. The repository chronological replay requires Docker-managed Supabase PostgreSQL 17 and is not interchangeable with this PostgreSQL 18 fixture. The parent must evaluate this coverage explicitly; this report does not claim full-stack database equivalence or waive a database gate.

## Remaining acceptance/release gates

- Parent Phase 2 review is outstanding. No parent acceptance or full-history replay is claimed.
- Phase 3 must add reviewed atomic approval/redemption and payment-attempt/finalizer integration. Existing Phase 2 guards intentionally deny paid transitions and usage writes, including service-role generic attempts. Unique order/application and proof replay keys are the Phase 3 anchors; its approval operation must preserve order/application lock order and increment usage exactly once after verified eligibility.
- Commercial terms remain unresolved. Existing supported 5% pricing is not a promise of unlimited usage or stacking. Configurations needing nonzero minimum-spend interpretation, unsupported targeting, or a cap below the computed discount fail closed rather than invent a policy. Dates and current record activity are checked; usage/budget consumption belongs to approval. No activation rows or production commercial defaults were supplied.
- Provider eligibility, hosted initialization, finalization, UI and release verification remain outside Phase 2. No provider behavior is inferred from these fixtures.
- No install, production credentials, remote database, deployment, provider/payment/email call, branch, commit, push, proxy/.env edit, or subagent was used. Prior Phase 1 changes and unrelated `supabase/.temp/cli-latest` are preserved.

## Complete Phase 2 code/test manifest

Exact SHA-256 values for every path below, this report, and saved evidence are in `phase-2-manifest.sha256`. Verify with `shasum -a 256 -c docs/superpowers/plans/uba-redvault-evidence/phase-2-manifest.sha256` from the workspace root.

- `apps/web/src/app/api/orders/route.ts`
- `apps/web/src/app/api/orders/route.test.ts`
- `apps/web/src/lib/checkout/compute-redvault-order-quote.ts`
- `apps/web/src/lib/checkout/compute-redvault-order-quote.test.ts`
- `apps/web/src/lib/checkout/create-redvault-checkout-response.ts`
- `apps/web/src/lib/checkout/create-redvault-checkout-response.test.ts`
- `apps/web/src/lib/checkout/create-redvault-discount-proof.ts`
- `apps/web/src/lib/checkout/create-redvault-discount-proof.test.ts`
- `apps/web/src/lib/checkout/redvault-order-draft.ts`
- `apps/web/src/lib/checkout/redvault-order-draft.test.ts`
- `apps/web/src/lib/checkout/storefront-order-rpc-client.ts`
- `apps/web/src/lib/checkout/storefront-order-rpc-client.test.ts`
- `apps/web/src/lib/checkout/validate-redvault-request.ts`
- `apps/web/src/lib/checkout/validate-redvault-request.test.ts`
- `apps/web/src/lib/checkout/redvault-test-fixture.ts`
- `apps/web/src/lib/redvault-discount-persistence-migration.test.ts`
- `apps/web/src/schemas/redvault-proof-context.ts`
- `apps/web/src/schemas/redvault-proof-context.test.ts`
- `supabase/migrations/20260912090000_uba_redvault_discount_persistence.sql`
- `supabase/migrations/20260912090100_uba_redvault_snapshot_binding.sql`
- `supabase/migrations/20260912090200_uba_redvault_order_draft.sql`
- `supabase/migrations/20260912090300_uba_redvault_proof_attachment.sql`
- `supabase/migrations/tests/redvault-native-fixture.sql`
- `supabase/migrations/tests/redvault-native-checks.sql`
- `supabase/migrations/tests/run-redvault-native.mjs`
