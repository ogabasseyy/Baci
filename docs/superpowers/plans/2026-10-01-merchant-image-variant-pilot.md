# Merchant image variant pilot — implementation plan

Date: 2026-10-01
Branch: `codex/merchant-image-pilot` in `/Users/mac/.codex/worktrees/merchant-image-pilot/Baci-app`
Base: `635a1655aa` (`origin/main` at worktree creation). HEAD at plan time: `cfc3d0e08a`
  (`docs: define merchant image variant pilot`).
Design (authoritative):
`docs/superpowers/specs/2026-10-01-merchant-image-variant-pilot-design.md`
Handoff: `docs/superpowers/handoffs/2026-10-01-merchant-image-variant-pilot.md`
Validation guidance (read-only, primary checkout):
`/Users/mac/Baci-app/docs/agent-guidance/validation.md`
Evidence workflow: `docs/perf/storefront-visual-regression.md`

Status: plan for implementation. Runtime implementation has not started.
This is local pilot implementation only — no push, PR, deployment, production
worker, VPS change, or live-upload switch (see handoff §Goal).

## 0. Baseline facts verified before planning

- `git status`: only `M docs/superpowers/specs/...design.md` and
  `?? docs/superpowers/handoffs/`; no runtime edits yet.
- Toolchain: Node v24.11.1; repo pnpm pinned `11.7.0` via `packageManager`
  (use `corepack pnpm`; bare `pnpm` on PATH is 10.28.1 and must not resolve).
- `infra/cdn-transformer/package.json` is standalone (Sharp 0.35.4, Zod
  ^3.25.76), no lockfile, outside root workspace. Root policy to mirror:
  `minimumReleaseAge: 1440`, `trustPolicy: no-downgrade`, `trustLockfile: true`,
  `strictDepBuilds: true`, `allowBuilds: { sharp: true, ... }`,
  `overrides: { sharp: 0.35.4, ... }`.
- Investigation evidence exists at
  `/Users/mac/.codex/cwv-lab-builds/20261001-merchant-sample/IMAGE-PIPELINE-INVESTIGATION.md`
  (observations only, not fixtures).
- Disk at plan time: 9.3 GiB free on `/`. This is BELOW the 10 GiB start margin
  for browser build/video batches — browser evidence cannot start until the
  gate passes; code/correctness work proceeds regardless.
- Committed OgaBassey hero constant is the Dell Alienware URL
  (`apps/web/src/config/ogabassey.ts:22`). Per handoff, never treat it as the
  current source; the live slide-0 must be frozen from the hero-shell feed.

## 1. Goal and non-goals

Build exactly the design's offline, tenant-scoped variant generator with
verified versioned manifests, hash-bound visual acceptance, a bounded
server-only lab index, explicit mounted-consumer adapters, regression coverage,
and a four-store acceptance report (Omnimart, SquishyLand, Zorvexa, current
OgaBassey hero).

Out of scope: production worker/queue, Storage adapter writes, native-client
migration, Supabase-transform disable, originals removal, service-role
exceptions, `.env*` / `proxy.ts` / `business-types.ts` edits, guard/Suspense/
critical-shell/global-image/homepage-loading changes, CSS/JS score tuning.

## 2. Ownership / file manifest (task-owned)

Generator (all new, each ≤300 lines; `.mjs` + colocated `.test.mjs`):

- `infra/cdn-transformer/pilot/constants.mjs` — schema/policy/encoder/recipe
  versions, role ladder, budgets (decimal bytes), quality ladder 70/65/60/55,
  limits (10 MiB, 40M px, 16384/axis, 20 jobs, 15 s/op, 120 s/job, 2 GiB free,
  100 MiB staging), accepted input formats.
- `infra/cdn-transformer/pilot/job-schema.mjs` — validated job contract
  (Zod): schemaVersion, merchant UUID v4, assetId, source-relative path,
  expected SHA-256, role. Rejects absolute paths, traversal, encoded
  separators, NUL/controls, symlink escape, malformed IDs, unknown roles,
  duplicate conflicting jobs.
