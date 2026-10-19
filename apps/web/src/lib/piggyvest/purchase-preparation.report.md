# READY FOR PARENT REVIEW — local purchase preparation

## Implemented files

- `apps/web/src/lib/piggyvest/purchase-preparation.ts` and colocated tests: `createPurchasePreparation({configuration, execute})` exposes `quote({quoteId})`, `prepare({operationId, accepted:true, quote})`, and `status({operationId})`.
- `apps/web/src/lib/piggyvest/purchase-preparation-statements.ts` and colocated tests: three proposed restricted statements, not registered by this slice.
- `apps/web/src/schemas/purchase-preparation.ts` and colocated tests: strict configuration, exact quote, confirmation, correlated pending receipt.
- `supabase/migrations/20260912162000_purchase_preparation_tables.sql`: private disabled-by-default fixture quote inputs and immutable purchase intent, RLS denial and no runtime quote-publisher grants.
- `supabase/migrations/20260912162100_purchase_preparation_commands.sql`: local-only exact scope, quote, atomic preparation and durable status RPCs. No invocation grants seeded.
- `tools/test/purchase-preparation-local.sh`, `purchase-preparation-fixture.sql`, `purchase-preparation-cases.sql`: disposable Unix-socket PostgreSQL, synthetic data, SQL regressions, observed lock contention and restart durability. Owned processes stop on exit.

## Authority and money boundary

Only `staging/local_test` configuration is accepted. The SQL requires the dedicated policy-writer session, `piggyvest_local` database and Unix socket; both policy and ledger bindings must authorize the exact integration/merchant/customer/goal/business scope. The authenticated actor must match current customer ownership and persisted consent. This module is a server adapter, not an HTTP authentication/CSRF binder.

Quote inputs explicitly contain NGN currency, quantity one, exact product/variant/condition, current device price, delivery/tax/fees, selected savings portion and quote expiry. No fee, delivery, quantity, currency or protected price defaults are invented. Customer assertions are compared to the entire freshly derived SQL quote before reservation, never used as authoritative balances or destination instructions.

Before maturity the device price is the lower of immutable activated guarantee and the persisted current quote; an explicitly stored, still-valid seven-day protected offer can lower it further. Current quote expiry is independent of lifecycle review. At maturity, NEW preparation requires review because guarantee validity during grace is not explicitly established; this does not cancel/expire the customer's promise or seize funds/interest. Status and exact replay bypass new quote/readiness requirements.

Only confirmed unreserved principal plus eligible paid-interest ledger accounts count. Pending accrual is excluded, no 95% threshold is used, and full device-price coverage is required for readiness. The customer-selected savings portion can be less than the full checkout total. Reservation allocates principal first, then only the necessary eligible paid interest; surplus remains customer-owned and unreserved. Separate delivery/tax/fee charges remain disclosed.

Preparation uses the EXISTING ledger binding/goal lock and `reserve_purchase`, in the same transaction as an immutable `purchase_pending` intent. It does not update the legacy goal/timestamp, create another ledger, create an order or reserve stock. Savings and other payment legs are persisted as unsubmitted (or other leg not required). A response loss never releases funds or automatically retries; exact command/operation replay returns the durable intent even if its quote is disabled. Stale/malformed/unknown errors are redacted and never represented as paid/refunded.

## Parent integration interface

Parent may review and add `PURCHASE_PREPARATION_STATEMENTS` to the existing exact statement catalog. Quote/status have seven parameters: scope at indices 0..4, server actor at index 5, quote/operation UUID at index 6. Preparation has six: scope 0..4, strict command JSON including server actor at index 5. Do NOT reuse the policy binder's actor-index assumption. No catalog, manifest, order route, webhook or payment handler was edited.

Quote publication remains FIXTURE-ONLY. There is no current authoritative storefront checkout-pricing binder, no provider financial attribution verification, and no enabled quote rows or invocation grants in these migrations. A future publisher must resolve genuine current price, variant/condition, reviewed protected offers, full charges and quote lifetime server-side; it must not expose fixture insertion authority to a customer. Production/staging activation remains disabled.

## Evidence

- Initial TDD RED: missing new adapter import; then adapter/schema/statement GREEN: 18 tests across three colocated suites.
- Exact financial regression RED: deliberately adding pending accrual to purchasing power made SQL case 202 (95,000 principal plus 5,000 pending against 97,000 device) incorrectly pass, causing the expected rejection assertion to fail with exit 3. Removing that mutation restored GREEN.
- Final `bash tools/test/purchase-preparation-local.sh`: exit 0. Covers lower current/guaranteed/protected prices, expired protected/current quotes, wrong condition, maturity review, explicit charges, stale/fractional assertions, disabled quote, principal/paid-interest allocation, exclusive cancellation reservation, unchanged command replay, changed-command conflict, no settlement/release, RLS/role grants and immutable intent.
- Harness observes a real PostgreSQL lock wait between purchase preparation and refund reservation; only purchase wins. Restart retains both prepared intents.
- Scoped Biome passes. Every new runtime/schema is below 300 lines. No full suite was launched; parent owns broader gates.
- Initial SQL tests used direct local psql and initial adapter tests injected synthetic executor results. The composed real-executor follow-up below now passes separately.

## Composed executor bridge follow-up

New `purchase-preparation-runtime.integration.test.ts` composes the actual adapter and actual restricted PostgreSQL executor without mocking `pg` or the database. Only the server-only import is stubbed for Vitest. An explicit post-commit response-loss wrapper discards the real executor result, then normal status/replay calls verify recovery without obtaining another successful quote.

Run `PIGGYVEST_RUN_PURCHASE_PREPARATION_RUNTIME=1 bash tools/test/purchase-preparation-local.sh` after parent approves and registers the three exact statements. The owned harness uses the executor's allowlisted disposable socket prefix, runs five integration cases, restarts PostgreSQL again, and executes `purchase-preparation-runtime-assert.sql` to verify one reservation/intent, exact principal/paid-interest split, no stale-quote writes and no settlement/release. Omission of opt-in explicitly reports the composed test as skipped.

Pre-registration RED: the opt-in harness's direct psql/race/restart phase passed, but the composed suite had three failures and two passes because the real exact-statement catalog lacked purchase operations. Its explicit catalog assertion and successful quote-dependent cases failed. The normal Vitest invocation skips all five cases.

Post-registration GREEN on 12 September 2026: the full opt-in command exited zero. All five actual adapter/restricted-executor/PostgreSQL tests passed, followed by all nine SQL assertions after a second database restart. The direct psql financial cases, observed purchase/refund lock exclusion and first restart passed separately in the same harness. Scoped Biome passes; both migration hashes remain unchanged. The harness exited and cleaned up its own PostgreSQL process. Hooke's independent final acceptance remains pending. No authenticated HTTP binder or live provider behavior is implemented or claimed.

## Frozen migration SHA-256

- `20260912162000_purchase_preparation_tables.sql`: `d7a8a3671ff3233da097c0deba8b56ca5ae908a9fed54ded510c9505cde3c0b7`
- `20260912162100_purchase_preparation_commands.sql`: `acb035ae118356307753200c4f0dc6a678ce2b278a9778c2a7f98d0db9136da3`

## Remaining contracts and approvals

No provider dispatch/settlement/release/finalisation API exists here. Verified destination ownership, transfer and withdrawal-counter semantics, fee payer, provider attribution, split-leg sequencing/finality, uncertain-result reconciliation and authorized compensation remain unresolved. A paid/fulfillable order cannot be produced. Grace-period guarantee eligibility requires explicit product clarification. Local tests do not establish live provider behavior or authorization to deploy/provision credentials.
