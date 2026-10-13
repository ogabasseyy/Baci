# Phase 1 — Shared REDVAULT calculation

**Status:** READY_FOR_PARENT_REVIEW. This report does not authorize Phase 2.

## Scope completed

- Added the server-authoritative-input-only REDVAULT quote contract in `packages/shared/src/contracts/redvault-quote.ts` and exported it from the shared contracts barrel.
- Added `isRedvaultEligibleProduct`, which delegates directly to `isProductNegotiable`; no exclusion policy was copied or changed.
- Added safe-integer-kobo pricing: canonical grouping includes product, variant, condition, normalized attributes, unit price, VAT category/rate and frozen exclusive tax basis. Eligible groups use 5% half-up rounding, then allocate remainders in persisted item/unit order.
- Added the technical `REDVAULT_MAX_ALLOCATION_UNITS_PER_QUOTE = 10_000` bound. Both line count and cumulative quantity are rejected before per-unit allocation arrays are created; this is a resource-safety limit, not a commercial usage cap.
- Added stored-net-unit refund selection. It sums persisted net unit amounts and never recalculates a percentage refund.
- Added focused tests for every exclusion, Samsung A versus S/Z, the mixed and all-excluded fixtures, rounding boundaries, split/reordered equivalents, identity distinctions, stable remainders, partial refunds, malformed values, overflow, oversized allocation input and non-exclusive tax basis.

No API, payment, UI, SQL, migration, provider, commercial-default, deployment, payment, branch, commit, push, merge, or production work was performed. Existing `supabase/.temp/cli-latest` and prior planning artifacts were preserved.

## Baseline and manifest

- HEAD: `449e604c434f7a9996e7284acf0dfd6c190f0187`
- `85763fb7b952816596df5460fa508e11c5cee6a46a3b221ed5110d688e3e9d72`  `packages/shared/src/contracts/redvault-quote.ts`
- `5eb609f5eb84db3f8dc036b9ea07d70195d58478d7a8eb6c67c438964f6022fc`  `packages/shared/src/contracts/index.ts`
- `67872a755d4522e33e9f87d14056c94f1793063a557cda9aaf329f259aed0a64`  `packages/shared/src/lib/index.ts`
- `fa408c1377ad22c74e4af032700b4a91fb7bd623ff0f3f7eff331a8a89ddb2a6`  `packages/shared/src/lib/redvault-eligibility.ts`
- `5c08dea030a4ed65ca725665e97b083b285faa3b142066c791fa02dd011e3977`  `packages/shared/src/lib/redvault-eligibility.test.ts`
- `180292a648749c058025bda621c94b9bd86eba83e0671ab49092a6f45d91e8c2`  `packages/shared/src/lib/redvault-pricing.ts`
- `2433327bef8498d044cabe449d851ac14ba01456d8cb2d7c04dee9c5bcfe065c`  `packages/shared/src/lib/redvault-pricing.test.ts`
- `7e79612e8c5db29d9f2624d3dca18979859e0802ff06fbd6dab7f339134aca19`  `packages/shared/src/lib/redvault-refund-allocations.ts`
- `371bea1b2f0a625beee7373d02edc6192692024fa3b479b6afa3f402ca0bb232`  `packages/shared/src/lib/redvault-refund-allocations.test.ts`

## Validation

| Command | Result |
| --- | --- |
| `pnpm --filter @baci/shared test -- src/lib/redvault-eligibility.test.ts src/lib/redvault-pricing.test.ts src/lib/redvault-refund-allocations.test.ts` | RED: expected missing-module failures before implementation; GREEN: 165 files / 1,148 tests passed. |
| `pnpm --filter @baci/shared test -- src/lib/negotiation-policy.test.ts src/lib/redvault-eligibility.test.ts src/lib/redvault-pricing.test.ts src/lib/redvault-refund-allocations.test.ts` | 165 files / 1,150 tests passed after the resource-bound and tax-basis regressions. |
| `pnpm --filter @baci/shared typecheck` | Passed. |
| `pnpm exec biome check` over all Phase 1 shared paths | Passed. |
| `git diff --check` | Passed. |
| `pnpm turbo lint --filter=@baci/shared` | No task exists for `@baci/shared`; Turbo completed successfully with 0 tasks. Scoped Biome check above is the applicable lint evidence. |
| `pnpm turbo lint && pnpm turbo typecheck && pnpm turbo test` | The prior process is no longer running. Its final exit result was not retained by the terminal wrapper or available in local Turbo metadata, so no overall result is claimed and no duplicate suite was launched. |
| `coderabbit review --agent -t uncommitted` | Started and reached review analysis; its process ended without a final findings payload in the captured output. No CodeRabbit verdict is claimed. |

The first formatter invocation named a nonexistent `redvault-quote.test.ts`; it emitted an input-path error and made no changes to that path. The corrected scoped Biome command passed.

## Unresolved / parent gates

- Parent must review the exported contract and changed-file manifest before unlocking Phase 2.
- The prior repository-wide test exit result is unavailable; a parent may choose to rerun it after review.
- Provider enforcement, immutable database bindings, protected persistence, payment initialization/completion, refund state transitions, commercial terms and activation remain out of scope and unresolved.
