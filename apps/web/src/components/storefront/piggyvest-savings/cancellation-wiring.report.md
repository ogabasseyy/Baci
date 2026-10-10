# Cancellation staging wiring and recovery — ready for parent review

## Scope and interface

Web SavingsScreen now accepts optional cancellation: ReturnType<typeof createPiggyvestCancellationController>|null. Native PiggyvestSavingsScreenInput has the same optional cancellation controller. Neither deployed wallet route nor native route constructs it; omission preserves previous behavior. Explicit invalid/null bindings render unavailable and never invoke legacy funding. StartSavingsScreen now distinguishes absent staging from explicitly present undefined staging; only absence mounts legacy.

Shared factory (parent barrel exported from @baci/shared/lib):

createPiggyvestCancellationController({ source, tenantKey, operationId?, quote?, prepare?, recover?, isCurrent })

- source is the authenticated, strict shared SavingsScreenSource; it must be ready and contains session/goal/policy identity. Funding eligibility may remain blocked.
- tenantKey is an explicit bounded opaque authenticated tenant scope, never exposed in DTOs. isCurrent receives frozen {sessionKey,tenantKey,goalId}; caller must independently verify current authenticated identity, and invalidate() on logout/lifetime disposal.
- A valid supplied quote, stable operationId and prepare callback enable only initial preparation. Exact source goal/revision/terms must match. UI never generates IDs.
- No quote creates a recovery-only controller; optional original operationId narrows lookup, omission performs goal-only recovery. No recovery state creates a prepare command.
- read(currentSource) supplies presentation only after exact session/goal/policy matching. Identity switching invalidates the controller permanently; device/terms mismatches hide the old quote.
- prepare(exactCommand) validates and retains the original command/operation bytes and makes at most one injected call. Duplicate/uncertain calls never dispatch. A locally cached prepared receipt may be returned without another call.
- recover() explicitly invokes only the injected read callback with {goalId,operationId?}; no automatic calls, fetch, storage, credentials or provider transport. Goal/requested-operation response correlation is canonical. Unknown/absent never unlock preparation.

The caller must create and retain this controller outside component remounts within one explicit authenticated lifetime. This is in-memory retention, NOT durable browser/native reload recovery. After a reload/unknown lifetime, reconstruct only a recovery-only controller and query the authoritative server. Do not instantiate a fresh preparation controller or mint a new operation just because the old component disappeared. Original disclosure is never reconstructed into a command.

## Agreed recovery protocol

Fermat and parent approved NEW packages/shared/src/contracts/piggyvest-cancellation-recovery.ts, export piggyvestCancellationRecoverySchemas {request,response}. Strict request goalId+optional operationId. Common response goalId/requestedOperationId/retry:not_authorized/dispatch:contract_gap. States: prepared+retained+originalDisclosure, absent+unknown, requires_reconciliation+unknown, unavailable+may_be_retained. No actor, tenant, provider identity or private command fields. Prepared means local reservation only, never refund or interest forfeiture.

Binding adapters display a read-only Refresh cancellation status action after pending/unknown/prepared states. Original disclosed amounts are explicitly labelled historical and not current balances. No client balance update, refund/forfeiture claim, transfer, schedule or provider dispatch is introduced.

## Files

New:
- packages/shared/src/lib/piggyvest-cancellation-controller.ts and .test.ts
- packages/shared/src/contracts/piggyvest-cancellation-recovery.ts and .test.ts
- apps/web/src/components/storefront/piggyvest-savings/cancellation-binding.tsx and .test.tsx
- apps/web/src/components/storefront/piggyvest-savings/savings-screen.cancellation.test.tsx
- apps/mobile-storefront/components/wallet/savings/PiggyvestCancellationBinding.tsx and .test.tsx
- apps/mobile-storefront/components/wallet/savings/PiggyvestSavingsScreen.cancellation.test.tsx
- apps/mobile-storefront/components/wallet/savings/StartSavingsScreen.cancellation.test.tsx
- This report.

Modified within assigned UI scope:
- apps/web/src/components/storefront/piggyvest-savings/savings-screen.tsx, savings-screen.types.ts, cancellation-review.tsx
- apps/mobile-storefront/components/wallet/savings/PiggyvestSavingsScreen.tsx, PiggyvestSavingsScreen.types.ts, PiggyvestCancellationReview.tsx, StartSavingsScreen.tsx

Parent-owned shared barrel exports are consumed, not edited here. Existing shared policy DTO, backend, SQL, env and production routes remain untouched.

## Exact local verification

RED: new web/native screen integration tests each initially failed missing optional cancellation/unavailable rendering. Same-revision device-switch consent regressions failed on both platforms before context protection. Explicit undefined staging regression initially mounted legacy once, then passed after own-property branch fix. New controller/recovery test modules began with missing-module failures.

GREEN:
- pnpm --filter @baci/shared exec vitest run src/lib/piggyvest-cancellation-controller.test.ts src/contracts/piggyvest-cancellation-recovery.test.ts — 15 tests / 2 suites.
- pnpm --filter @baci/web exec vitest run src/components/storefront/piggyvest-savings/cancellation-binding.test.tsx src/components/storefront/piggyvest-savings/savings-screen.cancellation.test.tsx src/components/storefront/piggyvest-savings/savings-screen.test.tsx src/components/storefront/piggyvest-savings/cancellation-review.test.tsx — 58 tests / 4 suites.
- pnpm --filter @baci/mobile-storefront exec jest --runInBand components/wallet/savings/PiggyvestCancellationBinding.test.tsx components/wallet/savings/PiggyvestSavingsScreen.cancellation.test.tsx components/wallet/savings/PiggyvestSavingsScreen.test.tsx components/wallet/savings/PiggyvestCancellationReview.test.tsx components/wallet/savings/PiggyvestCancellationReview.lifecycle.test.tsx components/wallet/savings/StartSavingsScreen.cancellation.test.tsx --silent — 59 tests / 6 suites.
- Scoped Biome covers the 18 changed TypeScript files. Runtime files remain below 300 lines.

Existing Watchman recrawl and Jest force-exit advisories remain. Parent owns root checks, independent review and connected actual handler/SQL recovery tests. No installed-device, network, provider, deployed or live evidence is claimed.

## Remaining contracts

Fermat owns read-only recovery backend/SQL and restricted catalog integration. Parent must inject authenticated prepare/recovery transports and retain controller lifecycle; production routes remain unactivated. Actual principal refund route/timing/fees, provider dispatch, interest disposition and settlement finality remain unsupported. Nothing here authorizes money movement or external staging activation.
