# Native purchase connection — local review checkpoint

## Implemented scope

Actual StartSavingsScreen's existing optional staging branch renders purchase quote/confirmation/status/recovery through PiggyvestSavingsScreen, without mounting the legacy contribution/card controller. Optional purchaseBinding and purchaseSelection use the shared purchase schema/controller; optional scheduleBinding consumes Leibniz's native component. No routing, environment, storage or production activation flag was added.

Exact device display comes from the bound server policy source; the shared controller correlates the quote to that immutable revision, condition, goal and terms. New pickup selection supplies identifiers and savings allocation, never a client price. No default duration is inferred. Money uses the shared exact-cent formatter. Preparation is local reservation only, not purchase completion, provider settlement or fulfilment. Historical receipt and current internal-ledger observation are labelled separately. Recovery never authorizes funds use or retry.

Funding/progress disappear immediately for pending/uncertain/prepared purchase or cancellation and pending/unavailable schedule. Pure subscription snapshots and live sibling checks protect captured callbacks before rerender. Source leases and controller-to-transport view guards recheck after CSRF waits; own pending status does not block its own HTTP request. Invalid present bindings fail closed; omission preserves legacy behavior. Controller lifetime/operation must be retained by the authenticated owner; reload uses recovery mode and original operation, not a new ID. The UI never updates balances or revokes a provider account.

## Owned files

All relative to apps/mobile-storefront/components/wallet/savings:

- NEW PiggyvestPurchaseReview.tsx + .test.tsx
- NEW PiggyvestPurchaseBinding.tsx + .test.tsx
- NEW use-piggyvest-funding-gate.ts + .test.ts
- NEW StartSavingsScreen.purchase.test.tsx
- NEW StartSavingsScreen.operations.test.tsx
- NEW PiggyvestCancellationBinding.transport.test.tsx
- MODIFIED PiggyvestSavingsScreen.tsx, PiggyvestSavingsScreen.types.ts, PiggyvestCancellationBinding.tsx
- NEW this report

Shared schema/client/controller, formatter, barrel exports and schedule-specific component remain their assigned owners' work. No SQL, catalog, registry or migration edits. Runtime files: review156, binding182, screen207, cancellation131, hook47 lines at this checkpoint.

## Evidence

- Initial purchase review RED: missing component; GREEN4. Actual screen RED5 before optional binding existed; GREEN5 after integration.
- Exact regression RED: replacing callback reopened an uncertain command. GREEN with canonical goal/operation attempt retention, including case-only operation spelling; original command bytes retained.
- Final scoped Jest: **11 suites / 67 tests passed**, log `/tmp/piggy-native-purchase-final.log`.
- `pnpm --filter @baci/mobile-storefront exec tsc --noEmit --incremental false`: exit0, `/tmp/piggy-native-purchase-types.log`.
- Scoped Biome12 owned code/test files passed. Root checks belong to parent. Watchman recrawl and existing Jest force-exit warnings remain.
- Run from repository root: `pnpm --filter @baci/mobile-storefront exec jest --runInBand --testTimeout=15000 --runTestsByPath components/wallet/savings/PiggyvestPurchaseReview.test.tsx components/wallet/savings/PiggyvestPurchaseBinding.test.tsx components/wallet/savings/StartSavingsScreen.purchase.test.tsx components/wallet/savings/StartSavingsScreen.operations.test.tsx components/wallet/savings/use-piggyvest-funding-gate.test.ts components/wallet/savings/PiggyvestCancellationBinding.test.tsx components/wallet/savings/PiggyvestCancellationBinding.transport.test.tsx components/wallet/savings/PiggyvestSavingsScreen.cancellation.test.tsx components/wallet/savings/PiggyvestSavingsScreen.test.tsx components/wallet/savings/use-start-savings-product-selection.test.ts components/wallet/savings/use-start-savings-submit.variant.test.ts`

The HTTP-client tests exercise actual shared serialization, bounded body parser, CSRF/current checks and actual native React screen/controller with explicitly injected synthetic Response streams. They do NOT claim a socket server, PostgreSQL backend or installed-native networking test. Backend HTTP/PG evidence is separately parent/Descartes-owned. A prior consolidated run failed one test whose direct cancellation attempt was now correctly blocked by the newly installed purchase guard; corrected the synthetic stimulus to explicit sibling invalidation, then all67 passed. No production guard was weakened.

## Native transport prerequisite — not implemented as fake authority

Installed Expo ~57.0.15 source was inspected locally. expo/fetch coerces same-origin credentials to include; iOS uses shared HTTPCookieStorage and Android uses a shared cookie handler. iOS NativeResponse buffers before streaming and pushes data into JS without an enforced native byte cap; JS stream highWaterMark zero does not impose native backpressure. Redirect error and abort paths exist, but this does not prove bounded cookie-isolated installed-runtime behavior. No ambient fetch adapter or fabricated SSR-cookie authentication was added.

Read-only `xcrun simctl list devices booted` returned no booted devices; adb was absent from PATH (SDK availability not inferred). No native build/install/launch performed. Next approved device step: choose storefront dev-client (not admin), then probe installed Expo transport against a disposable loopback fixture for cross-origin redirects, cookie path/session isolation, streaming oversize/missing length, cancellation during CSRF/body, and lost commit response. A scoped native byte limit/backpressure or reviewed alternative transport is required before claiming hard bounds. Storefront launcher is `pnpm --filter @baci/mobile-storefront android:emulator`, followed only under approval by storefront install/metro/launch scripts; they share an AVD with admin, so serialize with its owner. Do not invoke those launch/write commands under the current no-device-write constraint.

No provider funds, credentials, external data or existing held browser fixtures (4179/4181/4183) were touched. Device-change UI is the next parent-assigned slice, pending Descartes shared interface; this checkpoint does not claim that connection or full/live product readiness.
