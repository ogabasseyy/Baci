# Baci worktree retirement audit

## Scope and evidence

This is a read-only retirement triage of 193 registered Baci worktrees captured
on 2026-10-10, split between three GPT-6 Luna agents. Comparison baseline:
`ae94a5075d92ebdc3625c13006a6dd4144dba4fa` (`origin/main`, fetched on the audit date).
The findings branch itself is excluded from the inventory.

No audited worktree, source, dependency directory, branch, or process was removed.
The requested 90% retirement target is an aspiration, not a safety assumption.
Potential improvements are candidates for a separate implementation/review PR;
this documentation PR does not cherry-pick code or prove runtime correctness.

## Findings

| Classification | Count |
| --- | ---: |
| Code-redundant retirement candidates | 20 |
| Dirty/local work to preserve | 80 |
| Potential improvement/preservation candidates | 53 |
| Active or uncertain | 36 |
| Missing checkouts | 4 |
| Total audited | 193 |

Only 20/193 (10.4%) currently qualify for the code-redundant shortlist. A 90%
direct-deletion recommendation is not supported. A larger archive-first batch
may be possible after ownership, recoverability, and ignored-data checks.

All 20 shortlist HEADs were unchanged and Git-clean on the parent's recheck at
2026-10-10T13:33:11Z. The follow-up process snapshot found no references except
Watchman monitoring for ID 171. This is not proof that an owning chat is inactive.
Ignored-file scans were bounded, so the shortlist remains a candidate list,
not an unconditional removal list. See [candidate-recheck.json](./candidate-recheck.json).

### Code-redundant shortlist

| ID | Worktree | Evidence |
| ---: | --- | --- |
| 5 | `/Users/mac/.codex/worktrees/blog-rss-xml-safety/Baci-app` | Exact PR #3617 head is MERGED; clean worktree; ignored entries were generated/type artifacts only. |
| 6 | `/Users/mac/.codex/worktrees/checkout-3577-pre-slice` | Clean detached checkout; zero patch-unique commits and zero changed paths. |
| 7 | `/Users/mac/.codex/worktrees/checkout-payment-switch/Baci-app` | Exact merged PR head, clean Git status; 263 sampled ignored media/report files byte-identical to primary. |
| 21 | `/Users/mac/.codex/worktrees/shipping-migration-audit/Baci-app` | PR #3506 merged at exact HEAD; clean; ignored data limited to generated/dependency artifacts. |
| 29 | `/Users/mac/Baci-app/.worktrees/android-soloader-fix` | The native-library extraction setting is already enabled in baseline gradle.properties and Expo plugin config; clean branch alternative adds no unique behavior. |
| 58 | `/Users/mac/Baci-app/.worktrees/fix-web-ios-production-deploys` | Exact merged PR head, clean Git status, bounded ignored media/report sample duplicates primary. |
| 60 | `/Users/mac/Baci-app/.worktrees/gigl-tracking-notifications` | PR #3248 merged at this exact head; clean status and only generated/build data ignored. |
| 79 | `/Users/mac/Baci-app/.worktrees/mobile-native-crash-fixes-20260908` | Exact merged PR head, clean Git status, bounded ignored media/report sample duplicates primary. |
| 81 | `/Users/mac/Baci-app/.worktrees/negotiation-notification-fix` | PR #3463 merged at exact HEAD; clean; only generated Expo/build data ignored. |
| 97 | `/Users/mac/Baci-app/.worktrees/pr-3281-agentic-health` | Exact merged PR head, clean Git status, bounded ignored media/report sample duplicates primary. |
| 104 | `/Users/mac/Baci-app/.worktrees/pr3284-shipping-empty-quotes` | Exact PR #3284 head is MERGED; clean worktree; no meaningful ignored data observed. |
| 111 | `/Users/mac/Baci-app/.worktrees/quiz-instant-results-release-20260830` | PR #3431 merged at exact local HEAD; clean status and no meaningful ignored data found. |
| 120 | `/Users/mac/Baci-app/.worktrees/reconcile-cron-audit-20260821` | No patch-unique commits; two changed paths are patch-equivalent; clean, only generated/dependency data ignored. |
| 130 | `/Users/mac/Baci-app/.worktrees/shipping-legacy-client-20260908` | Exact merged PR head, clean Git status, bounded ignored media/report sample duplicates primary. |
| 131 | `/Users/mac/Baci-app/.worktrees/shopify-catalog-ci-luna` | Baseline UCP adapter already rejects invalid/unpriced products and trims identity fields; branch fix is superseded by current main behavior. |
| 152 | `/Users/mac/Baci-app/.worktrees/variant-review-followups` | ancestor of baseline; clean |
| 158 | `/Users/mac/Baci-worktrees/category-recent-carousel` | empty tree diff despite unique commit subject |
| 170 | `/Users/mac/Baci-worktrees/posthog-followup-secondary` | empty tree diff despite unique commit subject |
| 171 | `/Users/mac/Baci-worktrees/pr-3444-checkout-retry-resume` | PR #3462 merged at exact HEAD; clean; no meaningful ignored data observed. |
| 175 | `/Users/mac/Baci-worktrees/pr3322-ci-fix` | Exact merged PR head, clean Git status, bounded ignored media/report sample duplicates primary. |