- `infra/cdn-transformer/pilot/input-store.mjs` — pilot input-root
  confinement, snapshot hashing (SHA-256 of bytes at acquisition), symlink
  realpath checks, mutation detection (re-hash before encode; mismatch fails).
- `infra/cdn-transformer/pilot/acquire.mjs` — bounded diagnostic acquisition
  CLI: public GET of reviewed URLs only → writes inventory record
  (exact URL, merchant, slot, time, SHA-256, dimensions, content type).
  No catalog mutation, no credentials.
- `infra/cdn-transformer/pilot/disk-guards.mjs` — 2 GiB free gate (start +
  between jobs), per-job 100 MiB staging cap with pre-write accounting,
  cleanup of only the failed job's owned staging.
- `infra/cdn-transformer/pilot/encode-worker.mjs` — killable subprocess entry
  (single op per invocation: `metadata` | `encode` | `verify`); sets Sharp
  `limitInputPixels: 40M`, `limitInputChannels: 5`, `unlimited: false`,
  `failOn: 'warning'`; EXIF-correct; sRGB convert; alpha preserved; never
  upscale/crop/flatten.
- `infra/cdn-transformer/pilot/encoder.mjs` — parent side: serial queue
  (1 job, 1 encoding at a time), absolute 120 s job deadline across
  validation→verify, 15 s/op timeout, SIGTERM→SIGKILL escalation, confirmed
  child exit before slot release; quality descent 70→55; budget check per
  tier; over-budget-at-floor fails the job (no further lowering).
- `infra/cdn-transformer/pilot/manifest.mjs` — manifest schema + atomic
  commit: per-key exclusive claim, own staging dir, independent decode/verify
  of every output, ready manifest inside staging, fsync files + staging dir,
  same-filesystem rename as single visibility commit, parent fsync; reuse only
  after identity + all-output-hash validation; content-hash output names.
- `infra/cdn-transformer/pilot/claims.mjs` — run-token + owner-identity claim
  files; abandoned-claim report (never PID/age-only steal); recovery removes
  only that run's staging after proving owner exit + path revalidation.
- `infra/cdn-transformer/pilot/acceptance.mjs` — visual-acceptance record
  schema + matcher: binds merchant/asset/source/recipe/every output hash;
  any change invalidates; only matching `accepted` records permit lab use.
- `infra/cdn-transformer/pilot/quality-sheet.mjs` — CLI rendering a
  side-by-side original/AVIF/WebP HTML sheet at actual CSS slot sizes and
  DPR 1/2/3 from verified files (inspection aid; not acceptance bypass).
- `infra/cdn-transformer/pilot/generate.mjs` — CLI entry: load inventory
  (≤20 jobs), validate, serial generate, write per-job generation report
  (Node/pnpm/Sharp/libvips/codec versions, options, elapsed, sampled parent RSS,
  disk bytes).
- `infra/cdn-transformer/pilot/cli-args.mjs` — shared `--key value` CLI
  parser with required-key enforcement (used by acquire/generate/sheet).
- `infra/cdn-transformer/pilot/worker-pool.mjs` — serial spawn/timeout/
  kill-escalation/confirmed-exit pool extracted from the encoder.
- `infra/cdn-transformer/pilot/fixtures/contract-fixtures.json` — shared
  valid/invalid manifest + acceptance fixtures consumed by both the
  standalone generator tests and the web schema tests.
- `infra/cdn-transformer/pnpm-workspace.yaml` — nested `packages: ['.']`
  with mirrored safeguards (release-age + trust + strictDepBuilds +
  reviewed `allowBuilds: { sharp: true }` + security overrides for the actual
  standalone graph incl. `sharp: 0.35.4`). Root membership unchanged.
- `infra/cdn-transformer/pnpm-lock.yaml` — via
  `pnpm --dir infra/cdn-transformer install --lockfile-only`, then
  `--frozen-lockfile`. Never `--ignore-workspace`.
