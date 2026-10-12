# Cancellation presentation — ready for parent review

## Stable API and wire protocol

New shared module: packages/shared/src/contracts/piggyvest-cancellation-review.ts, export piggyvestCancellationReviewSchemas with quote, confirmation and receipt. Protocol coordinated with customer-cancel-handler owner. The final flag is accepted:true, NOT confirmed:true. All quote and receipt states include goalId; both receipts include operationId.

Quote available fields: status, goalId, revisionId, termsVersion, termsHash, consentVersion:'2026-09-11', principalKobo (positive safe integer), paidInterestKobo and pendingInterestKobo (nonnegative safe integers), interestDisposition:'unresolved', dispatch:'contract_gap'. Other quote states are unavailable/requires_policy_specific_handling with goalId only.

Confirmation: goalId, operationId, revisionId, termsVersion, termsHash, consentVersion, three exact quoted amounts, accepted:true. No actor/configuration fields. Prepared receipt: status:'prepared', goalId, operationId, collectionPaused:true, dispatch:'contract_gap', interestDisposition:'unresolved'. Uncertain receipt: status:'unavailable', goalId, operationId, reservation:'may_be_retained', dispatch:'contract_gap'. All objects strict.

New web component CancellationReview in cancellation-review.tsx accepts sessionKey:string|null, goalId:string|null, operationId:string|null, quote:unknown, onPrepare:(validatedConfirmation)=>Promise<unknown>. onPrepare returns the public receipt, not Response. Caller owns stable operation IDs and trusted context/quote acquisition; UI generates neither IDs nor credentials.

## Safety and integration

Displays principal separately from paid and pending interest, exact terms version/hash and supported interest-forfeiture consent version. 0% fee is limited to the supported literal policy. Explicitly says preparation is not a refund, interest remains unresolved and provider dispatch unavailable. Checkbox starts unchecked; no validated quote means disabled preparation. Callback success alone is insufficient: strict receipt and exact goal/operation match required.

Full quote/session/goal/operation and callback identity changes reset consent synchronously. Old success/failure cannot overwrite replacement UI. A ref prevents duplicate dispatch before React renders and retains attempted operation keys for the mounted component. Unknown responses/errors disable resubmission and disclose possibly retained reservation. No automatic retry or funds-release claim. On remount, caller must reconcile uncertain operations before supplying a new actionable quote; local UI state is not durable idempotency.

Parent owns the shared contracts barrel export and connected handler test/wiring. This slice edits only new files. Until the barrel is exported, component uses a direct repository-relative shared import; parent may switch it to @baci/shared/contracts after export. No existing savings-screen integration, routes, backend, environment or provider operations changed. Shared schemas validate presentation, not freshness or ownership; authenticated backend must revalidate all quote assertions transactionally.

## Files and verification

New source/test pairs: packages/shared/src/contracts/piggyvest-cancellation-review.ts/.test.ts and apps/web/src/components/storefront/piggyvest-savings/cancellation-review.tsx/.test.tsx; this report. Runtime component 165 lines.

Initial tests failed because the new implementation modules did not exist. Final commands:

- pnpm --filter @baci/shared exec vitest run src/contracts/piggyvest-cancellation-review.test.ts — 14 passing.
- pnpm --filter @baci/web exec vitest run src/components/storefront/piggyvest-savings/cancellation-review.test.tsx — 17 passing.
- Scoped Biome check on four TypeScript files — clean.

All inputs synthetic. No network calls, money operations, deployment or root checks performed. Parent owns full checks and connected integration verification.

## UUID identity review correction

Reproduced failing uppercase identity regressions before fixing. Component now validates and canonicalizes UUIDs only for goal matching, render identity, attempted-operation keys and receipt correlation. Original confirmation UUID strings remain unchanged: no shared schema transform or durable serialized command/replay changes. Casing-only changes cannot unlock an attempted operation or erase uncertain state. Amount/terms changes continue to reset consent while retaining the attempted-operation guard.

Final scoped verification: 20 web component tests and 14 shared contract tests pass; scoped Biome clean. Parent-added shared barrel import is preserved. No backend files changed.
