# REDVAULT checkout final acceptance — local frontend/mobile slice

## Scope and result

This record covers the actual Ogabassey website and mobile storefront checkout/callback consumers only. It does not approve REDVAULT activation, a real payment, provider configuration, migration application, deployment, or release.

- Website availability is fail-closed for every merchant until external provider evidence exists; non-Ogabassey requests receive a false result without querying private availability state.
- Mobile availability is fail-closed for every non-Ogabassey merchant before a network request, and remains false unless the server returns an affirmative availability response.
- Both surfaces present the server-persisted REDVAULT quote as received. The tier explanation is 10% below 20,000,000 kobo eligible merchandise subtotal and 5% at or above it; excluded merchandise and fees do not affect the threshold.
- Native checkout no longer displays an ordinary discount after a shopper switches to REDVAULT. The protected request already excluded that code; this correction removes the stale client-side total deduction as well.
- Web and native callback behavior preserves the cart for cancellation, pending, held, reconciliation, and failed verification. Only a server-verified paid transition clears the cart and proceeds to success.

## Local verification

- `pnpm --filter @baci/mobile-storefront exec jest --runInBand services/redvault.test.ts components/checkout/CheckoutScreenView.redvault-discount.test.tsx components/checkout/redvault/get-redvault-compatible-discount.test.ts components/checkout/redvault/RedvaultPaymentChoice.test.tsx components/checkout/redvault/RedvaultOrderReview.test.tsx components/payment-gateway/payment-gateway-completion-handlers.test.ts components/payment-gateway/payment-gateway-event-handlers.test.ts` — passed: 7 suites, 33 tests.
- `pnpm --filter @baci/web exec vitest run src/components/storefront/ogabassey/pages/checkout/components/redvault/RedvaultPaymentOption.test.tsx src/components/storefront/ogabassey/pages/checkout/hooks/use-redvault-payment-availability.test.ts src/app/'(storefront)'/'[slug]'/'(commerce)'/checkout/success/verify-checkout-payment.test.ts src/lib/checkout/redvault-payment-availability.test.ts src/app/api/payments/redvault/availability/route.test.ts` — passed: 5 files, 33 tests.
- `pnpm --filter @baci/mobile-storefront typecheck` — passed.
- `pnpm --filter @baci/web typecheck` and `pnpm turbo typecheck` — blocked by an in-progress REDVAULT error in `apps/web/src/lib/payments/redvault-payment-gate.test.ts` where one mock union member has no `data` property. Mobile typecheck completed successfully.
- `pnpm turbo lint` — this frontend/mobile slice has no lint errors after formatting. The aggregate command remains blocked by in-progress REDVAULT formatting/import diagnostics in `apps/web/src/lib/payments/redvault-payment-gate.test.ts`, `apps/web/src/lib/payments/redvault-payment-gate.ts`, and `apps/web/src/lib/payments/redvault-refund-paystack-provider.test.ts`; existing mobile warnings remain separate.

## Unresolved external gates

### Physical devices

No iOS simulator/device or Android emulator/device checkout was launched for this slice. Physical iOS and Android acceptance remains required in an authorized nonproduction environment, including WebView return/cancel/back navigation and cart persistence.

### Provider evidence

No Paystack/UBA request, real card entry, PAN/BIN collection, real payment, or provider configuration change occurred. The accepted hosted bank-filtered route still requires reviewed issuer coverage for the supplied Verve, Visa, and Mastercard inputs, trusted server-side verification evidence, and confirmation that settlement/subaccount behavior cannot release discounted value before approval.

### Release and quality

Availability remains disabled. Commercial policy inputs, positive eligible-payment approval, authorized operational recovery transport, full database replay, final aggregate validation, and a clean final patch review remain outside this local acceptance record.
