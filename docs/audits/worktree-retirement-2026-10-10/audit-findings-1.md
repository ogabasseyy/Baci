# Baci Worktree Audit: Shard 1

Audit date: 2026-10-10. Frozen comparison baseline: `ae94a5075d92ebdc3625c13006a6dd4144dba4fa` (`origin/main` in `/Users/mac/Baci-app`). This is a read-only audit; no source, branch, index, or worktree was changed.

## Summary

All 65 assigned rows are accounted for. **6 are code-level clean-retirement opportunities**: IDs 7, 58, 79, 97, 130, and 175 are clean, their HEADs exactly match merged PR heads, and the bounded scan found their 263 ignored media/report files byte-identical to the primary checkout. These are candidates, not deletion authorization: recheck processes immediately before retirement and preserve/verify any required archive. ID 194 is baseline-clean but has one ignored image absent from the primary, so it is not included. The primary checkout additionally contains 18 `.env*` filenames in the bounded scan, including `.vercel/.env.{preview,production,development}.local`; contents were not read. Those names are not evidence that credentials are valid, but they require secret-handling before any retirement.

Categories: 2 `ACTIVE_OR_UNCERTAIN` (IDs 1 and 127), 1 `MISSING` (ID 181), 33 `PRESERVE_DIRTY`, 23 `PRESERVE_IMPROVEMENT`, and 6 `CLEAN_REDUNDANT` code-retirement candidates. No deletions or cleanup actions are authorized by this audit. The per-row metadata is in [audit-results-1.json](./audit-results-1.json).

The comparison uses `git status --porcelain --untracked-files=normal`, non-ignored untracked-file counts, `merge-base --is-ancestor`, and `git log --right-only --cherry-pick baseline...HEAD`. `changedPaths` counts triple-dot diff paths; representative evidence paths/subjects are listed below, not exhaustive full diffs. `PRESERVE_IMPROVEMENT` means a preservation candidate identified from branch history/path evidence, **not a validated behavioral improvement absent from current main**. Squash merges can leave many commits patch-distinct, so unique-commit counts and subjects do not establish missing behavior. This shard did not inspect every large diff or compare every behavior at the exact baseline tree. Git-tracked `node_modules` cleanup noise, if encountered elsewhere in the broader audit, should be distinguished from source loss; this shard's substantive dirty states include source, tests, documentation, and/or local assets.

## High-priority evidence

