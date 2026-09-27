# Phase 4A — Web REDVAULT integration

**Status:** READY FOR PARENT REVIEW — WEB INTEGRATION. This is not release-ready and does not activate REDVAULT.

## Scope completed

### Owner MOU tier change — web and mobile presentation

- Updated both REDVAULT payment choices to state **10% below ₦200,000 eligible pre-discount subtotal; 5% at ₦200,000 or more**. Excluded products and fees explicitly do not count toward the threshold. Removed the fixed-5% badge/caption and fixed-rate mixed-basket explanation.
- Copy is visible before a quote exists. Neither client selects a rate or computes a discount; displayed savings and payable totals still come exclusively from the server summary. SQL 912/shared pricing/backend changes remain with their respective owners.
- Colocated tests cover eligible subtotals immediately below, exactly at, and immediately above the threshold, mixed baskets with larger product totals/fees, pre-quote presentation, and preservation of deliberately distinct server discount/payable values rather than local recalculation. Both new tier-copy suites failed before the copy change.
- Focused web command: `pnpm --filter @baci/web exec vitest run --maxWorkers=1 src/components/storefront/ogabassey/pages/checkout/components/redvault/RedvaultPaymentOption.test.tsx src/components/storefront/ogabassey/pages/checkout/components/PaymentOptionsPanel.test.tsx src/components/storefront/ogabassey/pages/checkout/components/PaymentStep.test.tsx src/components/storefront/ogabassey/pages/checkout-page.test.tsx` — **4 files / 141 tests passed** (`/private/tmp/redvault-tier-web-tests.log`).
- Focused mobile command: `pnpm --filter @baci/mobile-storefront exec jest --runInBand --runTestsByPath components/checkout/redvault/RedvaultPaymentChoice.test.tsx components/checkout/redvault/RedvaultOrderReview.test.tsx` — **2 files / 16 tests passed** (`/private/tmp/redvault-tier-mobile-tests.log`). Mobile AGENTS instructions were read; no platform branches were added.
- `pnpm turbo typecheck --filter=@baci/web --filter=@baci/mobile-storefront` and matching scoped turbo lint passed. Existing web dependency warning remains. All four presentation/test files additionally passed scoped Biome stdin checks; `git diff --check` passed. Web option is 195 lines; mobile choice is 282 lines.
- Presentation-only follow-up under the expanded owner scope: no SQL/shared pricing/backend changes, activation, deployment, or commit. Backend tier implementation and acceptance remain separate from these passing client tests.
- Final rerun after parent shared-tier completion: the exact focused commands above passed again, **web 4 files / 141 tests**, **mobile 2 files / 16 tests**. Logs: `/private/tmp/redvault-tier-web-final.log` and `/private/tmp/redvault-tier-mobile-final.log`. Stored historical summaries (including 5% below ₦200,000) remain renderable unchanged; no rate inference from rounded ratios or client repricing was introduced. This evidence covers presentation and regression tests, not backend pricing acceptance. `git diff --check` passed.

- Added the public, no-store availability endpoint. It validates `merchant_id`, exposes only `{ available, reason }`, returns false for every non-Ogabassey merchant, and calls no database or provider.
- Wired the Ogabassey checkout to fetch that server result. The payment choice remains hidden by default and on network or response errors; no frontend toggle can expose it.
- Persists `uba_redvault` rather than normalizing to a generic card method, sends the explicitly isolated Paystack initialize request, and does not reuse a prior ordinary or REDVAULT pending order after a method switch.
- Parses only the frozen server REDVAULT quote fields and never calculates savings in the browser. `202 REDVAULT_RECONCILIATION_REQUIRED` stays pending; only an explicit `REDVAULT_CAPTURE_HELD` response can use received-payment hold copy.

## Final parent-review corrections

- Consumes every exact snake_case field from the frozen summary: product, eligible, ineligible, discount, tax, shipping, gift wrapping, payable, and mixed-basket flag. Missing or invalid values fail closed. Display and gateway due use persisted payable kobo without a client-total fallback.
- Extracted parsing into `parse-redvault-order-quote.ts` (42 lines) and initialization into `redvault-payment-response.ts` (78 lines), each with colocated tests. The payment panel's props are extracted into a type module; its source is 284 lines.
- Initialization uses the real CSRF-aware helper; a regression checks the CSRF header, JSON content type, and included credentials. Unrecognized 202 responses cannot redirect using an authorization URL.
- Availability hides immediately for a changed merchant; colocated tests cover network, HTTP, malformed/disabled responses, abort on unmount, and late responses.
- Actual checkout tests cover both reconciliation-required and capture-held responses, exact request fields, the full frozen display, and absence of paid navigation. Pending/held submission is guarded against repeat payment.
- REDVAULT uses a separate idempotency fingerprint and a persisted method marker. Generic pending-order reuse rejects REDVAULT snapshots.
- Both web CodeRabbit findings in `/private/tmp/redvault-final-review.log` were valid and addressed: panel availability/selection/error/held rendering and PaymentStep selection preservation/revocation. Backend and mobile findings remain with their respective owners.

## Final validation (2026-09-12)

### Actual callback route — final parent gap closed

