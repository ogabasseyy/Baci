# Baci Worktree Audit: Shard 2

**Baseline:** `ae94a5075d92ebdc3625c13006a6dd4144dba4fa` (`origin/main` at audit time, 2026-10-10). Read-only review of 64 manifest entries. No worktree, branch, or source changes; no builds, tests, installs, or fetches.

**Classification counts:** 7 `CLEAN_REDUNDANT`, 18 `PRESERVE_IMPROVEMENT`, 23 `PRESERVE_DIRTY`, 15 `ACTIVE_OR_UNCERTAIN`, 1 `MISSING`. Per-worktree HEAD, status count, ancestry, unique commit/path counts, PR snapshot match, activity count, and notes are in [audit-results-2.json](./audit-results-2.json).

## Priority preservation

- **ID 2, `feat/piggyvest-wallet`:** 512 dirty entries, including extensive untracked PiggyVest savings implementation and tests plus a committed change touching 111 paths. Preserve the complete checkout for review. Ignored environment-file names were recorded only (`.env.development.local`, `.env.local`, `apps/mobile-storefront/.env`, `apps/web/.env.local`); contents were not read.
- **ID 77, `mobile-admin-product-delete-stale`:** 1,095 tracked deletions across repository content despite merged PR #3397. This is not a clean retirement candidate; retain until the owner confirms whether the broad deletion state was intentional. Do not confuse it with generated cleanup.
- **ID 86, `ogabassey-snippet-configurations-20260905`:** 43 dirty entries, including 36 untracked catalog enrichment, review, and rollback artifacts. Preserve both source and local data.
- **ID 167, `paystack-money-notifications`:** 10 dirty entries include untracked refund ingestion code, tests, and a Supabase migration. Financial behavior needs focused review; preserve.
- **IDs 11 and 20:** Open PR heads (#3652 and #3654) with process activity in the supplied 13:19 snapshot. ID 11's live HEAD differs from the manifest HEAD. Do not retire without a fresh owner/process check.
- **ID 95:** 275 dirty entries include 268 tracked deletions under `apps/web/mcp-server/widgets/node_modules`; classify these as generated cleanup effects, not product/source changes. Preserve the package, patch, and lockfile changes independently.

## Baseline checks

- **ID 29, Android SoLoader:** The branch's `useLegacyPackaging=true` change is already present in baseline `apps/mobile-storefront/android/gradle.properties` and `apps/mobile-storefront/config/expo-plugins.js`. Clean branch; redundant.
- **ID 131, UCP unpriced products:** Baseline `apps/web/src/lib/agentic/ucp-catalog-adapters.ts` already rejects invalid/unpriced products and trims identity fields. Clean branch; the older alternative is superseded.
- **IDs 5 and 104:** Exact PR heads #3617 and #3284 are merged; worktrees are clean and no meaningful ignored local data was observed. Redundant.
- **ID 140:** Manifest marks this worktree locked, but its path is absent. Report as missing/uncertain, never as a retirement candidate.
- **ID 161:** PR #3481 is merged at the recorded exact head, but the supplied activity scan found a `git` process. Keep uncertain until a fresh process check confirms it is audit-only.
- **ID 164:** Branch name matches merged PR #3468, but worktree HEAD `a87330a5` differs from PR head `19e20890`; do not infer that this worktree is merged or redundant.
- **IDs 23 and 155:** PR snapshot branch matches do not match the current worktree HEADs; #23's PR is closed and #155's is merged. Preserve both for comparison rather than treating branch-name matches as head proof.
- **IDs 152, 158, and 170:** Clean with no net tree difference from baseline. IDs 158 and 170 contain unique commit records whose net tree is empty; no meaningful ignored local data was found.

## Salvage candidates

These have focused unique patches in the branch-to-forkpoint comparison and are not established as safe to retire. Recheck current baseline behavior before cherry-picking; classifications deliberately remain conservative.

- **ID 38, PiggyVest evidence/security:** eight changed paths, including `apps/web/src/lib/piggyvest/prefunded-card-legacy-receipt.ts` and `savings-exit-evidence-store.ts`; PR #3645 is open. Preserve and review.
- **ID 134, semantic mobile E2E actions:** three added files under `apps/mobile-admin/e2e/`; current baseline already has files at those paths, so this is an alternative revision requiring comparison, not a proven missing feature.
- **ID 149, Tailwind spacing contract:** two paths (`apps/web/tailwind.config.mjs` and its contract test); compare against current baseline before selecting the branch version.
- **ID 185, remediation stale claims:** storage logic and a focused regression test; inspect against baseline's existing lock/reclaim behavior before carrying anything forward.

## Uncertainty and limitations

Complex unique histories remain `ACTIVE_OR_UNCERTAIN`, including IDs 14, 26, 44, 56, 74, 80, 83, 89, 101, 107, 110, 122, 143, 146, 155, 164, and 188/191. Commit/path counts alone do not establish value or staleness. Unique paths are measured from merge-base to branch HEAD; this does not replace focused behavior comparison for older branches. The PR snapshot is a recent-500 snapshot captured at 13:24; a missing PR match means unknown, and a branch-name match does not prove the worktree HEAD equals the PR head. Remote preservation records are local tracking-ref observations, not fresh server checks. No deletion or cleanup was performed.
