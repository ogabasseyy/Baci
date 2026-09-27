# Phase 4B — Actual mobile integration evidence

## Completed slice

- Wired the actual iOS/Android checkout screen, payment controller, order service and hosted payment gateway. No demo route or platform-specific fork was introduced.
- Availability uses the existing storefront API base and checkout authorization, no-store and a bounded request. Missing/error/malformed responses and non-Ogabassey merchants fail closed. Merchant-keyed state prevents stale availability on tenant changes; rejected availability requests are handled.
- Orders use `payment_method: uba_redvault`; the checkout-attempt namespace distinguishes protected orders from ordinary payment selections. Store-credit and discount-code combinations are rejected. Leaving the server review discards its order/quote and resets payment selection; ordinary checkout remains separate.
- Consumes the frozen `phase3-contract.md` order response and all exact persisted quote fields: `product_subtotal_kobo`, `eligible_subtotal_kobo`, `ineligible_subtotal_kobo`, `discount_kobo`, `tax_kobo`, `shipping_kobo`, `gift_wrapping_kobo`, `payable_kobo`, and `mixed_basket`. The complete schema validates consistency and rejects incomplete quotes; the review never substitutes cart totals or computes discount amounts.
- The customer reviews those persisted totals before initialization. Initialization sends the protected order ID, contact data, `payment_method: uba_redvault`, and `gateway: paystack`; it sends no frontend discount authority. The gateway receives the persisted order amount.
- Initialization HTTP 202 remains unconfirmed, not captured/received. The review prevents repeating initialization. Hosted callback/message success is only a trigger to verify the bound server reference; it cannot independently clear the cart or show success.
- Verification pending/error leaves the cart intact; only explicit `REDVAULT_CAPTURE_HELD` evidence uses received/held copy. Retry checks the same reference rather than reloading checkout or creating a new charge. Verified success preserves ordinary completion/navigation behavior.
- Fixed Jest mock type inference using typed Jest imports/signatures and explicit renderHook props. Added success, pending, held, error and duplicate completion assertions plus availability rejection/merchant-change regressions.
- Extracted presentation helpers; all changed mobile source/test files remain at or below 300 lines.

## Local validation

All Jest runs used `pnpm --filter @baci/mobile-storefront exec jest --runTestsByPath` with exact file paths and `--runInBand --watchman=false`. All external requests were mocked; no provider or production calls were made.

- Main focused integration/regression run: **18 suites, 171 tests passed**. Covers frozen schemas, actual order/availability/initialize route integration, controller, review, payment finalization, submit/recovery, checkout screen regressions, completion/gateway handlers, ordinary orders and payloads. Log: `/private/tmp/redvault-mobile-final-tests.log`.
- Final review/discount/pending-copy checks: **3 suites, 8 tests passed** (includes rerunning the four actual order-review route integration tests after the typed Jest fix). Log: `/private/tmp/redvault-mobile-final-extra-tests.log`.
- Extracted overlay/initializer checks: **2 suites, 2 tests passed**. Log: `/private/tmp/redvault-mobile-extraction-tests.log`.
- `pnpm turbo typecheck --filter=@baci/mobile-storefront`: **passed**, full mobile `tsc --noEmit`. Log: `/private/tmp/redvault-mobile-final-types.log`. Supersedes the parent's earlier TS2743 and `result.current` diagnostics.
- Biome check of all 39 changed/new mobile files: **passed**, no fixes outstanding. Log: `/private/tmp/redvault-mobile-final-lint.log`. Removed the test export flagged by the parent's lint3 run.
- `pnpm turbo lint --filter=@baci/mobile-storefront`: **passed**, 20 existing warnings outside the changed-file check. Log: `/private/tmp/redvault-mobile-scope-lint.log`.
- `git diff --check -- apps/mobile-storefront`: **passed**.

## Boundaries and remaining gates

- No mobile implementation/typecheck blocker remains in this assigned slice. Parent owns backend/web review and aggregate checks; the parent's reported nonmobile full-suite failures are not represented as passing here.
- Availability remains disabled by the server pending provider evidence. No activation, deployment, native device payment acceptance, actual charge, webhook reconciliation, or release acceptance is claimed.
- Backend/shared/SQL/proxy/environment files were not edited by this mobile slice. No remote, provider, production, deployment, branch, commit, push, email, install or subagent operation was performed.

**READY FOR PARENT REVIEW — MOBILE INTEGRATION**
