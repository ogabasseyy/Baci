# Native staging savings screen — parent integration report

Implemented local native presentation and StartSavingsScreen branch, not provider/customer activation or a complete product flow. No native build/install/device action, provider call, real account details, credentials, environment/query/route/storage activation, or outside-app edits.

## Wiring contract

`<StartSavingsScreen staging={input} />` selects the new screen before mounting the legacy controller. Omitted/undefined `staging` preserves the existing legacy UI. Explicit `null` remains in the staging unavailable branch, never falls back to legacy. Existing route callers are unchanged and continue using the legacy default. There is no persisted/client feature flag.

`PiggyvestSavingsScreenInput` is exported from PiggyvestSavingsScreen.types.ts. Supply:

- environment exactly staging, an opaque session identity/version key (not credentials), and goalId;
- source with matching sessionKey and goalId, or null;
- source.policy matching the shared public `piggyvestPolicyReviewSchemas.view` contract from `@baci/shared/contracts`, or a loading state;
- source.savings as loading/unavailable/pending_wallet, or the explicitly typed server-confirmed display projection with revisionId, exact device, internal-ledger purchasingPowerKobo/devicePriceKobo/pendingInterestKobo, readiness and fundingEligible;
- source.funding as loading/pending/unavailable, or revisionId plus bounded account display fields;
- onAccept receiving the shared exact goalId/revisionId/termsVersion/termsHash/accepted:true acceptance object.

The parent must bind these inputs to an authenticated, synthetic-allowlisted, current server response and the same goal/revision/session. The UI cannot independently authenticate a plain object or prove server freshness. `fundingEligible` is a required trusted server decision, NOT a decision this screen computes from consent. Its authoritative backend projection/chronology binding remains parent work; default to unavailable until available. No ready display or funding data is manufactured when persistence or eligibility is missing. This screen contains no HTTP/provider calls or privileged client construction.

Policy uses the newly shared portable schema without cross-app/server imports or a duplicate app-local schema. Device fields are shown from the validated exact policy snapshot. Savings status must match its revision and every device label. Funding also requires matched revision, strict server fundingEligible=true, non-unavailable readiness, persisted policy consent=accepted and validated account fields. Session/goal mismatch hides all stale content. Checking consent or a successful callback does not alter any trusted eligibility, accepted-consent or funding input.

No purchase, transfer, authorization, manual contribution, refund or withdrawal action is implemented in staging. All displayed numeric amounts are nonnegative safe-integer internal-ledger kobo, not provider units. Pending interest is displayed separately and never added to purchasing power.

## Interaction safety

Consent starts unchecked. Double taps are locked during submission. Generic failures allow an explicit retry; callback success says only submitted/refresh-to-confirm. Revision/device/terms/session changes remount review state; logout clears it. Callback replacement resets local consent and invalidates the prior pending callback. No late completion/error changes the new review. The parent callback must revalidate the exact server context and must not treat the checkbox as authentication, activation, or before-funding proof.

Follow-up review regressions reproduced and fixed: deferred passive cleanup previously allowed old success/failure to overwrite replacement-callback UI. Review now resets a state token during replacement render and conditionally applies asynchronous outcomes only to the exact pending-state object. The test deliberately defers effect cleanup while settling each old promise, and passes without relying on cleanup timing. Array readiness `['not_available']` previously coerced through Object.hasOwn and revealed funding; readiness now requires string type before enum membership or eligibility checks. The Jest beforeEach callback uses a block body to return void. All three new regressions failed before these fixes; the two native suites then passed all 21 tests.

## Verification

Initial five native tests failed against the placeholder/legacy branch: legacy controller mounted under staging input, and all required native review/funding behaviors were absent. Implemented actual components then exercised exact context mismatch, invalid amounts, pending/unavailable states, malformed policy, unchecked consent, double submission, failure/retry, no activation from callback success, logout, revision switch and callback replacement.

Final scoped savings run passed: 24 suites, 160 tests, 9.749 seconds.

