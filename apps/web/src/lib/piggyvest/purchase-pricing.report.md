# READY FOR PARENT REVIEW — authenticated local purchase pricing

## Connected implementation

`apps/web/src/lib/piggyvest/purchase-pricing.ts` exports `createAuthenticatedPurchasePricing({supabase, goalId, configuration, execute}).publish(input)`. Runtime is 117 lines. The only public input fields are `{quoteId, shippingRateId, savingsKobo}`. Customer-selected savings is an authorization preference, not a balance. Actor, tenant, product, variant, condition, catalogue observation and all charges come from authenticated/server sources.

Authentication (`getUser`) is first. The builder validates input, resolves the existing fixed-goal RLS context, reads the exact merchant/customer goal and active merchant product through the current authenticated client, and reuses `resolveSavingsDeviceSelection`. Missing/inaccessible variants cannot fall back to the base price. The RLS catalogue observation is only an assertion: SQL independently rereads and locks actual catalogue rows, active pickup rate/zone, merchant tax/currency, existing goal policy, and explicit reviewed fee/tax capability. Actor/scope are revalidated before execution and before returning data. No service-role client is constructed.

The publisher inserts an enabled server-derived quote and immutable source/publication receipt atomically, then obtains the actual existing purchase quote. It creates no ledger entry. The composed test feeds that result into the existing purchase-preparation adapter and obtains one durable reservation/pending intent through the real restricted executor. There is no opaque injected full checkout quote or price/charge reader in the production builder.

## Supported charge contract

Returned shape is `{status: 'quote_available', fulfilmentMode: 'pickup', shippingRateId, pickupName, pickupAddress, taxTreatment, includedTaxKobo, feePolicyVersion, quote}`. `quote` is the existing exact purchase quote. This wrapper must be retained/displayed by a future customer binder; it is not a generic delivery quote. Published quote identity durably references the pickup source, and source checks run again before reservation. There is no order or delivery-address binder in this slice.

Only an enabled, current merchant-owned pickup rate in an active merchant zone is supported. Country is explicitly NG, currency NGN and quantity one. Non-pickup choices are unavailable, not free shipping. Fixed rates, subtotal tiers and explicit free-over thresholds follow existing merchant-rate computation semantics using the applicable quoted device subtotal. No pickup charge is defaulted. A complete stored pickup address/city is required. Stock-controlled exact device availability is checked and its inventory observation participates in source invalidation; this does not reserve inventory or revoke an existing guarantee.

An explicit per-revision reviewed capability supplies fee amount, fee-policy version, device-tax inclusion/exclusion treatment and bounded quote lifetime. No row is seeded or enabled by migrations. No missing VAT rate/category/merchant status becomes a zero tax. Registered standard-rated products calculate exclusive device VAT, or disclose included VAT without adding it twice, as explicitly configured. Explicit nonregistered/exempt/zero-rated semantics require matching not-applicable treatment. This is a reviewed local checkout-charge capability, not proof of provider fees or permission to transfer money.

The existing lower-current/guaranteed-price logic is preserved, including valid stored seven-day protected offers. New quote expiry is capped at protected-offer expiry when applicable. The existing maturity-review gate is unchanged; no guaranteeExpiresAt or grace-period forfeiture is invented.

## Source changes and replay

Migration 164200 wraps the existing quote entry point, making new preparation revalidate the saved publication against current locked source rows. Catalogue price/condition/stock, pickup mode/address/rate/zone, merchant currency/tax, reviewed capability or accepted policy changes cause rejection. The old quote implementation is private. Exact already-committed preparation replay and durable status still use the existing historical intent path; they do not require a fresh quote or establish new pricing authority. No reservation release occurs on uncertainty.

## Exact files

