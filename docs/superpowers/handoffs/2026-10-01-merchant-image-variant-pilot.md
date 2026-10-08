# Merchant image variant pilot — implementation handoff

This is the prompt for the implementation agent. The owner wants you to implement the bounded local pilot, then return the exact diff and evidence to the original Codex reviewer. It is not production activation approval.

## Workspace and authoritative documents

Work in `/Users/mac/.codex/worktrees/merchant-image-pilot/Baci-app`, on `codex/merchant-image-pilot`.

Read completely:

- Applicable repository and directory `AGENTS.md` instructions; `apps/web/CLAUDE.md` before web changes.
- `/Users/mac/.codex/worktrees/merchant-image-pilot/Baci-app/docs/superpowers/specs/2026-10-01-merchant-image-variant-pilot-design.md` — authoritative design, including its uncommitted rereview corrections.
- `/Users/mac/Baci-app/docs/agent-guidance/validation.md` — read-only current owner validation guidance. This frozen worktree lacks that newer file; do not copy unrelated primary-checkout code to obtain it. The final commands required for this cross-package/dependency pilot are also stated below.
- `/Users/mac/.codex/worktrees/merchant-image-pilot/Baci-app/docs/perf/storefront-visual-regression.md` — browser evidence workflow.

Optional historical evidence: `/Users/mac/.codex/cwv-lab-builds/20261001-merchant-sample/IMAGE-PIPELINE-INVESTIGATION.md`. Treat historical measurements as observations, not fixtures or proof of improvement. If unavailable, disclose it and capture bounded read-only public input snapshots rather than inventing evidence.

Verify branch, HEAD and status first. The last verified state contains the modified design and this handoff; runtime implementation has not started. Preserve all existing edits. Do not implement in the heavily dirty `/Users/mac/Baci-app` checkout, reset the branch, discard the revised design or silently move to a different baseline. You are not alone in the codebase: preserve other agents' work and adapt to overlaps. Report a conflict you cannot safely isolate.

## Goal and authorized scope

Build the design's offline, tenant-scoped image variant generator, verified versioned manifests, hash-bound visual acceptance, bounded server-only lab index, explicit mounted-consumer adapters, regression coverage and four-store acceptance report.

Selected sample stores: Omnimart, SquishyLand, Zorvexa and the current OgaBassey hero. Freeze real input bytes and identity; never hardcode an old FC-27/Dell hero as the current source.

This is local pilot implementation only. Do not:

- Deploy, push, open/merge a PR or activate a production worker before the owner/reviewer approves the result.
- Change VPS services/resources, DNS, production Storage/catalog/configuration or live uploads.
- Disable Supabase transforms, migrate native clients, remove originals or introduce service-role exceptions.
- Edit `.env*`, `apps/web/src/proxy.ts` or `apps/web/src/config/business-types.ts` without separate explicit authorization.
- Change guards, Suspense ownership, critical-shell order, global image settings, homepage loading architecture or unrelated CSS/JS to improve a score.
- Re-run rejected scheduling/CSS experiments, waive validation or label an unresolved failed request a clean run.

## Execution sequence

1. Use the writing-plans guidance to produce a focused implementation plan under `docs/superpowers/plans/`, with exact files, contracts, test cases and commands. Self-review it against every section of the design before runtime edits. Preserve any approval checkpoint required by your active instructions; any material design deviation must return to the owner/reviewer, not be assumed approved.
2. Record an ownership/file manifest and mounted-consumer coverage table. Discover the actual selected template/card renderer, CSS-background hero, logo/image components and all OgaBassey preload owners. Do not assume one shared loader covers them all.
3. Implement task-by-task using the execution guidance and tests first. Demonstrate the failing condition, implement minimally, then validate. Keep new modules focused, aiming at no more than 300 lines. Do not stage unrelated files or bypass required pre-commit review.
4. Generate and inspect deterministic fixture variants before real sampled assets. Produce the quality sheet and hash-bound pilot acceptance records before candidate browser comparisons. Do not equate machine-ready output with visual approval.
5. Perform scoped correctness checks during development, then the design's required final checks and controlled browser measurements. Respect host/disk gates; no concurrent build/test workload during performance captures and no unbounded quiet-window polling. If conditions never qualify, return the code/correctness evidence with performance explicitly incomplete.
6. Return a review packet and stop. The original Codex reviewer will inspect the implementation and evidence before any push/PR/deployment decision.

