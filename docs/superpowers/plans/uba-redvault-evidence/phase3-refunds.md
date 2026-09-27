# Phase 3 REDVAULT refund persistence and orchestration evidence

Status: READY FOR PARENT REVIEW — NOT LIVE READY

## Delivered bounded slice

- Added `20260912090700_uba_redvault_refund_lifecycle.sql`. It keeps all refund state and unit-reservation tables private with RLS deny policies, exposes only three service-role RPCs, and introduces no public route.
- `reserve_uba_redvault_refund` locks the persisted original capture attempt, checks the immutable Ogabassey merchant, requires `captured_held` or `approved`, reuses the unique request idempotency record, and counts pending, processing, and processed amounts against the original capture.
- Full-capture refunds reserve the entire stored capture amount, including any shipping or tax in that original payment. Merchandise-unit refunds use only persisted item/unit identities and compute the stored unit net as `unit_price_kobo - allocation_kobo`; they do not allocate shipping or tax.
- `claim_next_uba_redvault_refund` changes only a pending reservation to processing with `FOR UPDATE SKIP LOCKED`. A timeout without a provider ID remains processing and is therefore not blindly sent again. A known accepted nonterminal provider ID is persisted before returning indeterminate.
- `20260912090800_uba_redvault_refund_reconciliation.sql` adds a one-time reconciliation claim for known-provider-ID processing rows. Its injected lookup-only operation can record trusted `processed` or `failed` outcomes without resubmitting; `processed` records provider processing, not customer receipt.
- `20260912090900_uba_redvault_refund_capture_receipt_guard.sql` replaces reservation only after validating the persisted `capture_amount_kobo`, currency, reference, successful status, and eligibility-evidence hold reason from the capture receipt. Any capture mismatch, including a smaller actual amount, is manual reconciliation only; neither full nor unit refunds are automatically reserved.
- Failed unit refunds release their unit reservation for an explicit subsequent operator request. No discount usage restoration is implemented.
- Added an injectable operator worker plus a durable RPC store adapter. REDVAULT now uses an isolated server-only Paystack transport for submission and read-only lookup; the shared Paystack wrapper is no longer imported because it logs provider error details. The isolated transport has static errors, no logging, no retry, a 15-second timeout, disabled redirects and no-store requests.

## Focused verification

- `pnpm --dir apps/web exec vitest run src/lib/payments/redvault-refund-store.test.ts src/lib/payments/redvault-refund-orchestrator.test.ts src/lib/payments/redvault-refund-paystack-provider.test.ts src/lib/payments/redvault-refund-lifecycle-migration.test.ts` — passed: 4 files, 12 tests.
- `pnpm --dir apps/web exec biome check` on the nine owned TypeScript files — passed.
- `node supabase/migrations/tests/run-redvault-native.mjs` — passed through the capture receipt and dedicated refund lifecycle checks. The disposable cluster was stopped and removed by the runner. The executable checks cover failed/smaller capture receipt rejection, request idempotency, merchant rejection, unit double-reservation rejection, response-loss claim behavior, failed-to-retry release, processed reconciliation, and persisted unit net arithmetic.

## Parent integration seam

- Parent must invoke `RedvaultRefundStore` only from a separately authorized operator/cron worker that provides a service-role RPC client. Do not connect it to a storefront request, unauthed route, or generic user-facing service-role path.
- The parent-owned native harness now applies migrations through `20260912090900` and runs the dedicated refund checks. This worker did not edit the common runner or fixture.
- Concrete provider lookup is available through `redvaultPaystackRefundProvider.lookup` for `reconcileNextRedvaultRefund`. Operator authorization transport, owner refund policy decisions and customer-facing status remain parent integration work. No provider eligibility evidence or live capture/refund readiness is claimed.

## Paystack adapter follow-up

- Verified official documentation on 2026-09-12: https://paystack.com/docs/api/refund/ documents GET `/refund/:id`, numeric response `data.id`, and the success envelope; https://paystack.com/docs/payments/refunds/ documents pending, processing and needs-attention behavior. Lookup requires an exact match between the requested canonical numeric ID and returned safe-integer ID. Only explicit processed/failed statuses terminalize; known nonterminal statuses normalize to pending for the existing SQL contract. Missing/unknown statuses, false envelopes, HTTP errors, malformed JSON and mismatched IDs fail closed with static errors.
- Submission validates the returned original transaction reference, amount and NGN currency before trusting its numeric refund ID. A known ID with nonterminal/unknown status is preserved for reconciliation. HTTP errors (including HTTP 200 with status false), timeout, invalid JSON and missing/unbound response fields return indeterminate, never failed. No uncertain submission releases its reservation or retries automatically. A failed submission result with a valid bound ID is retained until lookup confirms the terminal failure.
- Focused executable command: `pnpm --dir apps/web exec vitest run src/lib/payments/redvault-refund-paystack-provider.test.ts src/lib/payments/redvault-refund-orchestrator.test.ts src/lib/payments/redvault-refund-store.test.ts` — 3 files, 41 tests passed. Provider tests inject mocked fetch only; no real provider request was performed.
- Lookup exceptions retain reserved funds. Migration 911 now allows the reconciliation claim to expire and be reacquired for another GET; operator claim recovery is no longer required. Processed still does not assert customer receipt, and usage is not restored.

## Reconciliation lease recovery

- Added append-only `20260912091100_uba_redvault_refund_reconciliation_lease.sql`; migrations 900–910 remain untouched by this follow-up.
- A two-minute technical lease permits another lookup worker to reclaim a processing refund with a known provider ID. Reclaim rotates the UUID fencing token. Reconciliation rejects expired, replaced and null tokens before changing refund state or releasing unit reservations. Missing timestamps on legacy claims are recoverable. Unknown provider IDs remain held for manual reconciliation.
- Only two lines were appended to the common runner: apply 911 immediately after Raman's 910, and execute `redvault-refund-reconciliation-lease.sql` after the existing refund tests. Capture, initializer and fixture files were not changed.
- Executed `node supabase/migrations/tests/run-redvault-native.mjs` successfully (exit 0). Output included capture reverse-lock concurrency, refund lifecycle, refund reconciliation lease, and concurrent fresh-draft checks passed. The owned temporary cluster was stopped and removed.
- The new SQL test executes lease acquisition, refusal of an active-lease reclaim, simulated expiry without sleeping, rejection of the expired token, reclaim with a different token, rejection of stale/null tokens, preservation of amount/unit reservations, absence of submission retries, and successful completion using the renewed token. Its fixture changes roll back.
- No remaining lease-recovery blocker in this local harness. This adds no scheduler or provider call and does not establish live readiness.

## Prohibited operations

No provider or network payment call, production/remote access, migration application, deploy, commit, branch, push, email, install, or common-runner edit was performed.
