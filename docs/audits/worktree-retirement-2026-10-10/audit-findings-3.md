# Shard 3 Worktree Audit

Baseline: `ae94a5075d92ebdc3625c13006a6dd4144dba4fa` in `/Users/mac/Baci-app`. Read-only audit of all 64 manifest rows. No worktrees, branches, indexes, or source files were changed; no tests/builds were run.

## Summary

- `PRESERVE_IMPROVEMENT`: 12
- `PRESERVE_DIRTY`: 24
- `ACTIVE_OR_UNCERTAIN`: 19
- `CLEAN_REDUNDANT`: 7
- `MISSING`: 2

Unique commits use `git log --right-only --cherry-pick baseline...HEAD`; paths use the three-dot baseline diff. Unique counts are not correctness claims. PR/remote branch state was checked live. Parent process/open-file review remains a separate retirement gate.

## Priority Salvage

| Priority | Checkout | Evidence |
|---|---|---|
| P1 | ID 12 | Open PR #3580 at exact local HEAD; receipt/invoice flow; two dirty receipt-hook tests. |
| P1 | ID 15 | Open PR #3616 at exact local HEAD; search/cart assurance; four dirty cart-repricing files. |
| P1 | ID 177 | Open PR #3597 is ahead of local HEAD; 20 dirty refund/cancellation files need reconciliation. |
| P1 | ID 45 | 133 unique commits, 51 dirty desktop-intake files; `.env.local` filename noted, contents unread. |
| P1 | IDs 33 and 84 | Same committed HEAD, 107 versus 17 distinct dirty files; reconcile both local edit sets. |
| P1 | ID 3 | PR #3623 is merged at this head, but 1,047 tracked `apps/web/docs` deletions remain locally. |
| P1 | ID 63 | Six unique CWV runner commits plus 227 dirty infra files. |
| P2 | ID 24 | Plan-tier-authoritative entitlement and append-only snapshot migration, distinct from baseline. |
| P2 | ID 72 | Merchant identity authorization and guarded SQL migrations/tests, distinct from baseline. |
| P2 | IDs 27, 90, 105, 183, 186, 189, 192 | Related remediation worker/capability/claim/cleanup changes; reconcile as a family. |
| P2 | IDs 141 and 144 | Overlapping storefront-AI/PageSpec/preview feature family; semantic review incomplete. |
| P2 | IDs 54 and 126 | Large archive invalidation and cache-invalidation branches; preserve/reconcile before retirement. |
| P2 | ID 66 | Open PR #3353 at exact local HEAD for CWV/analytics work; preserve for current review. |

## Per-Checkout Findings

