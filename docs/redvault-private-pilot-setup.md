# REDVAULT private pilot setup

The pilot code remains unavailable by default, and live activation remains off. Do not enable it until all gates below are verified on the selected deployment and database. Local migration/regression results do not establish live readiness. This document does not authorize catalog or production changes.

## Operator gates

1. Resolve `basseybjjohn@gmail.com` through the selected deployment's authenticated user directory and confirm the immutable user ID is `70261bce-d358-45a4-9ede-8b9d71fb3bd9`. Never use a request email as authorization.
2. Resolve the immutable Ogabassey merchant ID in that same database and confirm the active domain routes to it.
3. Create a new, dedicated Ogabassey product through the reviewed merchant catalog workflow. Set its authoritative price to NGN 100, use no variants, and do not reuse or reprice an existing retail product. Record its product UUID.
4. Confirm tax category/rate and verify the exact payable total from the normal tax calculation. The pilot discount is NGN 5; the total is not hard-coded to NGN 95.
5. Obtain Paystack's documented confirmation for UBA bank/card filters and issuer verification. A test issuer or one successful card does not satisfy this gate. Keep PAN entry on Paystack.
6. Verify that card checkout retains the bank and card-brand restrictions in the selected live environment. Do not send a charge until the owner approves the specific attempt.

## Server configuration

Configure server-only values only after all gates are independently reviewed:

- `BACI_RUNTIME_ENV=production`
- `VERCEL_ENV=production`
- `REDVAULT_LIVE_PILOT_SUPABASE_URL=<exact same URL as NEXT_PUBLIC_SUPABASE_URL>`; it must be an HTTPS hosted `*.supabase.co` URL with no credentials, query, fragment, or path. This runtime binding prevents leaked live flags from enabling the pilot in local or preview environments; database policy remains independently required.
- `REDVAULT_LIVE_PILOT_ENABLED=true`
- `REDVAULT_LIVE_PILOT_MERCHANT_ID=<verified Ogabassey merchant UUID>`
- `REDVAULT_LIVE_PILOT_PRODUCT_ID=<new dedicated product UUID>`
- `REDVAULT_LIVE_PILOT_EXPIRES_AT=<short UTC expiry>`
- `REDVAULT_LIVE_PILOT_MAX_ATTEMPTS=1`
- `REDVAULT_LIVE_PROVIDER_EVIDENCE=confirmed`
- `PAYSTACK_SECRET_KEY` must be the selected live environment's secret; never place it in public/mobile configuration.

The live policy refuses startup eligibility unless the production runtime/database binding, merchant, product UUID, expiry, single-attempt cap, provider evidence marker, and live key mode are all present. These application checks do not replace database reservation limits.

The append-only database migration `20260928120000_uba_redvault_private_live_pilot.sql` installs a private policy that defaults disabled with no product configured. After the dedicated product UUID and short expiry are reviewed, a database owner configures the matching database through `private.configure_uba_redvault_live_pilot(true, '<product UUID>', '<UTC expiry>')`. The database checks that the product belongs to Ogabassey, costs NGN 100, has no variants, and has no prior order items. Keep this owner-only function call in the approved database change record; it accepts expiries no more than 14 days ahead. Disable with `private.configure_uba_redvault_live_pilot(false, NULL, NULL)`. Do not configure a different user or merchant: the database fixes these to the pilot user and Ogabassey merchant. Pilot order validation runs while the protected order-creation transaction is still open, so an invalid draft rolls back before inventory reservations can remain. The first protected payment-attempt reservation atomically binds the product, user, merchant, order, exact quantity/price/discount, and attempt. It claims the single pilot-wide attempt slot; retries of that order reuse its existing attempt, while a different order cannot reserve another charge. Reservation, initialized-URL replay, and initialization claim paths check expiry. Once an attempt is reserved, disabling preserves its order/product/attempt binding, physical fulfillment stays blocked, and the cap cannot be reset by reconfiguration. A spent or expired pilot requires a separately reviewed append-only reset mechanism; never delete or edit the binding rows to reopen it.

## After setup

Apply `20260929100000_uba_redvault_pilot_legacy_and_shipment_guards.sql` after the private-pilot migration and before any activation. It revokes direct legacy reserve/claim v1/v2 execution while keeping internal SECURITY DEFINER calls intact, and adds shipment insert/update guards. The currently deployed app must use v3 exclusively; verify that before revoking old entrypoints. A pilot must never be activated with only the earlier migration installed.

Run the focused REDVAULT order creation, payment initialization, webhook, and database concurrency suites against mocks or a disposable isolated database. Confirm excluded users, products, quantities, fees, expiry, and retries fail closed. Confirm the protected public reservation RPC rejects a different order under concurrent attempts, while ordinary non-pilot REDVAULT customers retain existing behavior. Keep captured orders held until issuer evidence is independently verified; pilot physical fulfillment remains blocked even after an approval record.

## Implementation verification — 28 September 2026

- Web REDVAULT and initialization suites: 486 tests passed; checkout-page suite: 51 tests passed. Web TypeScript check passed.
- Mobile REDVAULT service and checkout payment controller: 13 tests passed.
- Disposable PostgreSQL attempt/concurrency runner passed: one pilot-wide reservation winner, safe same-order replay, expiry denial, unauthorized-user denial, wallet/savings rejection, draft rollback after the cap, retained fulfillment hold after disable, and private grants. This runner uses bounded v3 test shims; it is not full production-RPC end-to-end proof.
- Ordered legacy migration smoke passed with the new default-off migration and grants checks. That harness does not replay every later review migration.
- Separately applied the migration inside a rolled-back transaction on `supabase_db_baci-redvault-local`, whose migration history includes REDVAULT round 36. Confirmed the initialization-claim RPC retains `split_retained_shipping_kobo`. No persistent local schema change or production change was made by that check.
- Not verified here: deployed pilot behavior or a real UBA payment. Dedicated product creation, provider evidence, deployment, and activation remain outstanding. No live charge was attempted.

