# Duration consent — ready for parent review

Approved protocol implemented: optional top-level durationMonths on shared draft and acceptance, integer 1 through 6, without defaulting or coercion. The backend owns immutable prepared duration per revision and must reject changed/missing/unexpected duration; changed duration requires a new authoritative revision. Existing generic no-duration review remains supported and this slice does not make it activatable.

Web PolicyReview and native PiggyvestDraftReview display the supplied duration and emit it exactly. Absent duration is omitted from acceptance. Web's existing full-draft key includes duration, resetting its checkbox and detaching old completion. Native additionally compares a full-draft state token synchronously, so even a standalone same-revision duration replacement resets consent and rejects stale completion. No duration picker or guessed months was introduced.

HTTP acceptance responses must have exactly the submitted duration: added, missing, and different values all reject with the existing generic error. No retry or funding eligibility is inferred.

## Files

- packages/shared/src/contracts/piggyvest-policy-review.ts and colocated test
- packages/shared/src/lib/piggyvest-policy-client.ts and colocated test
- apps/web/src/components/storefront/piggyvest-savings/policy-review.tsx and colocated test
- apps/mobile-storefront/components/wallet/savings/PiggyvestSavingsScreen.review.tsx and colocated test
- This report

## Verification

Failing-first: shared new duration tests failed 3 cases before implementation; both new web/native display/reset tests failed before implementation.

- pnpm --filter @baci/shared exec vitest run src/contracts/piggyvest-policy-review.test.ts src/lib/piggyvest-policy-client.test.ts — 60 passing
- pnpm --filter @baci/web exec vitest run src/components/storefront/piggyvest-savings/policy-review.test.tsx — 18 passing
- pnpm --filter @baci/web exec vitest run src/schemas/piggyvest-policy-review.test.ts src/components/storefront/piggyvest-savings/policy-panel.test.tsx — 31 passing
- pnpm --filter @baci/mobile-storefront exec jest --runInBand components/wallet/savings/PiggyvestSavingsScreen.review.test.tsx components/wallet/savings/PiggyvestSavingsScreen.test.tsx --silent — 27 passing
- Scoped Biome on eight touched TypeScript files: clean.

Parent/Descartes still own prepared read serialization, exact acceptance persistence checks and lifecycle activation gates. No backend, provider, environment, network or funds operation was performed. Native tests retain existing Watchman recrawl and Jest force-exit notices.