| ID | Path | HEAD / branch | Unique / changed | Dirty entries | Classification and finding |
|---:|---|---|---:|---:|---|
| 3 | `/Users/mac/.codex/worktrees/baci-blog-draft-handoff/Baci-app` | `3bb6a36c9681` / `codex/blog-review-handoff` | 125 / 325 | 1047 | PRESERVE_DIRTY: PR #3623 is merged at this exact head, but 1,047 tracked deletions remain under apps/web/docs; preserve this dirty state. |
| 6 | `/Users/mac/.codex/worktrees/checkout-3577-pre-slice` | `0e65eba26d21` / `DETACHED` | 0 / 0 | 0 | CLEAN_REDUNDANT: Clean detached checkout; zero patch-unique commits and zero changed paths. |
| 9 | `/Users/mac/.codex/worktrees/event-worker-api-isolation/Baci-app` | `7d3cd523b140` / `codex/event-worker-api-isolation` | 0 / 0 | 204 | PRESERVE_DIRTY: No unique commits; 204 tracked event-worker source/test changes remain uncommitted. |
| 12 | `/Users/mac/.codex/worktrees/manual-order-receipt-email/Baci-app` | `46fd50fb31b6` / `codex/manual-order-receipt-email-pr` | 231 / 272 | 2 | PRESERVE_DIRTY: Open PR #3580 at exact HEAD for manual-order receipt/invoice email; 231 unique commits plus two dirty receipt-hook tests. |
| 15 | `/Users/mac/.codex/worktrees/ogabassey-search-refinements/Baci-app` | `70f729f06837` / `codex/ogabassey-search-refinements` | 182 / 605 | 4 | PRESERVE_DIRTY: Open PR #3616 at exact HEAD for search discovery/cart assurance; 182 unique commits plus four dirty cart-repricing files. |
| 18 | `/Users/mac/.codex/worktrees/piggyvest-architecture-audit/Baci-app` | `59f62320b243` / `DETACHED` | 114 / 672 | 115 | PRESERVE_DIRTY: 114 unique commits / 672 paths plus 115 dirty PiggyVest/payment source files; complex, not fully reviewed. |
| 21 | `/Users/mac/.codex/worktrees/shipping-migration-audit/Baci-app` | `9820841a377e` / `codex/shipping-migration-audit` | 2 / 12 | 0 | CLEAN_REDUNDANT: PR #3506 merged at exact HEAD; clean; ignored data limited to generated/dependency artifacts. |
| 24 | `/Users/mac/Baci-app/.claude/worktrees/agent-a27f15a03ad086e97` | `ef133c4cb678` / `worktree-agent-a27f15a03ad086e97` | 1 / 13 | 0 | PRESERVE_IMPROVEMENT: Plan-tier-authoritative entitlement, tests, and append-only snapshot migration; baseline patch filter finds no equivalent commit. |
| 27 | `/Users/mac/Baci-app/.worktrees/3309-transition-p1-integration` | `975cca2707d1` / `codex/3309-transition-p1-integration` | 23 / 42 | 0 | ACTIVE_OR_UNCERTAIN: 23 unique remediation transition/canary commits; broad VPS-worker change set with no matching remote branch/PR. |
| 30 | `/Users/mac/Baci-app/.worktrees/android-svg-anr-fix` | `ea750bc12d0b` / `codex/android-svg-anr-regression` | 1 / 1 | 0 | PRESERVE_IMPROVEMENT: Localized unique test-only tightening of static GadgetPattern backdrop regression guard. |
| 33 | `/Users/mac/Baci-app/.worktrees/baci-connector-r0` | `9e9a95acd8e9` / `feat/baci-connector-r0` | 38 / 219 | 107 | PRESERVE_DIRTY: 38 unique OAuth/social-ads connector commits and 107 dirty source/docs files. Same committed HEAD as ID 84, distinct local dirt. |
| 36 | `/Users/mac/Baci-app/.worktrees/chowdeck-marketplace-design` | `2027fd8e067a` / `codex/chowdeck-marketplace-design` | 3 / 28 | 38 | PRESERVE_DIRTY: Chowdeck evidence/schema package: three unique commits and 38 dirty contract/evidence/test files. |
| 39 | `/Users/mac/Baci-app/.worktrees/credit-direct-final` | `0a9fa0301eec` / `DETACHED` | 4 / 10 | 7 | PRESERVE_DIRTY: Four unique commits plus seven dirty checkout/payment files. |
| 42 | `/Users/mac/Baci-app/.worktrees/cwv-critical-viewport-home` | `9671aa6776c3` / `codex/h0-cwv-measurement-runner` | 2 / 1 | 3 | ACTIVE_OR_UNCERTAIN: CWV runner planning; two unique docs commits, three dirty entries, and ignored plan/review artifacts. |
| 45 | `/Users/mac/Baci-app/.worktrees/desktop-device-intake-implementation` | `6e02e78c6f87` / `codex/desktop-device-intake-implementation` | 133 / 722 | 51 | PRESERVE_DIRTY: 133 unique desktop-intake commits and 51 dirty desktop files. apps/web/.env.local filename noted; contents not read. |
| 48 | `/Users/mac/Baci-app/.worktrees/expo-dev-client-flow` | `9c494b63e72d` / `codex/expo-dev-client-flow` | 6 / 3 | 2 | PRESERVE_DIRTY: Six unique mobile-admin app-config commits plus two dirty config/test files; branch absent remotely. |
| 51 | `/Users/mac/Baci-app/.worktrees/expo-react-compiler` | `a82b2cb2a1df` / `codex/expo-react-compiler` | 6 / 5 | 0 | PRESERVE_IMPROVEMENT: Expo React Compiler enablement for mobile-admin with config tests; branch absent remotely. |
| 54 | `/Users/mac/Baci-app/.worktrees/fix-archive-fallback-keys` | `f6791924f086` / `codex/fix-archive-fallback-keys` | 44 / 115 | 0 | ACTIVE_OR_UNCERTAIN: 44 unique archive-fallback invalidation commits / 115 paths; broad series not semantically reviewed. |
| 57 | `/Users/mac/Baci-app/.worktrees/fix-vercel-cloudflare-env-sync` | `2a2ffc9bd006` / `codex/fix-vercel-cloudflare-env-sync` | 2 / 2 | 0 | ACTIVE_OR_UNCERTAIN: PR #3297 is closed unmerged at this exact head; inspect closure rationale/current main before reuse. |
| 60 | `/Users/mac/Baci-app/.worktrees/gigl-tracking-notifications` | `9e722420726a` / `codex/gigl-tracking-notifications-rebased` | 22 / 208 | 0 | CLEAN_REDUNDANT: PR #3248 merged at this exact head; clean status and only generated/build data ignored. |
| 63 | `/Users/mac/Baci-app/.worktrees/h0-cwv-task3-prep` | `158caf7e8a41` / `codex/h0-cwv-task3-prep` | 6 / 58 | 227 | PRESERVE_DIRTY: Six unique CWV-runner commits plus 227 dirty infra runner files. |
| 66 | `/Users/mac/Baci-app/.worktrees/h0-task9-receipt-current-20260815` | `ae4dbca94551` / `codex/h0-task9-receipt-20260815` | 47 / 156 | 0 | PRESERVE_IMPROVEMENT: Open PR #3353 at exact local HEAD for CWV/analytics inventory; keep available for review. |
| 69 | `/Users/mac/Baci-app/.worktrees/macos-merchant-app-plan` | `0c56f0cc8d2d` / `codex/macos-merchant-app-plan` | 5 / 4 | 2 | PRESERVE_DIRTY: Five unique planning commits, two dirty plan/design files, and ignored planning data. |
| 72 | `/Users/mac/Baci-app/.worktrees/merchant-settings-security` | `d611b6df45ed` / `codex/merchant-settings-security` | 1 / 18 | 0 | PRESERVE_IMPROVEMENT: Merchant identity security: authorized merchant access, restricted update schema, guarded identity/social-media migrations and SQL tests. Baseline route differs. |
| 75 | `/Users/mac/Baci-app/.worktrees/middleware-modularization-20260912` | `c0958bb54ced` / `codex/middleware-modularization-20260912` | 13 / 103 | 0 | ACTIVE_OR_UNCERTAIN: PR #3513 merged at exact HEAD, but ignored .superpowers/sdd planning/report data remains; inspect before retirement. |
| 78 | `/Users/mac/Baci-app/.worktrees/mobile-builder-v1-recovered` | `94a805642f68` / `DETACHED` | null / null | null | MISSING: Manifest path absent; no Git metadata or file status. |
| 81 | `/Users/mac/Baci-app/.worktrees/negotiation-notification-fix` | `643296b14350` / `codex/negotiation-focus-subscription` | 3 / 7 | 0 | CLEAN_REDUNDANT: PR #3463 merged at exact HEAD; clean; only generated Expo/build data ignored. |
| 84 | `/Users/mac/Baci-app/.worktrees/ogabassey-device-trust` | `9e9a95acd8e9` / `codex/ogabassey-device-trust` | 38 / 219 | 17 | PRESERVE_DIRTY: Same committed HEAD as ID 33, but 17 separate dirty storefront/support/IMEI files. |
| 87 | `/Users/mac/Baci-app/.worktrees/ogabassey-timeout-storm-fix` | `420c3889428c` / `codex/ogabassey-timeout-storm-fix` | 6 / 20 | 0 | PRESERVE_IMPROVEMENT: Unique semantic-RPC timeout change disables retries after timeout; focused tests added. Broader function diff merits deeper review. |
| 90 | `/Users/mac/Baci-app/.worktrees/ownerless-followup-terra-sparse` | `e5dac2f768f0` / `codex/3305-terra-followup-six-sparse` | 41 / 104 | 0 | ACTIVE_OR_UNCERTAIN: 41 unique remediation fallback/workflow commits / 104 paths; compare with related remediation worktrees. |
| 93 | `/Users/mac/Baci-app/.worktrees/perf-home-lcp-20260912` | `f53590f7593e` / `perf/home-lcp-isolate-20260912` | 0 / 0 | 14 | PRESERVE_DIRTY: No unique commits, but 14 dirty SEO/storefront files. Root and apps/web .env.local filenames only; contents not read. |
| 96 | `/Users/mac/Baci-app/.worktrees/pr-3055-heartbeat` | `7cc01c64869d` / `codex/pr-3055-heartbeat` | 3 / 13 | 1 | PRESERVE_DIRTY: Three unique repair-transition commits plus one dirty address-suggestions source file. |
| 99 | `/Users/mac/Baci-app/.worktrees/pr3203-security-fixes` | `12d639fa60a1` / `codex/pr3203-security-fixes` | 5 / 31 | 14 | PRESERVE_DIRTY: Five unique chat security/tenant-boundary commits plus 14 dirty Santa/chat files. |
| 102 | `/Users/mac/Baci-app/.worktrees/pr3275-cost-cut` | `2bf2c04b91a0` / `codex/gigl-direct-worker-cost-cut` | 121 / 147 | 1 | PRESERVE_DIRTY: PR #3275 merged at exact local HEAD; preserve the independent untracked logs/ data. |
| 105 | `/Users/mac/Baci-app/.worktrees/pr3309-direct-process-handoff-sparse` | `ddca5b4783fb` / `codex/3309-direct-process-handoff` | 19 / 39 | 0 | ACTIVE_OR_UNCERTAIN: 19 unique remediation handoff commits / 39 paths; clean and remote branch absent. |
| 108 | `/Users/mac/Baci-app/.worktrees/pr3310-nemotron-fixes` | `ce9be811acd2` / `codex/pr3310-nemotron-fixes` | 34 / 119 | 1 | PRESERVE_DIRTY: 34 unique builder-preview commits plus one dirty shared render-policy contract. |
| 111 | `/Users/mac/Baci-app/.worktrees/quiz-instant-results-release-20260830` | `03199cc64332` / `codex/mobile-image-payload-optimization` | 2 / 11 | 0 | CLEAN_REDUNDANT: PR #3431 merged at exact local HEAD; clean status and no meaningful ignored data found. |
| 114 | `/Users/mac/Baci-app/.worktrees/readiness-round4-sol-fix` | `63cf0ea13551` / `codex/readiness-round4-sol-fix` | 38 / 115 | 0 | ACTIVE_OR_UNCERTAIN: 38 unique readiness commits; review with ID 117 before salvage. |
| 117 | `/Users/mac/Baci-app/.worktrees/readiness-task8-mobile-query` | `69777c970697` / `codex/readiness-task8-mobile-query` | 19 / 64 | 0 | ACTIVE_OR_UNCERTAIN: 19 unique readiness commits including load-failure state; review with ID 114 before salvage. |
| 120 | `/Users/mac/Baci-app/.worktrees/reconcile-cron-audit-20260821` | `18c6e963f8f9` / `codex/reconcile-cron-audit-20260821` | 0 / 2 | 0 | CLEAN_REDUNDANT: No patch-unique commits; two changed paths are patch-equivalent; clean, only generated/dependency data ignored. |
| 123 | `/Users/mac/Baci-app/.worktrees/remediator-main-merged-final` | `9acddc04d720` / `codex/fix-sentry-issue-event-route` | 1 / 3 | 3 | PRESERVE_DIRTY: Unique scoped Sentry issue-event route plus dirty worker/docs paths and ignored logs. |
| 126 | `/Users/mac/Baci-app/.worktrees/s1-pr2-auth-containment` | `2875b2c14584` / `codex/b0-durable-cache-invalidation` | 10 / 70 | 29 | PRESERVE_DIRTY: Ten unique durable cache-invalidation commits plus 29 dirty event/cache files. |
| 129 | `/Users/mac/Baci-app/.worktrees/seo-discovery-20260912` | `055cbce39382` / `codex/seo-discovery-20260912` | 0 / 0 | 14 | PRESERVE_DIRTY: No unique commits, but 14 dirty SEO/storefront source/test files. |
| 132 | `/Users/mac/Baci-app/.worktrees/shopify-inventory-luna` | `56fe51ab77da` / `codex/shopify-inventory-luna` | 1 / 1 | 0 | PRESERVE_IMPROVEMENT: Unique test-only serialized inventory concurrency contract suite. |
| 135 | `/Users/mac/Baci-app/.worktrees/shopify-rate-limit-luna` | `4e355286df8c` / `codex/shopify-rate-limit-luna` | 1 / 4 | 0 | PRESERVE_IMPROVEMENT: Rate-limit backend-fallback diagnostics in runtime instrumentation and focused tests. |
| 138 | `/Users/mac/Baci-app/.worktrees/storefront-agp-9-1` | `1c0dd3b154c2` / `codex/storefront-agp-9-1` | 9 / 4 | 0 | PRESERVE_IMPROVEMENT: AGP 9 compatibility and multiline classpath handling with focused config tests. |
| 141 | `/Users/mac/Baci-app/.worktrees/storefront-ai-r1` | `d11558e06044` / `feat/storefront-ai-r2` | 31 / 202 | 0 | ACTIVE_OR_UNCERTAIN: 31 unique storefront-AI/PageSpec/builder-preview commits / 202 paths; complex feature family. |
| 144 | `/Users/mac/Baci-app/.worktrees/storefront-ai-w0` | `b3ed77628ed7` / `feat/storefront-ai-w0` | 26 / 99 | 0 | ACTIVE_OR_UNCERTAIN: 26 unique storefront-AI W0 commits / 99 paths; overlaps ID 141. |
| 147 | `/Users/mac/Baci-app/.worktrees/storefront-seo-baseline` | `d2c7d8ca9e66` / `codex/storefront-seo-baseline` | 1 / 6 | 34 | PRESERVE_DIRTY: One unique SEO mapper commit plus 34 dirty storefront SEO/page/sitemap files. |
| 150 | `/Users/mac/Baci-app/.worktrees/task57-protected-anchors` | `bc0b19a3dd42` / `codex/task57-protected-anchors` | 2 / 87 | 0 | PRESERVE_IMPROVEMENT: Builder-AI structural guard changes protect internal layout anchors with regression tests. |
| 153 | `/Users/mac/Baci-app/.worktrees/vercel-active-cpu-memory-config` | `bcdbf54cb591` / `codex/vercel-active-cpu-memory-config` | null / null | null | MISSING: Manifest path absent; no Git metadata or file status. |
| 156 | `/Users/mac/Baci-app/.worktrees/vps-remediator-deploy` | `15c8d5dcbc52` / `codex/sentry-remediator-event-evidence` | 1 / 9 | 0 | ACTIVE_OR_UNCERTAIN: PR #3304 is closed unmerged at exact head; check closure rationale/current main before reuse. |
| 159 | `/Users/mac/Baci-worktrees/compare-preflight-slow-fetch-fix` | `b2597e3b43a1` / `codex/chat-catalog-merchant-binding` | 1 / 18 | 0 | ACTIVE_OR_UNCERTAIN: Merchant-host binding fix has closed unmerged PR #3453; check closure/current-main behavior before reuse. |
| 162 | `/Users/mac/Baci-worktrees/home-js-diet` | `a38ceb3babe5` / `perf/home-boot-js-diet` | 4 / 4 | 0 | ACTIVE_OR_UNCERTAIN: Four unique analytics/PDP static-params commits; branch purpose differs from observed patch set. |
| 165 | `/Users/mac/Baci-worktrees/ios-watchdog-fix` | `bafc2e44781b` / `codex/ios-watchdog-fix` | 1 / 4 | 0 | PRESERVE_IMPROVEMENT: iOS memory-warning diagnostics helper and error-monitoring tests. |
| 168 | `/Users/mac/Baci-worktrees/pdp-core-snapshot-fix` | `882c3e27d091` / `codex/pdp-core-snapshot-fix` | 1 / 2 | 0 | PRESERVE_IMPROVEMENT: PDP core snapshot retries one retryable transient read under a single deadline; focused tests. |
| 171 | `/Users/mac/Baci-worktrees/pr-3444-checkout-retry-resume` | `c59cd1fd239b` / `fix/checkout-retry-codex-followup` | 18 / 108 | 0 | CLEAN_REDUNDANT: PR #3462 merged at exact HEAD; clean; no meaningful ignored data observed. |
| 174 | `/Users/mac/Baci-worktrees/pr3231-order-schema` | `c25ef6c84882` / `codex/pr3231-order-schema-fix` | 1 / 5 | 0 | ACTIVE_OR_UNCERTAIN: PR #3231 is closed unmerged at exact head; verify closure rationale and current schema before reuse. |
| 177 | `/Users/mac/Baci-worktrees/pr3597-order-refunds` | `70fe0944fa83` / `feat/order-refund-management` | 11 / 35 | 20 | PRESERVE_DIRTY: Open PR #3597 remote head 8ba03c467ba8 is ahead of local 70fe0944fa83; 20 dirty refund/cancellation files need reconciliation. |
| 180 | `/Users/mac/Baci-worktrees/remediation-research-gate-fix` | `8a18c776b4e8` / `DETACHED` | 4 / 24 | 1 | PRESERVE_DIRTY: Four unique remediation research/delivery-gate commits plus dirty/ignored logs. |
| 183 | `/Users/mac/Baci-worktrees/terra-3305-cleanup-path-canonical` | `5419d8dd3f74` / `codex/3305-cleanup-path-canonical` | 46 / 105 | 0 | ACTIVE_OR_UNCERTAIN: 46 unique remediation cleanup-path commits / 105 paths; compare against related branches. |
| 186 | `/Users/mac/Baci-worktrees/terra-3309-autofix-capability` | `304b11c62770` / `codex/3309-autofix-capability` | 13 / 33 | 0 | ACTIVE_OR_UNCERTAIN: 13 unique remediation capability commits / 33 paths; compare overlaps. |
| 189 | `/Users/mac/Baci-worktrees/terra-3309-claim-matrix` | `d65b60f2bb94` / `codex/3309-claim-matrix` | 6 / 9 | 0 | ACTIVE_OR_UNCERTAIN: Six unique stale-claim recovery commits; compare with lock-recovery peers. |
| 192 | `/Users/mac/Baci-worktrees/terra-3309-storage-sidecar-cleanup` | `82db689a6dd6` / `codex/3309-storage-sidecar-cleanup` | 4 / 7 | 0 | ACTIVE_OR_UNCERTAIN: Four unique lock-sidecar cleanup commits; compare with IDs 189/186. |