- `infra/cdn-transformer/package.json` — extend `check` to cover new pilot
  modules (node --check + node --test for pilot dir).
- `infra/cdn-transformer/.pilot-input/`, `.pilot-output/` — gitignored local
  roots (snapshots, staging, generations). JSON inventory/manifests/
  acceptance records copied to the review packet; bytes stay local.

Web (lab-only, server-only unless noted):

- `apps/web/src/schemas/merchant-image-variant-pilot.ts` (+ `.test.ts`) —
  Zod mirror of manifest/acceptance/binding contracts; strict (no unknown
  fields, bounded arrays); validated against shared contract fixtures.
  No native imports.
- `apps/web/src/lib/merchant-image-variant-pilot/pilot-inventory.ts` —
  private server-only binding table (merchant UUID, stable slot/product-image
  identity, exact original URL → assetId + captured source hash). Max 20.
  Asset IDs assigned once here when no stable identity exists (not
  production media-table IDs).
- `apps/web/src/lib/merchant-image-variant-pilot/lab-index.ts` —
  server-only preflight + frozen immutable index: validates every ready
  manifest + matching acceptance + output hashes, then exposes I/O-free
  `lookup({merchant, assetId, sourceHash, role, width, format})`.
  Rejects foreign/incomplete/stale/policy-mismatched; missing entries → null
  (control path, reported not-optimized). Any input/index change →
  revalidate + new frozen comparison.
- `apps/web/src/lib/merchant-image-variant-pilot/resolver.ts` — thin
  request-time wrapper: after existing guards, in-memory lookup only.
- `apps/web/src/lib/merchant-image-variant-pilot/responsive-projection.ts` —
  one shared srcset/sizes builder from approved tiers (width descriptors =
  actual encoded widths; preserves slot `sizes`, alt, loading/priority).
- `apps/web/src/lib/merchant-image-variant-pilot/next-image-adapter.ts` —
  adapter for `next/image` slots (logo/product) resolving approved variants.
- `apps/web/src/lib/merchant-image-variant-pilot/css-hero-adapter.ts` —
  breakpoint-scoped `image-set()` background adapter preserving box, cover/
  position, overlay, animation.
- `apps/web/src/lib/merchant-image-variant-pilot/ogabassey-mobile-adapter.ts` —
  one shared mobile projection for rendered `<picture>` + every hint owner;
  AVIF-only typed preload + WebP fallback discovery; transparent `<img>`
  behavior preserved; desktop/PDP untouched.
- `apps/web/src/lib/merchant-image-variant-pilot/lab-config.ts` — cloned lab
  configuration binding selected slots by merchant/asset/source identity,
  gated by explicit lab flag; never touches `published_config`, never global
  URL rewrite. Each with colocated Vitest suite.

Measurement / evidence (tooling, not runtime):

- `apps/web/tools/perf/merchant-image-pilot-preflight.mjs` — served-HTML/HAR
  preflight proving all hint owners agree with frozen slide-0 in both arms
  (OgaBassey gate). Stale committed constant → comparison BLOCKED pending
  upstream correction/refreeze.
- Pilot lab input snapshots + quality sheets + acceptance records + raw
  browser samples under a local evidence dir (absolute paths in packet;
  videos/HAR/traces outside git).

Explicitly NOT owned: `proxy.ts`, `business-types.ts`, `.env*`, guards,
Suspense ownership, critical-shell order, global image config, homepage
loading architecture, native clients, migrations, VPS units.

## 3. Mounted-consumer coverage table (discovered on baseline)

