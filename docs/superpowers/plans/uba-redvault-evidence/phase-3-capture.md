# Phase 3 REDVAULT capture hold evidence

Status: READY FOR PARENT REVIEW — CAPTURE

## Implemented scope

- Added `capture_or_hold_uba_redvault_payment`, a private service-role-only capture receipt RPC. It locks the verified transaction and order, resolves REDVAULT state from persisted server rows, validates the transaction/order/merchant, exact reference, amount, currency, and frozen quote hash, then records `captured_held` evidence.
- The RPC never approves an attempt and never updates order payment status, inventory, settlement, merchant credit, notifications, or paid-order outbox state. Provider eligibility remains unavailable by default, including when a capture otherwise matches.
- Duplicate matching receipts are idempotent. Conflicting second receipts fail closed. Missing attempts, invalid transaction linkage, RPC errors, and malformed RPC responses fail closed.
- Wired the capture guard before `completeOrderGatewayPayment` in the shared finalizer. This covers normal completion, already-paid settlement-only fallback, and the existing webhook/verify/recovery callers that use the finalizer. A persisted non-REDVAULT order returns before the new RPC, so ordinary flows retain their existing behavior even before the migration is present.

## Local verification

- `pnpm --filter @baci/web exec biome check src/lib/payments/redvault-capture-hold.ts src/lib/payments/redvault-capture-hold.test.ts src/lib/payments/finalize-order-gateway-payment.ts src/lib/payments/finalize-order-gateway-payment.test.ts` — passed.
- `pnpm --filter @baci/web exec vitest run src/lib/payments/redvault-capture-hold.test.ts src/lib/payments/finalize-order-gateway-payment.test.ts` — passed: 2 files, 35 tests.
- `pnpm --filter @baci/web exec tsc --noEmit --pretty false` — passed.

## Parent follow-up required

- `apps/web/src/app/api/payments/verify/route.ts` and `apps/web/src/app/api/payments/webhook/route.ts` do not yet map `captured_held` to a distinct pending/held HTTP response; both currently fall through to their generic non-error response. They do not run the paid-order finalizer branches because the shared guard returns first, but the response contract must be updated before any REDVAULT UI integration.
- `supabase/migrations/tests/run-redvault-native.mjs` currently stops at migration `20260912090500`; parent must append `20260912090600` and source `tests/redvault-capture-hold.sql` before calling the native SQL capture test executed evidence.

No provider call, real payment, production/remote access, migration application, commit, push, deploy, email, install, or branch action was performed.

## Additive 910 convergence — 2026-09-12

This update supersedes the earlier runner and route follow-up notes above.

- Added `20260912091000_uba_redvault_capture_lock_order.sql`; migrations 900–909 are unchanged by this correction.
- Capture selects the attempt through its order/application join using `FOR UPDATE OF attempt`, then reads the application `FOR SHARE`. This matches the initializer/refund attempt-before-application ordering and retains the shared order advisory lock.
- Held duplicate receipts now compare persisted capture status as well as reference, amount and currency. Evidence that fails current validation raises `redvault_capture_evidence_conflict`; it cannot return a contradictory duplicate outcome or mutate verified proof.
- Added `tests/redvault-capture-replay.sql`: failed, pending, empty and null status replays are rejected; matching success remains an idempotent held duplicate; durable proof and unpaid order state are asserted.
- Added `tests/redvault-capture-concurrency.mjs`: one real PostgreSQL session holds the attempt, another executes the service-role capture RPC, and the test observes the capture blocked by the first session using `pg_blocking_pids`. The holder then requests the application share lock and commits. Both sessions must complete with capture returning a held duplicate.
- Authorized common-runner edits load migration 910 before capture checks and invoke replay/concurrency checks before refund lifecycle checks. Shared fixture authority is unchanged.

### Executed evidence

- `node supabase/migrations/tests/run-redvault-native.mjs` — exit 0 with migrations 906/907/908/909/910; capture replay, reverse-lock concurrency, refund lifecycle and concurrent draft checks passed.
- Negative control using the same concurrency test with migration 910 omitted — exit 1, PostgreSQL `deadlock detected` while capture waits on the attempt and the other session waits on the application.
- Negative control using the same replay test with migration 910 omitted — exit 1, `conflicting capture status accepted`.
- Prior focused finalizer/capture/verify/webhook Vitest run passed 139 tests and web TypeScript passed. This correction changes SQL and native coverage only.
- Verify and webhook now map held/review evidence to pending HTTP 202 responses; capture persistence failure returns HTTP 500 before settlement fallback.

No remaining blocker in the assigned 910 correction. READY FOR PARENT REVIEW — CAPTURE.