- `apps/web/src/lib/piggyvest/purchase-pricing.ts`, `purchase-pricing.test.ts`, `purchase-pricing-runtime.integration.test.ts`
- `apps/web/src/lib/piggyvest/purchase-pricing-statements.ts`, `purchase-pricing-statements.test.ts`
- `apps/web/src/schemas/purchase-pricing.ts`, `purchase-pricing.test.ts`
- `supabase/migrations/20260912164000_purchase_pricing_sources.sql`
- `supabase/migrations/20260912164100_purchase_pricing_publish.sql`
- `supabase/migrations/20260912164200_purchase_pricing_revalidation.sql`
- `tools/test/purchase-pricing-local.sh`, `purchase-pricing-setup.sql`, `purchase-pricing-fixture.sql`, `purchase-pricing-cases.sql`, `purchase-pricing-source-changes.sql`

The exact catalog statement (registered by parent, not edited here) is `SELECT piggyvest_purchase_pricing.publish($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb) AS result`. Six parameters: existing scope indices 0..4, strict command JSON including server actor at index 5. Role is only `piggyvest_staging_policy_writer`; local database/socket restrictions remain enforced. Migrations do not seed invocation grants, capabilities or a global rollout.

## Validation

- Initial TDD RED: new module absent. Colocated unit/schema/statement tests now GREEN: five tests across three files.
- Direct SQL first caught the NG country versus NGN currency typo and an invalid PL/pgSQL variable qualifier; these were fixed before freeze.
- Exact source-revalidation regression RED: temporarily disabling the equality guard allowed a changed pickup rate to reuse the stale quote; `purchase-pricing-cases.sql:24` failed its expected-rejection assertion, exit 3. Restoring the guard produced GREEN. No mutation remains.
- Final `bash tools/test/purchase-pricing-local.sh` exited zero: five composed tests pass using real PostgreSQL RLS reads, actual builder, actual registered restricted executor, actual publisher and existing preparation. Authentication identity is synthetic; the minimal public schema and source rows are synthetic, but pricing reads and SQL are real, not mocked quote outputs.
- SQL cases additionally prove included/exclusive/not-applicable tax, missing VAT rejection, stale observed price rejection, explicit capability/ACL denial and immutable fee policy. A nine-case matrix rejects changed pickup mode/address/rate, tax, disabled fee approval, variant price, stock changes/zero stock and merchant currency before reservation.
- Integration rejects a catalogue change between the frontend RLS observation and locked publication with no stored quote. It also rejects changed catalogue after publication, while exact previously committed preparation replay and status remain available.
- Scoped Biome passes; all new runtime/schema files remain below 300 lines. The harness exits and stops its own disposable PostgreSQL. Parent owns full typecheck/lint/tests and independent final review.

## Frozen SHA-256

- 164000: `f1ee8116a260563fd531500019d05b2ce2f5c41b47d4a5f2f61b7ddea21aec71`
- 164100: `eac7374fd5e3777315da2ce4928e1d13e13f8569e33f67139090923d88b6e3af`
- 164200: `e66b0baff7357c39ba87c341ce59551f1fbeb4d979bd4600362c5c09d58ed997`

Frozen 162000 and 162100 remain unchanged (`d7a8a3671ff3233da097c0deba8b56ca5ae908a9fed54ded510c9505cde3c0b7` and `acb035ae118356307753200c4f0dc6a678ce2b278a9778c2a7f98d0db9136da3`).

## Remaining connections and true external gates

Authenticated HTTP/CSRF and customer presentation bindings remain local integration work for parent; this is an authenticated server builder, not a deployed route. Carrier delivery and other checkout capabilities are unavailable until their exact server-owned address/charge validation is connected; no external shipping call was made. Existing fixture-only quotes remain isolated legacy test inputs, not production pricing authority.

Provider financial attribution, verified settlement destination, actual fees, split-leg finality/reconciliation/compensation, grants and deployment authorization remain external approval/contract gates. No actual order, payment route, Paystack/webhook, provider operation, credential, real customer data/funds, infrastructure or environment file was touched. This report does not claim a full product or live integration.