- **ID 1 `/Users/mac/Baci-app`: preserve and do not retire.** Although branch `fix/mobile-admin-signup-skip-owner` has merged PR #3344, HEAD has 38 commits not patch-equivalent to baseline, 219 changed paths, 552 porcelain entries, and 700 non-ignored untracked paths. The dirty set spans repo instructions, both Expo apps, web storefront/API code, tests, migrations, and tools. It also has active Git/network, Turbo/TypeScript, Node, and other processes in the supplied activity snapshot. Preserve all state and review nested worktree overlaps before any cleanup. `.vercel` environment filenames were noted without reading contents.
- **IDs 10, 13, 19, 22:** open PR work is confirmed: #3651 loyalty enrollment (21 commits/60 paths), #3605 merchant image pilot (57 commits/269 paths plus dirty/untracked files), #3642 PiggyVest primary-wallet integration (118 commits/673 paths plus dirty/untracked files), and #3655 wallet-only VTU checkout (2 commits/54 paths). These are concrete preservation cases.
- **IDs 25, 106, 184, 187, 190:** related remediation-worker changes overlap in history, but each carries distinct fixes/tests and there is no verified content-equivalence basis to discard any checkout. Examples include transactional handoff/global locking (#25/#106), idempotent cleanup (#184), stale-lock ownership (#187), and abandoned-reclaim recovery (#190). Consolidate only after comparing full patch/tree content and preserving all unique commits.
- **ID 34:** one committed dedicated Ogabassey homepage route change plus 37 dirty entries and 13 untracked source/assets, including homepage CSS split/loaders, product-slot components, and tests. Preserve; this is not just the committed route change.
- **IDs 43, 46, 52, 85, 112:** merged PR status does not cover post-merge local changes. ID 43 is based on merged #3451 but is advanced with 58 unique commits, 330 changed paths, 14 dirty entries, and 364 untracked files. ID 46 matches merged #3394's head but has one dirty entry and a long branch history. ID 52 follows merged #3371 but has 14 dirty entries and 4 untracked files. ID 85 follows merged #3419 with 4 dirty entries and one untracked file. ID 112 matches merged #3445's head but has 49 dirty entries and 58 untracked files. Keep these for content-level review.
- **IDs 7, 58, 79, 97, 130, 175:** exact merged PR heads (#3508, #3457, #3455, #3281, #3452, #3324 respectively), clean Git states, and 263 sampled ignored media/report files byte-identical to the primary checkout. These are code-level clean-retirement candidates, subject to fresh process checks and an archive-first removal gate. This establishes no unique local content in the bounded media scan; it does not assert that every ignored file at every depth was inspected.
- **ID 127:** locked worktree with a running Git/network and CI/TypeScript process set in the activity snapshot; one security-fix commit for alerts 470, 472, 479-490. `ACTIVE_OR_UNCERTAIN`; no retirement.
- **ID 160:** 1,593 Git status entries and 2,920 non-ignored untracked files, despite zero unique commits. Treat as content-preservation critical; do not infer generated or disposable content without inspecting filenames/content and preserving it.
- **ID 169:** 35 unique commits, 3,286 changed paths, 464 status entries, and 445 untracked files for the PiggyVest takeover. Preserve all dirty and committed state; semantic review is complex.
- **ID 181:** assigned path is absent (`MISSING`); no conclusion about branch/worktree retention can be made.

## Per-worktree inventory

`D/U` = porcelain entry count / non-ignored untracked file count. `UCommits/Paths` = patch-distinct commits / triple-dot changed paths. `Anc` means baseline is an ancestor of HEAD. `PRESERVE_DIRTY` also covers Git-clean checkouts with discovered ignored local assets.

| ID | Worktree | HEAD | Anc | D/U | UCommits/Paths | Category | Evidence / caveat |
|---:|---|---|:---:|---:|---:|---|---|
| 1 | `/Users/mac/Baci-app` | `9e9a95ac` | no | 552/700 | 38/219 | ACTIVE_OR_UNCERTAIN | #3344 merged, but broad dirty/untracked changes and active processes; see priority finding. |
| 4 | `/Users/mac/.codex/worktrees/baci-muse-production/Baci-app` | `cbea2ab3` | no | 2/0 | 0/0 | PRESERVE_DIRTY | Two tracked local changes; inspect before removal. |
| 7 | `/Users/mac/.codex/worktrees/checkout-payment-switch/Baci-app` | `a09e19db` | no | 0/0 | 0/6 | CLEAN_REDUNDANT | Exact merged #3508 head; 263 sampled ignored media files byte-identical to primary. |
| 10 | `/Users/mac/.codex/worktrees/issue-3165/Baci-app` | `29a9c1cc` | yes | 0/0 | 21/60 | PRESERVE_IMPROVEMENT | Open #3651; loyalty atomic-enrollment/owner authorization changes. |
| 13 | `/Users/mac/.codex/worktrees/merchant-image-pilot/Baci-app` | `a0caa3ce` | no | 16/1 | 57/269 | PRESERVE_DIRTY | Open #3605, pilot guard work; dirty and untracked state. |
| 16 | `/Users/mac/.codex/worktrees/ogabassey-search-relevance/Baci-app` | `a37716d8` | no | 19/1 | 0/0 | PRESERVE_DIRTY | No unique commits; 19 dirty entries and an untracked file still require review. |
| 19 | `/Users/mac/.codex/worktrees/piggyvest-primary-release/Baci-app` | `b547cb22` | yes | 17/3 | 118/673 | PRESERVE_DIRTY | Open #3642; latest wallet/refund/interest changes and local residue. |
| 22 | `/Users/mac/Baci-app-worktrees/airtime-wallet-only` | `6eda63ce` | no | 0/0 | 2/54 | PRESERVE_IMPROVEMENT | Open #3655; wallet-only utility purchase flow and rejection coverage. |
| 25 | `/Users/mac/Baci-app/.worktrees/3309-transactional-handoff` | `e9685335` | no | 0/0 | 21/42 | PRESERVE_IMPROVEMENT | Remediation cron handoff, global-lock ownership, recovery/tests. |
| 28 | `/Users/mac/Baci-app/.worktrees/android-disk-preflight` | `02aa73cd` | no | 0/0 | 1/4 | PRESERVE_IMPROVEMENT | Android release low-disk preflight script/workflow/tests. |
| 31 | `/Users/mac/Baci-app/.worktrees/anr-telemetry.Tmecix` | `1e3e267d` | no | 0/0 | 1/14 | PRESERVE_IMPROVEMENT | Native ANR surface attribution module and telemetry tests. |
| 34 | `/Users/mac/Baci-app/.worktrees/base-homepage-inline-css` | `8b368c38` | no | 37/13 | 1/4 | PRESERVE_DIRTY | Dedicated homepage route plus CSS split/loaders, product slots, tests in dirty/untracked state. |
| 37 | `/Users/mac/Baci-app/.worktrees/cloudflare-deploy-skew` | `61b34ab8` | no | 0/0 | 2/9 | PRESERVE_IMPROVEMENT | Release marker/config coherence checks and deploy gate. |
| 40 | `/Users/mac/Baci-app/.worktrees/customizable-pay-on-delivery-implementation` | `4e96512c` | no | 18/3 | 61/445 | PRESERVE_DIRTY | Global eligibility seed, policy management/cutover and fulfillment changes; local residue. |
| 43 | `/Users/mac/Baci-app/.worktrees/cwv-ogabassey-utility-20260908` | `a3825bae` | no | 14/364 | 58/330 | PRESERVE_DIRTY | Merged #3451 but advanced; homepage CSS/perf changes and extensive untracked state. |
| 46 | `/Users/mac/Baci-app/.worktrees/discount-transaction-history-pr` | `952206d2` | no | 1/0 | 110/184 | PRESERVE_DIRTY | Exact merged #3394 head; one local modification means merged status is insufficient. |
| 49 | `/Users/mac/Baci-app/.worktrees/expo-image-pilot` | `1c87b050` | no | 0/0 | 6/5 | PRESERVE_IMPROVEMENT | Expo Image product-card pilot plus adjacent config/CI changes; no matching PR evidence found. |
| 52 | `/Users/mac/Baci-app/.worktrees/expo57-modernization` | `f593be74` | no | 14/4 | 8/23 | PRESERVE_DIRTY | Follows merged #3371; Expo 57/EAS config and dirty changes remain. |
| 55 | `/Users/mac/Baci-app/.worktrees/fix-blog-prerender-cache-20260830` | `337e1818` | no | 0/0 | 1/2 | PRESERVE_IMPROVEMENT | Closed #3433; cached-category navigation interruption fix is not established in baseline. |
| 58 | `/Users/mac/Baci-app/.worktrees/fix-web-ios-production-deploys` | `dc79abd8` | no | 0/0 | 4/15 | CLEAN_REDUNDANT | Exact merged #3457 head; 263 sampled ignored media files byte-identical to primary. |
| 61 | `/Users/mac/Baci-app/.worktrees/gigl-wallet-shipping-margin` | `68903f46` | no | 1/0 | 0/0 | PRESERVE_DIRTY | One tracked local modification on `main`; inspect. |
| 64 | `/Users/mac/Baci-app/.worktrees/h0-cwv-task6-prep` | `9671aa67` | no | 14/79 | 2/1 | PRESERVE_DIRTY | CWV runner planning commits plus dirty docs/untracked files. |
| 67 | `/Users/mac/Baci-app/.worktrees/h1-home-critical-viewport` | `127eedc9` | no | 19/8 | 2/6 | PRESERVE_DIRTY | Hero preload contract work with dirty/untracked files; branch has a merge commit. |
| 70 | `/Users/mac/Baci-app/.worktrees/merchant-media-pipeline` | `3c4e0248` | no | 2/0 | 148/545 | PRESERVE_DIRTY | Extensive merchant media/readiness history; two dirty docs; semantic review complex. |
| 73 | `/Users/mac/Baci-app/.worktrees/metro-clean-20260817` | `a0221b27` | no | 0/0 | 26/172 | PRESERVE_IMPROVEMENT | Builder-preview security and Metro cleanup history; clean tracked state does not make unique commits disposable. |
| 76 | `/Users/mac/Baci-app/.worktrees/mobile-admin-e2e-current-main.bEKqlN` | `b76dc7cc` | no | 8/1 | 0/0 | PRESERVE_DIRTY | Dirty tracked changes plus one untracked file despite no unique commit. |
| 79 | `/Users/mac/Baci-app/.worktrees/mobile-native-crash-fixes-20260908` | `3e065198` | no | 0/0 | 27/56 | CLEAN_REDUNDANT | Exact merged #3455 head; 263 sampled ignored media files byte-identical to primary. |
| 82 | `/Users/mac/Baci-app/.worktrees/office-pickup-state-fix` | `d0d1cbd2` | no | 2/0 | 0/0 | PRESERVE_DIRTY | Two local modifications; inspect before any retirement. |
| 85 | `/Users/mac/Baci-app/.worktrees/ogabassey-live-rails-20260831` | `2c83782d` | no | 4/1 | 72/167 | PRESERVE_DIRTY | Merged #3419 but advanced and dirty; live blog catalog-bound pricing changes. |
| 88 | `/Users/mac/Baci-app/.worktrees/ogabassey-tracking-links` | `18d0b4c5` | no | 11/0 | 0/0 | PRESERVE_DIRTY | Eleven local modifications; no unique commit. |
| 91 | `/Users/mac/Baci-app/.worktrees/paypal-integration` | `20412d3d` | no | 825/19 | 5/17 | PRESERVE_DIRTY | Large local state plus PayPal route/CSP/SDK changes; content audit required. |
| 94 | `/Users/mac/Baci-app/.worktrees/pr-2047-mobile-storefront-crash` | `770996bb` | no | 278/0 | 4/1 | PRESERVE_DIRTY | Extensive local tracked state; do not let one changed config test summarize it. |
| 97 | `/Users/mac/Baci-app/.worktrees/pr-3281-agentic-health` | `d9a1f7db` | no | 0/0 | 7/12 | CLEAN_REDUNDANT | Exact merged #3281 head; 263 sampled ignored media files byte-identical to primary. |
| 100 | `/Users/mac/Baci-app/.worktrees/pr3223-review-loop` | `a67acddf` | no | 0/0 | 26/109 | PRESERVE_IMPROVEMENT | CI and VPS cache/deploy secret synchronization work; inspect before consolidation. |
| 103 | `/Users/mac/Baci-app/.worktrees/pr3277-ci-fix` | `39a43bad` | no | 1/1 | 16/72 | PRESERVE_DIRTY | Remediation/deploy workflow changes plus dirty and untracked planning state. |
| 106 | `/Users/mac/Baci-app/.worktrees/pr3309-path-direct-handoff-sparse` | `5fffb3a4` | no | 0/0 | 20/39 | PRESERVE_IMPROVEMENT | Overlaps ID 25 remediation handoff history; compare exact patch sets before consolidation. |
| 109 | `/Users/mac/Baci-app/.worktrees/pr3337-clean-20260814` | `b7d702c7` | no | 78/21 | 1/85 | PRESERVE_DIRTY | SuperQuiz experience plus substantial local tracked/untracked changes. |
| 112 | `/Users/mac/Baci-app/.worktrees/quiz-main-reconciliation-20260905` | `ba049d9e` | no | 49/58 | 12/47 | PRESERVE_DIRTY | Exact merged #3445 head, but quiz recovery/lobby edits and local files remain. |
| 115 | `/Users/mac/Baci-app/.worktrees/readiness-round4-web` | `e0e860c0` | no | 0/0 | 35/113 | PRESERVE_IMPROVEMENT | Readiness web request/error/refresh/KYC handling changes. |
| 118 | `/Users/mac/Baci-app/.worktrees/readiness-task9-app-focus` | `f180f37f` | no | 0/0 | 19/58 | PRESERVE_IMPROVEMENT | App-focus query refresh and related readiness artifacts; overlaps ID 115 domain. |
| 121 | `/Users/mac/Baci-app/.worktrees/release-failures` | `ffd5a739` | no | 0/0 | 1/10 | PRESERVE_IMPROVEMENT | Closed #3434; mobile native release hardening scripts/workflows. |
| 124 | `/Users/mac/Baci-app/.worktrees/review-pr-2898` | `a0236813` | no | 38/0 | 11/86 | PRESERVE_DIRTY | Customer edit parity/new-order draft retention plus dirty changes. |
| 127 | `/Users/mac/Baci-app/.worktrees/sec-leftover-14` | `b71d2448` | yes | 0/0 | 1/6 | ACTIVE_OR_UNCERTAIN | Locked; active Git/CI/TypeScript processes; security dependency patch. |
| 130 | `/Users/mac/Baci-app/.worktrees/shipping-legacy-client-20260908` | `2ca377a7` | no | 0/0 | 0/5 | CLEAN_REDUNDANT | Exact merged #3452 head; 263 sampled ignored media files byte-identical to primary. |
| 133 | `/Users/mac/Baci-app/.worktrees/shopify-inventory-refresh` | `ac4a4b9a` | no | 0/0 | 111/91 | PRESERVE_IMPROVEMENT | Merged #3374 was an earlier head; current checkout has substantial later inventory/test commits. |
| 136 | `/Users/mac/Baci-app/.worktrees/social-ads-google-finalize` | `06c7ee2a` | no | 19/0 | 37/200 | PRESERVE_DIRTY | Merchant-bound Google OAuth/analytics changes plus dirty files. |
| 139 | `/Users/mac/Baci-app/.worktrees/storefront-ai-b0` | `d7db2304` | no | 0/0 | 27/102 | PRESERVE_IMPROVEMENT | Builder CAS/preview hardening and Storefront AI baseline work. |
| 142 | `/Users/mac/Baci-app/.worktrees/storefront-ai-r2-luna` | `71300d6d` | no | 0/0 | 32/209 | PRESERVE_IMPROVEMENT | Strict PageSpec and R2 persistence/authority changes. |
| 145 | `/Users/mac/Baci-app/.worktrees/storefront-audit-fixes` | `6ed1ef65` | no | 16/0 | 14/119 | PRESERVE_DIRTY | Checkout dialog deferral/performance plus dirty state. |
| 148 | `/Users/mac/Baci-app/.worktrees/storefront-web-alignment-integration-qa` | `a4c2b423` | no | 274/0 | 1/19 | PRESERVE_DIRTY | 274 local status entries; do not infer from the one unique commit alone. |
| 151 | `/Users/mac/Baci-app/.worktrees/universal-payment-design` | `6714131b` | no | 0/0 | 31/1 | PRESERVE_IMPROVEMENT | Payment authority/recovery design documents; preserve planning artifacts. |
| 154 | `/Users/mac/Baci-app/.worktrees/vercel-cost-cuts-round2` | `a38ca706` | no | 1/0 | 7/69 | PRESERVE_DIRTY | Cost/performance plan and cache/autocomplete changes plus one local modification. |
| 157 | `/Users/mac/Baci-app/.worktrees/wht-invoice-adjustments-design` | `8c71477a` | no | 0/0 | 3/2 | PRESERVE_IMPROVEMENT | WHT financial lifecycle and invoice-adjustment design docs. |
| 160 | `/Users/mac/Baci-worktrees/cursor-savings-phase1` | `2a4a8e40` | no | 1593/2920 | 0/0 | PRESERVE_DIRTY | Extremely large dirty/untracked state; no content classified as disposable. |
| 163 | `/Users/mac/Baci-worktrees/image-bitmap-memory-fix` | `c127b048` | no | 1/0 | 2/24 | PRESERVE_DIRTY | Bitmap decoding/crash guard improvements plus one local modification. |
| 166 | `/Users/mac/Baci-worktrees/oxygen-integration` | `68903f46` | no | 68/2 | 0/0 | PRESERVE_DIRTY | 68 dirty entries and two untracked files; no unique commit. |
| 169 | `/Users/mac/Baci-worktrees/piggyvest-3620-takeover` | `afef44ee` | no | 464/445 | 35/3286 | PRESERVE_DIRTY | Extensive PiggyVest implementation and local state; semantic review complex. |
| 172 | `/Users/mac/Baci-worktrees/pr3186-outbox-rpc` | `9634efb6` | no | 4/4 | 15/15 | PRESERVE_DIRTY | CI/replay and RPC diagnostics plus dirty/untracked state. |
| 175 | `/Users/mac/Baci-worktrees/pr3322-ci-fix` | `47c2c9ce` | no | 0/0 | 3/4 | CLEAN_REDUNDANT | Exact merged #3324 head; 263 sampled ignored media files byte-identical to primary. |
| 178 | `/Users/mac/Baci-worktrees/pr3597-refunds` | `8ba03c46` | yes | 0/0 | 12/35 | PRESERVE_IMPROVEMENT | Refund RPC currency/outstanding-leg and reference normalization fixes. |
| 181 | `/Users/mac/Baci-worktrees/semantic-timeout-fix` | n/a | n/a | n/a | n/a | MISSING | Path absent at audit time. |
| 184 | `/Users/mac/Baci-worktrees/terra-3305-followup-isolated` | `bc3b00b4` | no | 0/0 | 41/104 | PRESERVE_IMPROVEMENT | Remediation cleanup idempotency and workflow regressions; overlaps IDs 25/106/187/190. |
| 187 | `/Users/mac/Baci-worktrees/terra-3309-case-state-review` | `49aded50` | no | 0/0 | 25/44 | PRESERVE_IMPROVEMENT | Remediation stale-lock ownership/transition safety; overlapping history, preserve pending diff comparison. |
| 190 | `/Users/mac/Baci-worktrees/terra-3309-claim-residue-recovery` | `78a57da4` | no | 0/0 | 5/9 | PRESERVE_IMPROVEMENT | Abandoned claim/sidecar recovery tests and fixes; overlaps remediation worktrees. |
| 194 | `/private/tmp/baci-blog-handoff-rollout` | `ae94a507` | yes | 0/0 | 0/0 | PRESERVE_DIRTY | Baseline-clean, but unique ignored `docs/connectors/muse-baci-icon.png` is absent from primary. |

## Limits and next gate

This shard did not run builds/tests and did not inspect every large diff. The inventory, exact known PR state, small focused commit subjects, and representative paths are evidence for preservation, not a quality verdict. Complicated branches are intentionally marked to preserve. Before any eventual removal, repeat process/status checks and make an independently verified archive/backup of all dirty, untracked, ignored, and branch-only content; verify that backup before removal. In particular, do not treat a merged PR, a clean porcelain status, or a zero unique-commit count as sufficient evidence by itself.