## Non-negotiable implementation contracts

The design owns exact values and behavior. In particular:

- Generator under `infra/cdn-transformer/`, accepting bounded local input only. No arbitrary remote resizing endpoint or first-shopper encoding.
- At most 20 jobs, one job/encoding at a time; input at most 10MiB, 40 million pixels and 16,384 pixels per axis. Reject unsupported/animated input. Preserve EXIF-corrected geometry, alpha and branding colors; no upscaling or silent crop.
- AVIF and WebP with explicit format URLs; quality ladder 70/65/60/55, not an unreviewed q35 experiment. Apply the design's decimal-byte role/tier budgets. Over-budget output at the floor fails the complete generation; do not lower resolution or quality further to manufacture compliance.
- Every native operation, including metadata and verification, must be killable. Maximum 15 seconds per operation and 120 seconds per job, with an absolute remaining deadline and confirmed child exit before releasing concurrency.
- Generation starts with at least 2GiB free; recheck between jobs and enforce the 100MiB per-job staging cap. Clean only owned failed staging. Observed RSS is not a hard memory guarantee or VPS readiness claim.
- Add the planned package-local pnpm workspace and lock without changing root membership. Preserve applicable root release-age/trust/build/security policies. Do not use `--ignore-workspace` or relax trust/build settings to make installation pass. Verify effective policy and lock identity.
- Identity includes merchant, asset ID, source bytes, role, recipe and encoder. Content-hash output paths, complete atomic generation commit, validated reuse, crash/sync failures and proven abandoned-claim recovery; no PID/age-only claim stealing.
- Bind mounted slot and exact original URL to the privately reviewed asset/source hash. Verify manifests, acceptance records and output hashes in preflight; rendering performs only a guarded in-memory lookup. No shopper-request acquisition, encoding or full-directory hashing; no all-tenant browser mapping.
- Preserve actual CSS box, crop mode, `sizes`, DPR adequacy, alt text, loading/priority and discovery timing. Width descriptors must equal encoded width. Out-of-coverage slots remain controls and are reported, not counted as optimized passes.
- One shared OgaBassey mobile projection for rendered sources and every hint owner. AVIF-only typed preload plus WebP fallback, no dual-format/stale preload downloads. Desktop/PDP remain unchanged. If the frozen baseline has an incorrect committed preload, block that comparison pending an upstream correction/refreeze; do not fix only the candidate and count it as an encoding gain.
- Missing/rejected/stale/foreign manifest retains the original control behavior and is reported as not optimized. Guards/publication/tenant isolation remain upstream.

## Verification and measurement

Implement the design's full regression matrix: tenant/path/source binding, decoder limits, orientation/alpha/color, budget failure, cancellation/timeouts, staging bounds, idempotency, hard-kill recovery/PID reuse, atomic/crash/sync failures, visual acceptance, bad-output preflight, I/O-free lookup, actual dimensions/descriptors, DPR coverage and preload identity. Use real deterministic image decoding/encoding; mock cloud/network boundaries only.

Run the final scope required by the design and repository:

```text
pnpm turbo lint
pnpm turbo typecheck
pnpm turbo test
pnpm --dir infra/cdn-transformer run check
coderabbit review --agent -t uncommitted
```

Extend the standalone `check` script to cover new modules; root Turbo does not cover that package. Verify actual commands/configuration before use. Fix failures caused by your changes; report pre-existing/unrelated failures separately. If CodeRabbit is unavailable, report the review gate as incomplete, do not claim it ran or bypass the repository's commit/submission requirement.

For browser evidence:

