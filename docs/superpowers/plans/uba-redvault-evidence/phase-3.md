# Phase 3 — REDVAULT payment backend

**Status:** INITIALIZE IMPLEMENTED — NARROW GOVERNANCE APPROVED (NOT ACTIVATION READY)

The 12 September owner approval and passing live boundary rerun supersede the historical governance-blocker notes below. See `initialization-authority-approval.md`. Positive eligible-payment completion and external release gates remain outstanding.

## Scope completed

- Added private REDVAULT attempt and refund tables with RLS, no direct client access, immutable reference/quote-hash/amount/currency fields, and an unapproved paid-transition trigger.
- Added a mocked payment-flow seam that persists an attempt before a provider initialization call, reuses indeterminate attempts without another initialization call, and records every capture as held.
- Added documented Paystack card-only metadata construction for the configured bank filter and `verve`, `visa`, and `mastercard` brands. The bank code is required input; there is no hardcoded or inferred UBA code.
- Wired the existing orders and payment-initialize routes to the false-by-default availability gate. Both reject REDVAULT before creating an order or calling a provider while provider eligibility evidence is absent.
- Added a customer-scoped attempt adapter around migration `20260912090500`, including a persisted hosted URL, generic-gateway prevention from the frozen order payment method, reserve-before-provider initialization, initialized URL reuse, and indeterminate response-loss recovery.
- The 905 reserve/claim/record RPCs use the capture path's order advisory lock and attempt-then-application lock order. A portable `[0-9]{3}` bank-code check accepts the fixture's `033` without PostgreSQL string-escape ambiguity.
- REDVAULT rejects every non-Paystack gateway and DVA/payment-type request before availability or provider work, and its provider orchestration is extracted from the initialize route.
- Returned the full frozen server REDVAULT checkout summary from the protected order-draft response through a scoped RPC: persisted order total/currency/tracking token plus product, eligible, ineligible, discount, tax, shipping, gift wrapping, payable, and mixed-basket fields. The wire contract is snake_case only and has no client-calculated fallback.
- Added local tests for persistence-before-initialization, response-loss retry, card-only filters, amount/currency/reference/method mismatch, malformed/missing bank configuration, and held capture behavior.
- Extended the native disposable PostgreSQL fixture with the new migration and assertions that direct paid updates remain denied and client roles cannot create refunds.

## Changed files

- `apps/web/src/lib/payments/redvault-payment-gate.ts`
- `apps/web/src/lib/payments/redvault-payment-gate.test.ts`
- `apps/web/src/lib/payments/redvault-payment-flow.ts`
- `apps/web/src/lib/payments/redvault-payment-flow.test.ts`
- `apps/web/src/lib/payments/redvault-payment-attempt-client.ts`
- `apps/web/src/lib/payments/redvault-payment-attempt-client.test.ts`
- `apps/web/src/lib/payments/redvault-payment-initialize.ts`
- `apps/web/src/lib/payments/redvault-payment-initialize.test.ts`
- `apps/web/src/lib/payments/initialize-redvault-paystack-checkout.ts`
- `apps/web/src/lib/payments/initialize-redvault-paystack-checkout.test.ts`
- `apps/web/src/lib/payments/redvault-payment-attempt-api-migration.test.ts`
- `apps/web/src/app/api/payments/initialize/route.ts`
- `apps/web/src/app/api/payments/initialize/route.test.ts`
- `apps/web/src/app/api/orders/route.ts`
- `apps/web/src/app/api/orders/route.test.ts`
- `apps/web/src/lib/checkout/create-redvault-checkout-response.ts`
- `apps/web/src/lib/checkout/create-redvault-checkout-response.test.ts`
- `apps/web/src/lib/checkout/get-redvault-checkout-summary.ts`
- `apps/web/src/lib/checkout/get-redvault-checkout-summary.test.ts`
- `apps/web/src/lib/checkout/redvault-order-draft.ts`
- `apps/web/src/lib/checkout/redvault-order-draft.test.ts`
- `supabase/migrations/20260912090500_uba_redvault_attempt_api.sql`
- `supabase/migrations/tests/redvault-native-fixture.sql`
- `supabase/migrations/tests/run-redvault-attempt-concurrency.mjs`
- `supabase/migrations/20260912090400_uba_redvault_payment_completion.sql`
- `supabase/migrations/tests/redvault-native-checks.sql`
- `supabase/migrations/tests/run-redvault-native.mjs`

## Local evidence

### Authority review follow-up

- Added `redvault-test-fixture.test.ts` to check quote subtotal, unit allocation counts/sums, grouped member bindings, group totals, and the fixture's five-percent discount. Fixture consumers and production behavior are unchanged.
- Focused fixture/consumer validation: `pnpm --filter @baci/web exec vitest run --maxWorkers=1 --no-file-parallelism src/lib/checkout/redvault-test-fixture.test.ts src/lib/checkout/create-redvault-checkout-response.test.ts src/schemas/redvault-proof-context.test.ts src/lib/checkout/redvault-payment-availability.test.ts` — 4 files, 10 tests passed. Scoped Biome and `git diff --check` passed.
- The initialize credential graph remains a governance blocker: `initialize/route.ts -> initialize-redvault-paystack-checkout.ts -> redvault-payment-attempt-client.ts -> scoped-jwt.ts -> agentic/jwt-signing-material.ts -> env.ts`. The two new payment helpers also independently reach the signing authority.
- `event-pipeline-service-authority-graph.ts#allowsCredentialPath` requires the complete path to match. `event-pipeline-credential-paths.ts` explicitly permits orders -> storefront-order-rpc-client -> signer, but not initialize -> that adapter. Initialize's existing credential permission covers the DVA persistence/reservation path only. Substituting the order adapter would not confer caller authority, so no reroute or policy relaxation was made.
- Orders remains protected by `event-pipeline-frozen-authority-sources.ts`, expected SHA-256 `5b605dd9d0d34a040400c5d61d8c81401c6b0a8026513f34835b01ceafc13672`. The changed REDVAULT route requires owner review of its actual diff and an approved content receipt; the hash was not updated.
- These are outstanding integration acceptance blockers requiring governance approval or an approved redesign. Availability remains false. No SQL, signer, authority allowlist, frozen hash, or client code was changed in this follow-up.
- Live rerun including `tools/events/verify-event-pipeline-boundaries.live.test.ts`, `tools/events/verify-analytics-delivery-authority.repository.test.ts`, and the four fixture/consumer suites: 23 tests passed, 1 failed (6 files). Analytics delivery authority now passes. The sole failing boundary test reports exactly the frozen orders hash (actual `b9bab13947d81c13b08bd8cd61904fc0cddd75ad510e1079fb4e23e51da43e3f`) and the three initialize/helper credential paths documented above.

