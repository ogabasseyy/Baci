# Native protected-offer display — READY FOR PARENT REVIEW

## Exact owned files

Under apps/mobile-storefront/components/wallet/savings:
- NEW PiggyvestProtectedOffer.tsx and PiggyvestProtectedOffer.test.tsx
- NEW PiggyvestProtectedOfferBinding.tsx and PiggyvestProtectedOfferBinding.test.tsx
- NEW StartSavingsScreen.offer.test.tsx
- MODIFIED PiggyvestSavingsScreen.tsx and PiggyvestSavingsScreen.types.ts
- NEW this report

The optional `staging.protectedOfferBinding` accepts the real shared protected-offer controller. The existing staging branch is retained; absence preserves existing rendering. No routes, shared schemas/controllers, funding gates or other agents' files were changed. Main screen287 lines; runtime modules remain below300.

## Behavior

The native display consumes strict shared server observations, including requested offer identity/canonical receipt handled by the shared controller. It displays recorded exact device price, source-bound product/variant/condition, seven-day start/expiry, terms version and explicit server-observed active/expired/historical state as of observedAt. It does not compare against device/browser time, derive active status, add acceptance consent or authorize checkout/funding.

The seven-day promise is honoured through the recorded window despite catalogue rises. Expired/historical observations do not cancel a still-valid original guarantee. Checkout must review current funds/reservations and additional delivery/tax/fees; no stock reservation, purchase, collection or provider dispatch follows. Failed or pending refresh removes the prior observation instead of falling back to a cached active receipt. Source/session replacement and unmount leases protect stale requests. Refresh publishes at most once per explicit controller lifetime, then performs status reads; history mode never publishes. A missing/invalid offer is locally unavailable, not a new financial eligibility gate.

## Verification and freeze

RED: absent display module and missing optional parent screen branch; GREEN after implementation. Final focused command:

```sh
pnpm --filter @baci/mobile-storefront exec jest --runInBand --runTestsByPath components/wallet/savings/PiggyvestProtectedOffer.test.tsx components/wallet/savings/PiggyvestProtectedOfferBinding.test.tsx components/wallet/savings/StartSavingsScreen.offer.test.tsx components/wallet/savings/StartSavingsScreen.combined.test.tsx components/wallet/savings/PiggyvestSavingsScreen.test.tsx
```

**5 suites / 34 tests passed**, `/tmp/piggy-native-offer-final.log`. Includes nine new tests, the all-five-operation mounted regression and existing screen coverage. Exact client integration uses the real shared bounded HTTP client/controller and native screen with injected synthetic Response streams (POST/GET/GET); it is not a socket/PG or installed-native transport claim.

Native `pnpm --filter @baci/mobile-storefront exec tsc --noEmit --incremental false` exit0: `/tmp/piggy-native-offer-types.log`. Scoped Biome7 files passed: `/tmp/piggy-native-offer-biome.log`. Existing Watchman/Jest force-exit warnings remain. Full native was NOT repeated; the earlier1009-suite/6013-test run precedes this additive slice.

Hooke bounded source review found no actionable P1/P2. Owned source is stable/frozen for parent review; parent owns root and real-backend acceptance. The existing native networking/authentication limitations remain documented in PiggyvestPurchase.report.md. No credentials, provider calls, native installs/launches, environment/configuration changes, migrations or held browser fixtures were touched.