- Capture current public PSI baseline using the existing key privately; local candidate uses Lighthouse, not PSI.
- Full Chrome; Lighthouse and Sitespeed/Browsertime sequentially. Save HAR, trace, console, video/filmstrip, selected image identity/bytes and effective settings.
- Freeze the same source/content/build/profile/cache/site relationships. Original and derivative use the same asset origin, protocol and cache policy for the encoding comparison. Delivery-host changes are a separate experiment.
- Correctness coverage: mobile 360/390/412 at DPR 1/2/3; desktop 1365 at DPR 1/2. OgaBassey desktop is a control. Validate non-AVIF fallback with a suitable real browser; unavailable coverage remains incomplete.
- Quiet starts require load below 10, CPU idle above 50%, no competing builds/tests. Browser build/video batches require at least 10GiB free initially and stop at 5GiB. Contaminated captures are diagnostic only.
- Two reversed pairs are screening only. Promising results require at least five samples per arm on each claimed profile, with fixed sample/decision/exclusion rules. Include fast/slow links and cold/repeat visits without rebuilding each leg.
- Report LCP element/subparts, FCP, CLS, broken/duplicate downloads, failed requests, hydration, early/late frames and scroll behavior. A real blank is unresolved until explained, not noise by default.
- Return raw samples, paired deltas, medians/ranges, excluded legs and every store/slot's accepted/rejected/uncovered status. No universal 1.6KB, 2.5s LCP or production-p75 claim. A neutral result is legitimate; do not tune content/quality/throttling until the desired score appears.

## Review packet to return

### Lab isolation and fallback readiness (review follow-up)

- Non-lab Next configuration and Node startup reject staged merchant files in
  `public/__pilot`. Only the three hash-verified committed synthetic fillers
  are permitted. Keep lab builds/workspaces separate from deployable artifacts;
  use a clean public tree for non-lab builds. The gate never deletes evidence.
  Recovery is a clean tree, not a flag flip: `rm -rf apps/web/public/__pilot
  && git checkout -- apps/web/public/__pilot` (restores the committed
  fillers; staged bytes regenerate via `pnpm pilot:stage`).
- The no-AVIF profile uses Chromium CDP format emulation, not HTML rewriting;
  server markup and client hydration props remain identical. An unsupported
  CDP command fails before navigation. Retained AVIF candidates, confirmed
  emulation, WebP selection, and zero AVIF responses remain required.
- Browser coverage is not yet cleared: the bounded Chrome smoke selected
  WebP with clean hydration but still fetched an explicit AVIF preload.
  The readiness gate rejects this, rather than suppressing the request. Do
  not count this profile as passed or use it for performance comparisons.
- The opt-in `Pilot codec compatibility` workflow tests a native unsupported-
  codec candidate: pinned Playwright 1.55.1 WebKit on Windows 2022. Run via
  workflow dispatch, or apply the `pilot-codec-check` PR label (subsequent
  pushes to that labelled PR rerun it). It installs only the isolated locked
  runtime in `.github/fixtures/pilot-codec`, never the application workspace.
  The synthetic loopback fixture must prove AVIF decode unsupported, WebP
  decode supported, no AVIF request, unchanged picture sources, successful
  hydration and working interaction. It uploads JSON plus a screenshot.
  A pass validates this browser/fixture only, not the pilot surface matrix,
  current Safari, mobile performance or CWV. Integrate and run actual pilot
  pages only after this prerequisite is observed green. No app build, secrets,
  merchant data, deployment or production navigation is part of this job.
- One reset-provenance record certifies only one HAR navigation. Multi-page
  reports require separate single-navigation evidence, not one shared reset.

Provide:

1. Exact worktree, branch, base/HEAD, commit list if permitted and `git status`; manifest of task-owned changed/new files. State whether anything was pushed/deployed (expected: no).
2. Implementation plan with completed steps and a spec-to-code/test coverage map, including deviations and unresolved decisions.
3. Reproducible setup/generate/verify/serve commands without secrets, plus dependency-policy/version and manifest schema/recipe identities.
4. Test/lint/typecheck/standalone-check and CodeRabbit outcomes, with pre-existing failures and incomplete gates separated.
5. Image inventory, original/derivative bytes and dimensions, quality sheet paths, acceptance hashes, mounted-consumer coverage and fallback/tenant-safety evidence.
6. Before/after results per store/tool/profile and absolute artifact paths; preload/download, video/console/scroll inspection; exclusions and limits.
7. Honest recommendation: ready for reviewer inspection, needs fixes, or measurements blocked. Do not conflate implementation completion with production readiness.

Do not message other chats or initiate a rollout. Return the packet to the owner so they can bring it back to the original reviewer.