- Status: **READY FOR PARENT REVIEW — WEB INTEGRATION** (not release-ready).
- The real `/[slug]/checkout/success` page now delegates verification to colocated `verify-checkout-payment.ts` (161 lines). No alternate/demo callback was introduced.
- Reference callbacks retain the cart and pending-order storage for HTTP 202 and explicit REDVAULT capture-held, evidence-review, or reconciliation-required results. None can become success through a contradictory success flag.
- An orderId-only lookup identified by server `payment_method: uba_redvault` stays pending unless `payment_status` is exactly `paid`, including missing payment status or missing order number. Existing invoice/pay-on-delivery success and unknown-order network fallbacks remain unchanged.
- Added actual-page regressions in `page.redvault.test.tsx` and helper regressions in `verify-checkout-payment.test.ts`; the existing callback suite still passes. Reference verification retains the CSRF-aware JSON POST.
- Final exact-file `pnpm --filter @baci/web exec vitest run --maxWorkers=1` across the nine checkout files listed above and the three callback files passed **12 files / 214 tests**. Output: `/private/tmp/redvault-web-final-tests.log`. The isolated three callback files passed **27 tests**; output: `/private/tmp/redvault-callback-tests.log`. The unpaid-order regressions failed before the guard was added.
- Final `pnpm --filter @baci/web exec tsc --noEmit --pretty false` passed; output: `/private/tmp/redvault-web-final-typecheck.log`.
- Final `pnpm turbo lint --filter=@baci/web` passed, retaining only the unrelated existing `use-persisted-state.ts` dependency warning; output: `/private/tmp/redvault-web-final-lint.log`. Scoped Biome formatted/checked the callback page, helper, and new tests. `git diff --check` passed.
- Availability remains server-disabled. Backend acceptance and reviewed provider eligibility/settlement evidence are still release blockers. This callback follow-up changed no backend route, migration, mobile, proxy, environment, provider, or deployed state.

### Callback test stability correction (parent independent rerun)

- Parent log `/private/tmp/redvault-final-callback.log` superseded the earlier single passing callback run: the new held-capture test failed on a detached `#RV-HELD` node; checkout-page itself passed.
- Root cause was the callback test harness: `useRouter` returned a new object each render, the motion proxy returned new component types, and verification reused a single consumable `Response`. Repeated effects consumed the body again and replaced the held order display through the network-error fallback.
- Fixed only `page.redvault.test.tsx`: stable router and motion component identities, a fresh Response for each verification request, and explicit StrictMode replay plus rerender assertions preserving the same connected order node and pending/cart state. The strengthened pre-fix regression failed with four verification calls instead of the two StrictMode calls, alongside consumed-body errors (`/private/tmp/redvault-callback-replay-red.log`). No checkout production behavior or assertions were weakened.
- Exact parent command: `pnpm --filter @baci/web exec vitest run 'src/app/(storefront)/[slug]/(commerce)/checkout/success/' src/components/storefront/ogabassey/pages/checkout-page.test.tsx --no-file-parallelism`.
- After correction, that command passed **three consecutive runs, 4 files / 73 tests each**, with no consumed-body errors. Logs: `/private/tmp/redvault-callback-converged-1.log`, `/private/tmp/redvault-callback-converged-2.log`, `/private/tmp/redvault-callback-converged-3.log`.
- Web `tsc --noEmit --pretty false`, scoped Biome, and `git diff --check` passed. No activation, deployment, or policy relaxation.

### Earlier checkout validation

- Exact exec Vitest run: 9 files, 184 tests passed across availability route, quote parser, availability hook, initialization helper, REDVAULT option, PaymentOptionsPanel, PaymentStep, pending-order reuse, and actual checkout page.
- Subsequent `pnpm --filter @baci/web exec vitest run --maxWorkers=1 src/components/storefront/ogabassey/pages/checkout/pending-checkout-order.test.ts` passed: 1 file, 20 tests, including three added cases for method normalization and generic reuse exclusion (187 unique tests across the final slice).
- `pnpm --filter @baci/web exec tsc --noEmit --pretty false` passed.
- `pnpm turbo lint --filter=@baci/web` passed; only the pre-existing `use-persisted-state.ts` dependency warning remains. Scoped route/test Biome passes, including the type-only NextRequest import. New parser/helper/hook/option modules were additionally checked and formatted through Biome stdin because the repository excludes Ogabassey paths from the default lint scan.
- `git diff --check` passed.

The server availability helper still returns false, so the real offer remains hidden. Release remains blocked on parent backend acceptance and reviewed provider eligibility/settlement evidence. No activation or deployment was performed.

## Validation

- `pnpm --filter @baci/web exec vitest run --maxWorkers=1 src/app/api/payments/redvault/availability/route.test.ts src/components/storefront/ogabassey/pages/checkout/components/redvault/RedvaultPaymentOption.test.tsx src/components/storefront/ogabassey/pages/checkout/components/PaymentOptionsPanel.test.tsx src/components/storefront/ogabassey/pages/checkout/components/PaymentStep.test.tsx src/components/storefront/ogabassey/pages/checkout/pending-checkout-order.test.ts` — 5 files / 106 tests passed.
- `pnpm --filter @baci/web exec vitest run --maxWorkers=1 src/components/storefront/ogabassey/pages/checkout/redvault-payment-response.test.ts src/components/storefront/ogabassey/pages/checkout/components/redvault/RedvaultPaymentOption.test.tsx` — 2 files / 11 tests passed, including CSRF-aware init fields and distinct reconciliation/capture-held `202` responses.
- `pnpm --filter @baci/web exec vitest run --maxWorkers=1 src/components/storefront/ogabassey/pages/checkout-page.test.tsx` — 1 file / 45 tests passed, including mocked availability, protected order response, and pending reconciliation flow.
- `pnpm --filter @baci/web exec tsc --noEmit --pretty false` — passed.

No provider, production, deployment, commit, branch, push, email, mobile, migration, payment-route, order-route, proxy, or environment change was made. Parent review must confirm the backend contract before any release decision.