### Preservation priorities

- PiggyVest/payment local work: IDs 2, 18, 19, 38, 169, 177, 178. Several open PRs
  coexist with independent dirty changes; do not treat the remote PR as a backup
  of the checkout's full state.
- Broad source deletions/local edits: IDs 3, 77, 94, 148, 160. Resolve sparse or
  deliberate deletion state with the owner; do not assume these are caches.
- Security/entitlement candidates: IDs 24 and 72 have focused current-baseline
  comparisons in shard 3. Recheck retracted the cited evidence (safeguards
  already in baseline); do not salvage on the original claims.
- Storefront timeout/PDP/builder candidates: IDs 87, 150, 168 have behavior-level
  differences worth review; the timeout patch also changes cache identity and
  must not be transplanted blindly.
- Remediation/VPS-worker family: related IDs across all shards contain
  overlapping lock, claim, handoff, recovery, and cleanup changes. Consolidate
  exact patches rather than merging all branches independently.
- IDs 29 and 131 illustrate superseded alternatives: focused checks found the
  intended safeguards already in baseline; unique history was not enough.

### Reports

- [Shard 1: 65 worktrees](./audit-findings-1.md)
- [Shard 2: 64 worktrees](./audit-findings-2.md)
- [Shard 3: 64 worktrees](./audit-findings-3.md)
- [Consolidated inventory with PR matches](./inventory.json)

## Classification rules

- `CLEAN_REDUNDANT`: committed code appears already represented in main and no
  meaningful tracked/untracked changes were found. Ignored data must still be
  preserved before removal.
- `PRESERVE_IMPROVEMENT`: potentially useful differences remain outside main.
  Review the concrete findings before deciding to salvage or discard them.
- `PRESERVE_DIRTY`: local tracked or untracked changes require preservation;
  a merged PR does not authorize discarding them.
- `ACTIVE_OR_UNCERTAIN`: active, locked, ambiguous, or insufficiently inspected.
- `MISSING`: checkout is absent. Git registration cleanup is separate from source
  retirement and requires a fresh check.

These labels are triage, not deletion authorization. A clean Git status excludes
ignored files; environment files, reports, media, and databases can still exist.
Remote-tracking references can be stale; only the explicitly recorded GitHub or
live remote checks confirm remote preservation.

Preserving code does not necessarily require keeping its checkout indefinitely.
A verified archive can make inactive dirty/unique trees retireable without first
merging their code into main. Keep the archive and a recovery mapping until the
owner resolves the findings. Do not bulk-merge old branches to reach a disk-space
target; unique changes can be obsolete, regressive, or already squash-merged.

## Retirement procedure

1. Recheck HEAD, status, ignored data, locks, process references, and owning chat
   immediately before acting. Concurrent tasks can invalidate this snapshot.
2. For a managed Codex worktree, use its supported archive operation to preserve
   recoverable Git state. Preserve required ignored files separately, since they
   are not included in the archive snapshot.
3. For other trees, preserve uncommitted and untracked work plus any local-only
   commits in a verified recoverable backup before removing a checkout.
4. Review improvement candidates individually against the then-current main;
   port only valid behavior with regression tests and required PR checks.
5. Remove only the specifically approved trees. Do not delete shared Git objects
   or infer a reclaimable-space amount from summed worktree directory sizes.
6. Measure actual free space with `df` before and after. APFS cloning and shared
   dependencies make logical directory sizes an unreliable reclaim estimate.

## Activity snapshot

The parent collected an `lsof` process-reference snapshot on the audit date.
Watchman-only references indicate monitoring, not necessarily an active task.
Absence of a reference does not establish inactivity. Audit subprocesses can
also appear in the snapshot. Primary-checkout matches include nested worktrees.

Strong process references were present for inventory IDs 11 (`issue-3581`),
20 (`production-release-coordination`), and 127 (`sec-leftover-14`); keep them
out of any immediate retirement batch until ownership and fresh activity checks.
ID 161 had a Git reference that may be an audit subprocess. The primary checkout
is dirty and must be retained independently of process-reference interpretation.

## Validation boundary

This is documentation-only. Inventory coverage, identifiers, baseline and local
Markdown references are checked; no application builds, dependency installs, or
runtime tests are implied. The shard reports record semantic spot inspections
and unresolved questions. Findings are not a claim that every unique line is
correct, needed, or safe to merge.

Local validation passed: all 193 IDs are represented exactly once; per-shard
category counts and the consolidated inventory agree; local Markdown links
resolve; all 20 candidate HEAD/status rechecks passed; missing-checkout flags
agree with their classifications; and `git diff --check` passed. CodeRabbit
completed its documentation review with one minor JSON consistency issue,
corrected after verifying the two absent paths. Application checks were not run
because this PR changes only audit documentation/data.