## Follow-through — 29 September 2026

- Refreshed the official Paystack metadata documentation: bank and card-brand filters are documented together at https://paystack.com/docs/payments/metadata/. That page does not establish exact eight-digit BIN enforcement or live issuer values.
- Sent the owner-authorized integration enquiry from `j.bassey@ogabassey.com` to `support@paystack.com`. Zoho Sent metadata independently confirms message `1790663272005138300` with delivery status `success`. Provider answers are still pending; sending the enquiry is not provider approval.
- Read-only production inspection confirmed REDVAULT runtime disabled, commercial terms not confirmed, and private pilot migration absent. No production setting was changed.
- Source inspection found the old below-threshold 10% shared pricing rule still present, inconsistent with the pilot's 5% guard. The release must include the shared pricing correction and `20260928110000_uba_redvault_fixed_five_percent.sql` before the pilot migration. The migration preserves existing application records and does not alter discount codes or activate the campaign; a non-5% binding fails closed.
- Full-schema regression now passes through the actual order-create/proof-attachment/reserve-v3/claim-v3 functions, without replacement RPCs. Independently rerun `sh supabase/migrations/tests/run-redvault-private-pilot-full-schema.sh`; its fixture and migrations roll back, and it makes no provider request. This closes the earlier simplified-RPC coverage gap, not the deployed browser/payment gate.
- Created the dedicated production catalog draft `f6f4261f-8cc8-42c4-941c-e8d3483c6628`, SKU `UBA-REDVAULT-PILOT-100`, for Ogabassey at NGN 100 with no variants. Its description explicitly prohibits physical fulfillment. Status remains `draft`; a read under the database's `anon` role returned zero visible rows for this ID. No existing product was repriced. Tax configuration must still be reviewed before activation.

## Isolated release validation — 29 September 2026

- Ported only the REDVAULT changes onto main commit `c69bac21ea0a38a346416b873c71da71cc46776e` in `/Users/mac/Baci-worktrees/redvault-pilot-release`. The unrelated Savings worktree is not a release source.
- On this checkout, the focused web/payment/checkout selection passed 502 tests; the order-route suite separately passed 139 tests. Shared REDVAULT tests passed 28 tests. Mobile REDVAULT/controller tests passed 141 tests across 21 suites when run with exact test paths.
- A concurrent broad test run caused a five-second native-render test timeout; the unchanged focused mobile suite passed when run without unrestricted web workers. The interrupted broad run is not an all-tests pass.
- The actual local full-schema order/proof/reserve/claim test, ordered migration smoke, and bounded concurrency runner passed. Test migrations and synthetic full-schema fixtures were rolled back. These are not deployed-provider tests.
- Review identified two additional release blockers: legacy callable reservation/claim paths need the same pilot expiry restrictions, and direct shipment writes need the pilot fulfillment prohibition. These require follow-up migration and regression evidence before release.
- The original catalog draft remains unpublished. Its observed tax settings are standard category `S`, taxable, with rate 7.5%; do not change tax classification or promise a NGN 95 final total without review.
- CodeRabbit reviewed all 39 scoped files, including new migrations and helpers, and raised two minor suggestions: per-helper environment cleanup and using resolved availability instead of the explicit pilot flag. The test file already restores all stubbed environment values in its root `afterEach`; the explicit flag deliberately keeps malformed pilot configuration fail-closed. No change was made for those suggestions. An earlier review's concurrency-output assertion was tightened to exact boolean lines and the concurrency runner passed again. This review predates the follow-up legacy-RPC/shipment hardening and is not approval of those later changes.
- Closed the legacy-RPC and shipment bypass findings with `20260929100000_uba_redvault_pilot_legacy_and_shipment_guards.sql`. Independently reran the real full-schema regression: protected v3 flow, legacy permission denial, non-pilot compatibility, shipment insert/update denial after disable, cap, and expiry all passed. Rollback was verified by the absence of the policy and shipment guard afterward. Ordered migration smoke now includes this follow-up and also passes.
- Fixed stale positive web availability across same-status account changes by including a monotonically increasing session revision in the availability request key. Updated focused web/order/session checks pass 656 tests across 53 files.
- The complete mobile storefront Jest suite passes: 1,197 suites, 7,055 tests, one snapshot. This is local mocked validation, not a live Paystack test.
- Final monorepo lint passes (four tasks; nine existing web warnings) and monorepo typecheck passes (six tasks). The order-route regression was rerun after fixing its fixture typing: 139 tests pass.
- Final CodeRabbit review covered all 42 scoped files and raised two trivial suggestions, with no critical or major issue reported. Applied the missing follow-up migration to the ordered smoke test and verified it passes. Retained the stricter wallet guard instead of weakening it to run only when the wallet amount changes; invalid nonzero pilot wallet state must still fail closed.
- The unrestricted full web run is not a pass: it was interrupted after historical replay-tool tests reported failures. Focused REDVAULT checks pass, but broad web-suite status must not be represented as green or used as deployment approval.
- Diagnosed those replay failures as the missing registry entries for the four new SQL migrations. Registered their independently verified SHA-256 hashes in the existing REDVAULT pending-source list, updating its pinned count from 77 to 81 without changing verifier logic or historical/base hashes. All four focused manifest/replay test files now pass (27 tests). The complete web suite has not been rerun to completion after this repair.
- Full shared-package tests also pass: 187 suites, 1,273 tests. No deployment, activation, or real payment is included in these results. The owner approved committing and opening the follow-up PR on 29 September; that approval does not enable live payments.