| # | Store | Slot | Renderer (baseline file) | Mechanism | Pilot adapter | Status |
|---|-------|------|--------------------------|-----------|---------------|--------|
| 1 | Omnimart | header logo | `HeaderLogo` (`storefront/blocks/header-logo.tsx`, 40x40 `next/image`, object-cover) | shared loader `w`/`q` | `next-image-adapter` | cover |
| 2 | Omnimart | hero banner | `heroComponent.render` (`builder/hero-component.tsx`, CSS `backgroundImage`, cover/center) | CSS background (bypasses loader) | `css-hero-adapter` (`image-set()`) | cover |
| 3 | Omnimart | product card | `StorefrontProductCard` → `ProductCardImage` (`optimized-image.tsx`) | `next/image` + blur + error fallback | `next-image-adapter` | cover |
| 4 | SquishyLand | header logo | `HeaderLogo` (same shared file) | shared loader | `next-image-adapter` | cover |
| 5 | SquishyLand | hero banner | `heroComponent.render` (same shared file) | CSS background | `css-hero-adapter` | cover |
| 6 | SquishyLand | product card | `StorefrontProductCard` (same shared file) | `next/image` wrapper | `next-image-adapter` | cover |
| 7 | Zorvexa | product card (Yodha) | `StorefrontProductCard` (same shared file) | `next/image` wrapper | `next-image-adapter` | cover |
| 8 | Zorvexa | header logo | `HeaderLogo` (same shared file) | shared loader | `next-image-adapter` | cover if sampled |
| 9 | OgaBassey | mobile hero `<picture>` | `MobileLcpHeroImage` (AVIF `<source>` + fallback `<source>` + transparent `<img>`) | separate loader + explicit format sources | `ogabassey-mobile-adapter` | cover |
| 10 | OgaBassey | committed preload slot | `OgabasseyHomeCommittedLcp` → `OgabasseyHomeHeroPreloadLink` | scanner-visible `<link>` | same shared projection | cover |
| 11 | OgaBassey | react-dom flight hint | `preloadOgabasseyHomeHeroResources` (`preload()`) | flight `:HL` row | same shared projection | cover |
| 12 | OgaBassey | static-home cached slide-0 hint | `OgabasseyStaticHomePageContent` conditional emit | `<link>` + `preload()` | same shared projection | cover |
| — | OgaBassey | desktop hero path | desktop grid streams own images | unchanged | none (control) | control |
| — | all | PDP zoom, native callers, signed URLs, unselected cards | various | unchanged | none | control |

Key findings baked into the design: `sizes` for the OgaBassey mobile hero is
`40vw` (`hero-mobile-image-config.ts`), not 100vw; the committed hero constant
is a stale Dell URL until the live slide-0 is frozen (§6 gate); the builder
Hero bypasses the shared loader entirely.

## 4. Regression matrix → test map

Design §"Automated correctness" rows, each with an owning suite:

- Tenant/path isolation, identical bytes under different asset IDs, missing /
  mismatched source hashes → `input-store`, `job-schema`, `manifest` tests.
- Missing/foreign/changed slot bindings, malformed manifests, duplicate keys,
  content-type mismatch → web schema + `lab-index` tests.
- Corrupt input, source mutation, animation/pixel/channel/byte limits →
  `encode-worker`, `encoder`, `input-store` tests (real fixtures).
- Color conversion, aspect ratio, alpha, no upscaling → `encoder` tests.
- Budget pass/fail at floor → `encoder` tests (incl. override-budget floor case).
- Timeout during metadata/encode/verify, absolute deadlines, cancel →
  `encoder` tests (timeout=1ms, past deadline, aborted signal).
- Staging caps, free-space floor, owned cleanup → `disk-guards` tests.
- Hard-kill/abandoned-claim recovery, PID reuse → `claims` tests.
- Idempotent reuse, atomic activation, crash/sync-error points → `manifest`
  tests (incl. injected fsync/rename failures).
- Stale version / visual-acceptance rejection, bad-output preflight rejection,
  I/O-free lookup → `acceptance`, web `lab-index` tests.
- Actual width descriptors, DPR/tier coverage, CSS-background selection,
  preload-owner equality → web adapter + `responsive-projection` tests.
- Selected response bytes/dimensions (not URL shape) →
  `responsive-projection` + adapter tests assert bytes/dims from fixtures.

---

*Continued in [tasks](./2026-10-01-merchant-image-variant-pilot-tasks.md) (§5) and [operations](./2026-10-01-merchant-image-variant-pilot-operations.md) (§6–§7).*