## Direct Baseline Checks

- ID 24: `apps/web/src/lib/feature-flags.ts` removes legacy premium-slug entitlement fallback and fails closed on absent/malformed `plan_tier`; its commit also adds the NOT NULL snapshot migration and replay coverage. The patch filter found no equivalent commit in frozen baseline.
- ID 72: baseline `apps/web/src/app/api/merchant/settings/route.ts` accepts a requested merchant ID through `getMerchantForApiRequest`; the branch resolves `getUserAccess` and checks settings permission, and adds guarded identity/social-media migrations and SQL tests. This is a preservation candidate, not proof of production authorization.
- ID 87: semantic inventory diff removes the total-timeout/retry wrapper and changes cache identity inputs. The commit title says timeout retry suppression, but this broader diff needs review; not asserted as verified improvement.
- ID 150: builder structure guard changes protected-anchor representation and duplicate-ID resolution with dedicated tests.
- ID 168: `readStorefrontPdpCoreSnapshot` retries one retryable failure under a shared deadline signal; baseline file differs.
- ID 174: unique append-only migration restores storefront order-private schema usage and adds replay/history tests, but PR #3231 closed unmerged at the exact head; verify closure rationale/current schema before reuse.

## Boundaries

- `.env` names only were recorded; no contents opened. Ignored SDD plans/review reports and logs were not inspected; such local data blocks a clean-retirement conclusion until preserved or explicitly reviewed.
- Merged PR status does not remove independent dirty/untracked data. PR #3623 is merged at the audited head; timing relative to the supplied baseline is not asserted.
- `CLEAN_REDUNDANT` is scoped to the observed baseline and metadata; the parent must recheck process/open-file references and fresh Git status before any future deletion.
- No PR was created, and no cleanup action was taken.
