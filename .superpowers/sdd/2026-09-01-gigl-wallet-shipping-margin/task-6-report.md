# Task 6 Implementation Report

## Scope

Implemented the mobile Admin manual-order **Ship with GIG** flow. The UI requests
a fresh server-attested GIG quote only while the shipment sheet is open on the
method step, displays the bundled NGN price, supports server-directed address
completion, exposes merchant-wallet shortfall and Paystack DVA funding, and
keeps booking behind the existing explicit shipped-status confirmation.

## TDD evidence

- RED API client: `pnpm --filter baci-mobile-admin exec vitest run lib/order-gigl-shipping.test.ts`
  failed because `./order-gigl-shipping` did not exist.
- RED hook: `pnpm --filter baci-mobile-admin exec vitest run hooks/orders/useOrderGiglShipping.test.ts`
  failed because `./useOrderGiglShipping` did not exist.
- GREEN focused feature/regression gate:
  `pnpm --filter baci-mobile-admin exec vitest run lib/order-gigl-shipping.test.ts hooks/orders/useOrderGiglShipping.test.ts components/orders/ShipmentFlowGiglPanel.test.tsx components/orders/ShipmentFlowSheet.gigl.test.tsx components/orders/ShipmentFlowSheet.test.tsx hooks/createOrderDetailsShipmentActions.test.ts hooks/completeOrderShipment.test.ts hooks/orders/useOrderStatusUpdate.test.ts lib/order-shipment.test.ts hooks/useOrderDetailsController.test.ts components/orders/OrderDetailsScreenModals.test.tsx`
  passed **11 files / 60 tests**.

## Gates

- `pnpm --filter baci-mobile-admin lint` — PASS, 1,814 files checked.
- `pnpm --filter baci-mobile-admin typecheck` — PASS.
- `git diff --check` — PASS.
- All new/touched Task 6 source and test files remain at or below 300 lines;
  `useOrderDetailsController.ts` is 293 lines.

## Behavioral notes

- API responses are Zod-validated and public quote parsing strips unrecognized
  internal economics.
- Polling is explicit after **I've transferred**, every 3 seconds for at most
  60 seconds, and stops on sufficient balance, close/unmount, background, or
  terminal error.
- Funding credit only enables the confirmation action; it never auto-books.
- Saved storefront quotes and Self Fulfill remain available through their
  existing paths.
- No emulator/device, live GIG, live Paystack, deployment, or remote migration
  proof was performed.

## Commit

Implementation commit: `865a4547c7`.

## Fix round 1

Resolved the independent review's financial-consent and wallet-cache findings:

- A quote within 30 seconds of expiry is refreshed on the confirmation tap.
  That tap never books; the replacement amount and wallet state render first,
  and only a new explicit tap can continue.
- The first sufficient wallet poll refreshes the server-attested quote before
  exposing `canBook`. A more expensive replacement remains blocked with its new
  exact shortfall.
- Address edits and server missing-address responses immediately discard the
  prior quote and bookable wallet state.
- Successful provider booking invalidates `merchant-wallet` after the four
  existing order/dashboard invalidations; Self Fulfill keeps its prior cache
  behavior.
- Duplicate funding consent is guarded while provisioning is in flight.

Fix-round RED evidence: the new focused regressions initially failed because
the hook lacked `ensureFreshQuoteForConfirmation`, polling did not request a
replacement quote, the sheet bypassed the freshness gate, and provider booking
made only four cache invalidations.

Fix-round GREEN evidence:

- Reviewer-focused gate: 5 files / 28 tests passed.
- Consolidated Task 6 plus controller/modal regressions: 12 files / 70 tests
  passed.
- Mobile Admin lint passed with 1,816 files checked.
- Mobile Admin typecheck and `git diff --check` passed.
- Hook: 300 lines; sheet: 289 lines; controller unchanged at 293 lines.

Fix-round implementation commit: `dbd40db646`.

No emulator/device, live GIG, live Paystack, deployment, or remote migration
proof was performed in this round.

## Fix round 2

Replaced overlapping interval polling with a serialized, recursive funding
poller. Each run owns a generation and abort signal, so restart, disable,
unmount, sheet close, app background, timeout, and terminal errors invalidate
both scheduled and in-flight work. Wallet and replacement-quote responses are
checked against that lifecycle after every await before state is applied.

Fix-round RED evidence: deterministic deferred-promise regressions failed
against the interval implementation because a slow wallet request overlapped
later ticks and lifecycle-invalid responses could still update wallet/quote
state.

Fix-round GREEN evidence:

- `pnpm --filter baci-mobile-admin exec vitest run lib/order-gigl-funding-poller.test.ts lib/order-gigl-shipping.test.ts lib/order-gigl-shipping-state.test.ts hooks/orders/useOrderGiglShipping.test.ts hooks/orders/useOrderGiglShipping.lifecycle.test.ts components/orders/ShipmentFlowGiglPanel.test.tsx components/orders/ShipmentFlowSheet.gigl.test.tsx components/orders/ShipmentFlowSheet.test.tsx hooks/createOrderDetailsShipmentActions.test.ts hooks/completeOrderShipment.test.ts hooks/orders/useOrderStatusUpdate.test.ts lib/order-shipment.test.ts hooks/useOrderDetailsController.test.ts components/orders/OrderDetailsScreenModals.test.tsx` — PASS, **14 files / 80 tests**.
- `pnpm --filter baci-mobile-admin lint` — PASS, 1,819 files checked.
- `pnpm --filter baci-mobile-admin typecheck` — PASS.
- `git diff --check` — PASS.
- Hook: 297 lines; lifecycle test: 282 lines; poller: 99 lines;
  poller test: 63 lines; controller unchanged at 293 lines.

Fix-round implementation commit: `94ddf97ede`.

No emulator/device, live GIG, live Paystack, deployment, or remote migration
proof was performed in this round.

## Final test modularity cleanup

Moved the already-funded provider wallet-cache regression into its own
colocated test file. The original shipment suite is now 272 lines and the new
GIGL wallet suite is 70 lines; Self Fulfill coverage remains in the original
suite without changing its behavior.

- Consolidated Task 6 gate: **15 files / 80 tests** passed.
- `pnpm --filter baci-mobile-admin lint` — PASS, 1,820 files checked.
- `pnpm --filter baci-mobile-admin typecheck` — PASS.
- `git diff --check` — PASS.

Cleanup commit: `beef853f44`.

No emulator/device, live GIG, live Paystack, deployment, or remote migration
proof was performed during this cleanup.