```
pnpm --filter @baci/mobile-storefront exec jest --runInBand --watchman=false components/wallet/savings
pnpm exec biome check apps/mobile-storefront/components/wallet/savings/PiggyvestSavingsScreen*.ts* apps/mobile-storefront/components/wallet/savings/StartSavingsScreen{,.test}.tsx
```

Final scoped Biome checked eight files in 12ms with no fixes needed. The full savings run includes the retry assertion, replacement-before-cleanup success/failure regressions and malformed-readiness regression. Existing legacy test setup emits storage debug output, an Expo Go notifications warning and Jest's forced-exit advisory. No warning suppression was added. Parent owns root lint/type checks. No real native appearance, authenticated server integration, funding availability or live provider result is claimed.

## Files owned in this slice

All paths relative to apps/mobile-storefront/components/wallet/savings/:

- PiggyvestSavingsScreen.tsx
- PiggyvestSavingsScreen.types.ts
- PiggyvestSavingsScreen.styles.ts
- PiggyvestSavingsScreen.test.tsx
- PiggyvestSavingsScreen.review.tsx
- PiggyvestSavingsScreen.review.test.tsx
- PiggyvestSavingsScreen.report.md
- StartSavingsScreen.tsx (minimal branch/legacy-child extraction)
- StartSavingsScreen.test.tsx (actual staging-unavailable isolation regression)

Runtime component sizes are below 300 lines. The review subcomponent keeps the main screen small. Shared schema extraction belongs to the parent and was not edited here. Native testing prerequisites remain those documented in savings-flow-review.md; no native actions were performed for this slice.

## Shared source DTO connection prerequisite (latest slice)

The preceding bespoke source description is superseded. Native input now uses the exact shared `SavingsScreenSource` from `@baci/shared/contracts`, with unchanged serializable web wire shape. The local wrapper retains environment/sessionKey/goalId and the nonserializable onAccept callback. Supply runtime.readScreen's result directly as source; no native-specific savings/fundingEligible/revision/device reconstruction is required.

Shared schema extraction: packages/shared/src/contracts/piggyvest-savings-screen.ts and piggyvest-funding-display.ts, each with colocated tests, and contracts/index.ts exports. The two corresponding apps/web/src/schemas files are compatibility re-exports. Valid existing web DTOs are unchanged. Funding strings use the existing portable Unicode byte validator rather than native isWellFormed/TextEncoder.

Native files changed: PiggyvestSavingsScreen.tsx, PiggyvestSavingsScreen.types.ts, PiggyvestSavingsScreen.test.tsx, and this report. The component parses the shared strict DTO once. Server accepted consent AND allowed eligibility matching session/goal/revision/terms hash/version are required before funding or progress display. Device/terms come only from policy. Callback success remains local submission feedback, never activation. Malformed or extra DTO data fails closed. No network, credentials, runtime binder, environment/storage/query activation or money operation was added.

Verification:

- Shared: `pnpm --filter @baci/shared exec vitest run src/contracts/piggyvest-savings-screen.test.ts src/contracts/piggyvest-funding-display.test.ts` — 12 passing.
- Web compatibility: `pnpm --filter @baci/web exec vitest run src/schemas/piggyvest-savings-screen.test.ts src/schemas/piggyvest-funding-display.test.ts src/components/storefront/piggyvest-savings/savings-screen.test.tsx` — 37 passing, existing tests unchanged.
- Native: `pnpm --filter @baci/mobile-storefront exec jest --runInBand components/wallet/savings/PiggyvestSavingsScreen.test.tsx components/wallet/savings/PiggyvestSavingsScreen.review.test.tsx --silent` — 26 passing. Existing Watchman recrawl/force-exit warnings remain; no device launched.
- Scoped Biome covers the ten touched TypeScript files; native runtime is 151 lines. Parent owns root type/lint/full-suite checks.

Parent still owns authenticated runtime transport/binding and supplies the trusted source plus independent current session/goal context. This establishes DTO compatibility, not native network capability or provider/funding readiness.