- Parent follow-up: verified the actual web checkout fetch and mobile orders service both send `Idempotency-Key`. The existing route extracts that header and passes it into `validateRedvaultRequest`; no route production fix was needed. Added a route regression with availability mocked enabled that returns 201 through the mocked protected checkout seam and verifies the key and request hash reach that seam.
- Hardened the checkout-summary adapter: every kobo field must be a nonnegative safe integer; malformed numeric strings and sub-kobo totals are rejected; eligible/ineligible partition, discount bound, mixed-basket flag, persisted total, and the complete payable equation are validated. BigInt arithmetic prevents intermediate precision loss.
- Follow-up verification: `pnpm --filter @baci/web exec vitest run --maxWorkers=1 --no-file-parallelism src/app/api/orders/route.test.ts src/lib/checkout/get-redvault-checkout-summary.test.ts src/lib/checkout/create-redvault-checkout-response.test.ts src/lib/checkout/redvault-order-draft.test.ts src/lib/checkout/validate-redvault-request.test.ts` — 5 files, 154 tests passed. Scoped Biome passed for the three changed TypeScript files. No SQL900–909 or client files were edited for this follow-up.

- `pnpm --filter @baci/web exec vitest run --maxWorkers=1 --no-file-parallelism src/app/api/payments/initialize/route.test.ts` — 65 tests passed.
- `pnpm --filter @baci/web exec vitest run --maxWorkers=1 --no-file-parallelism src/app/api/orders/route.test.ts` — 122 tests passed.
- `pnpm --filter @baci/web exec vitest run --maxWorkers=1 --no-file-parallelism src/lib/checkout/get-redvault-checkout-summary.test.ts src/lib/checkout/redvault-order-draft.test.ts src/lib/checkout/create-redvault-checkout-response.test.ts` — 3 files, 6 tests passed.
- `pnpm --filter @baci/web exec vitest run --maxWorkers=1 --no-file-parallelism src/lib/payments/redvault-payment-attempt-client.test.ts src/lib/payments/redvault-payment-initialize.test.ts src/lib/payments/redvault-payment-attempt-api-migration.test.ts src/lib/checkout/create-redvault-checkout-response.test.ts src/lib/checkout/redvault-payment-availability.test.ts` — 5 files, 9 tests passed.
- `get_storefront_redvault_checkout_summary` returns the frozen persisted checkout response. Its helper and response tests reject malformed snapshots rather than calculating client fallbacks.
- `pnpm --filter @baci/web exec tsc --noEmit --pretty false` — passed.
- Scoped Biome check of changed route/helper tests and sources — passed.
- `node supabase/migrations/tests/run-redvault-native.mjs` — passed through migrations 900–907, capture-hold, refund lifecycle, and fresh-draft concurrency checks.
- `node supabase/migrations/tests/run-redvault-attempt-concurrency.mjs` — passed: the scoped checkout-summary RPC returned persisted normal order fields and frozen totals; concurrent reserve produced one attempt and concurrent claim produced one provider winner.
- `pnpm --filter @baci/web run lint` is blocked by concurrent UI-demo files under `apps/web/tools/redvault-demo/` and a pre-existing hook warning. The REDVAULT backend files were individually formatted with Biome. Those UI-demo files were not changed by this worker.

## Remaining local work

- Initialize wiring is complete. Verify, webhook, recovery, finalizer, and refund integration remain owned by their assigned workers and require their separate review.
- Add persisted capture/reconciliation/refund request adapters and tests for cumulative allocation caps and provider request versus processed outcomes.

## External activation prerequisite

No documented provider result currently supplies durable trusted issuer eligibility evidence for the supplied UBA ranges. Consequently, the production path has no approval operation: successful, matching, card-channel captures remain `captured_held`, do not mark an order paid, do not increment usage, and do not run inventory, settlement, merchant credit, notifications, or outbox success. A reviewed provider contract must define the evidence and validated bank lookup before enabling any positive approval transition. This does not prevent local mocked attempt/hold testing.

The disabled route still carries the merchant Paystack subaccount for its eventual hosted request. Before any activation, Paystack and UBA must prove the provider's settlement behavior for a captured-but-held REDVAULT attempt: no settlement, merchant credit, or released value may occur before the separately reviewed approval path. Internal ledger state and held finalizer behavior do not establish that external settlement is blocked.

## Prohibited operations

No provider calls, real payments, production access, migration application, deploy, commit, push, merge, email, `.env` edit, `proxy.ts` edit, or UI integration was performed.
