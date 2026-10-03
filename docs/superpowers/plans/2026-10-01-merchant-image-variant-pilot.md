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

## 5. Tasks

### Task 1: Standalone dependency workspace + lock — DONE

- [x] `infra/cdn-transformer/pnpm-workspace.yaml` (`packages: ['.']`,
  release-age 1440, trust no-downgrade + lockfile, strict builds, sharp-only
  allowlist, sharp 0.35.4 override). Root membership untouched.
- [x] `pnpm-lock.yaml` via `--lockfile-only`, then `--frozen-lockfile`
  install (corepack pnpm 11.7.0). Locked: sharp 0.35.4, zod 3.25.76.
- [x] Verified nested scope (`list` shows only baci-cdn-transformer) and
  effective policy (1440 / no-downgrade / strict true).
- [x] Existing `check` green (30 node + 12 python tests).

### Task 2: Job contract + input store + acquisition — DONE

- [x] `pilot/constants.mjs`: versions, limits, ladders, decimal budgets,
  quality ladder, recipe identity (`RECIPE_ID`).
- [x] `pilot/job-schema.mjs`: strict Zod job contract + inventory validation
  (≤20, duplicate/conflicting keys).
- [x] `pilot/input-store.mjs`: root confinement, symlink-escape rejection,
  oversize rejection, hash verify / mutation detection, safe snapshot names.
- [x] `pilot/acquire.mjs`: bounded http(s) GET (size cap, timeout, no
  redirect), content-type allowlist, idempotent snapshot write, inventory
  append with validation, CLI. Default dimension probe wires to `encoder.mjs`.
- [x] `pilot/fixtures/`: 13 deterministic fixtures + `manifest.json` +
  hash/property guard test (text, photo, alpha, EXIF-6, CMYK, animated
  WebP/GIF with pages=2, truncated, garbage, SVG, tiny, wide, still AVIF).

### Task 3: Encoder + resource limits — DONE

- [x] `pilot/disk-guards.mjs`: statfs floor, staging budget, owned-staging
  removal, safe staging paths.
- [x] `pilot/encode-worker.mjs`: single-op killable child (metadata/encode/
  verify), hardened Sharp flags, EXIF/sRGB/alpha handling, heif→avif
  normalization (observed Sharp behavior), mutation guard, stdout-JSON
  protocol with exit-code discipline.
- [x] `pilot/encoder.mjs`: serial queue, spawn/kill/escalate/confirmed-exit,
  op timeout + absolute deadline + cancel, quality descent 70→55,
  budget-floor failure, tier dedupe without upscaling, independent verify.

### Task 4: Claims + manifest + acceptance + generate + quality sheet — DONE

- [x] `pilot/claims.mjs`: run-token claim files; live-owner proof via
  signaling only (ESRCH-proven exit; kill-success refuses — no PID/age-only
  steal); recovery removes only the dead run's staging after path
  revalidation.
- [x] `pilot/manifest.mjs`: strict manifest schema; content-hash output
  names; atomic generation commit (fsync files + staging dir, same-fs
  rename, parent fsync); validated reuse; crash/sync-error injection points.
- [x] `pilot/acceptance.mjs`: record schema + matcher binding
  merchant/asset/source/recipe/every-output-hash.
- [x] `pilot/generate.mjs`: CLI orchestrating validate → disk gate → claim →
  snapshot → ladder → commit → report (versions, elapsed, sampled parent RSS, bytes).
- [x] `pilot/quality-sheet.mjs`: CLI rendering side-by-side sheets at slot
  sizes from verified files (inspection aid, not acceptance).
- [x] `pilot/fixtures/contract-fixtures.json`: shared valid/invalid
  manifest + acceptance fixtures for generator and web suites.
- [x] Support splits for the 300-line aim: `pilot/cli-args.mjs`,
  `pilot/worker-pool.mjs` (encoder re-exports the pool surface).
- [x] Full pilot suite: 82/82 green.

### Task 5: Web contract + lab-only adapters — DONE

- [x] `apps/web/src/schemas/merchant-image-variant-pilot.ts` (+ test):
  strict Zod v4 mirror validated against shared contract fixtures
  (pinned identity, all invalid/matcher cases, binding schema).
- [x] `merchant-image-variant-pilot/pilot-inventory.ts`,
  `lab-index.ts` (preflight + frozen I/O-free lookup), `resolver.ts`.
- [x] `responsive-projection.ts`, `next-image-adapter.ts`,
  `css-hero-adapter.ts`, `ogabassey-mobile-adapter.ts`, `lab-config.ts`
  (flag-gated; stages derivatives + originals same-origin for lab runs).
- [x] Colocated Vitest suites per file: 8 files / 29 tests green, plus
  8 schema tests. Pilot + control projections share shapes for the
  no-op-control comparison; lab-harness mounting is lab-mount.tsx + the pilot-lab route + tools/perf/merchant-image-pilot-preflight.mjs.

### Task 6: Real-asset snapshots + quality sheets + acceptance records — DONE

- [x] Acquired 6 frozen inputs (public GET only; bytes gitignored, hashes in
  packet). Omnimart logo SHA and Zorvexa Yodha bytes/dims match the
  investigation exactly (sources not rotated):
  - Omnimart logo 692,445 B 1125x750 PNG `d9ffc58d…` (header-logo, logo)
  - Omnimart earbuds 2,123,511 B 1122x1122 PNG `1a13cbba…` (product-card)
  - Squishy blue soap 307,058 B 928x930 JPEG `bc34e268…` (product-card)
  - Zorvexa logo 1,640,182 B 1254x1254 PNG `b3e772fc…` (header-logo, logo)
  - Zorvexa Yodha 1,827,400 B 1254x1254 PNG `28f54169…` (product-card)
  - OgaBassey slide-0 10,186 B 800x800 AVIF `29930849…` (mobile hero, hero)
- [x] Generated 6/6 within budgets (q70 except squishy 384-avif q55 and
  768-avif q60 — descent exercised on real data); no-upscale dedupe on
  1280 tiers; all synced; sampled parent RSS ≤88 MB (checkpoint samples, worker children excluded — not a peak, not a VPS claim).
- [x] Slot geometry recorded: header-logo 40px; product-card 380px mobile
  actual (sizes declares 50vw — pre-existing mismatch, disclosed, not
  changed); mobile-hero 152px (40vw@412). DPR adequacy + source limits
  (squishy 928px, earbuds 1122px) disclosed in packet.
- [x] Quality sheet `/tmp/pilot-sheet.html` (28 MB, verified bytes only);
  per-tier visual inspection passed (branding/text/edges/gradients/color;
  no alpha in sampled sources — alpha path covered by fixture tests).
- [x] Bound 6 acceptance records (`.pilot-output/acceptances.json`),
  matcher-validated. Reviewer re-inspects via packet before any LAB use
  beyond this pilot's evidence.
- [x] Out-of-coverage (reported, not counted): SquishyLand logo (null on
  site); Puck hero backgrounds (client-rendered config, not SSR-bound).
- [x] OgaBassey: live slide-0 is samsung-galaxy-s26-fe-new.avif (rendered
  `<picture>` + matching preload verified in served HTML). The committed
  Dell constant is STALE in production (second preload emitted) → the
  OgaBassey CWV comparison is BLOCKED per the design preflight gate
  pending upstream correction/refreeze.

### Task 7: Extend standalone check + full validation

- [x] Extend `infra/cdn-transformer/package.json` `check` for pilot modules.
- [x] `pnpm --dir infra/cdn-transformer run check`: 114 node + 12 python
  green (one transient 108/114 batch under host contention; 5+ clean
  repeats since, incl. high-concurrency).
- [x] `pnpm turbo typecheck`: 6/6 green.
- [x] Pilot web suites: 39/39 green; pilot files biome-clean and tsc-clean.
- [ ] `pnpm turbo lint`: pilot files clean; 7 remaining diagnostics are
  pre-existing in untouched files (order-success hook, jumia callback,
  ogabassey checkout fixtures, autocomplete) — reported, not fixed.
- [x] `pnpm turbo test`: 5/6 packages green; @baci/web 6427 passed,
  1 skipped, 1 failed — the single failure is
  `tools/cost/cloudflare-evidence-process-isolation.test.ts`, which
  asserts the worktree has no uncommitted changes outside an allowlist.
  It fails for ANY in-flight work (the tree was already dirty at session
  start) and passes once committed; all 9 pilot files pass in the run.
  Not a regression; left uncommitted for review per repo policy.
- [x] `coderabbit review --agent -t uncommitted`: 6 findings, all verified
  and fixed (fail-open min-free-bytes; sheet lookup blocking on unrelated
  corrupt dirs; datetime offset mirror gap + offset fixtures; lab-config
  snapshot confinement/hash verification; baseUrl/staging alignment;
  index-key helper reuse). Matcher set-semantics fix for deduped tiers
  also applied both sides with tests.

### Task 8: Controlled browser evidence — BLOCKED (4 independent gates)

- [x] Fresh PSI live baseline captured (existing env key, redacted
  artifacts): `/Users/mac/.codex/cwv-lab-builds/20261001-pilot-baseline/`
  (8 runs: 4 stores × mobile/desktop; Zorvexa mobile LCP 44.8 s outlier;
  OgaBassey mobile perf 78 / LCP 5.1 s; no field data for generic stores).
- [ ] Local Lighthouse/Sitespeed/Browsertime: BLOCKED —
  (1) disk start margin 10 GiB never held (9.3 → 1.2 GiB during session
  from non-pilot host activity; ENOSPC event observed);
  (2) quiet gate never held (load 22–84 across dozens of sibling agents);
  (3) Docker daemon down (Sitespeed/Browsertime unavailable).
- [ ] OgaBassey served-HTML/HAR preflight: BLOCKED — (4) the committed Dell
  constant is stale in production (served HTML emits BOTH the Dell and the
  live s26 AVIF-typed preloads); per the design gate, the comparison stays
  blocked until an upstream correction is incorporated and re-frozen.
  Evidence: `/tmp/pilot-pages/ogabassey.html` (fetched 2026-10-01 ~22:00 UTC).
- [x] Per design, returning code/correctness evidence with performance
  explicitly incomplete; no CWV numbers are claimed. Static byte deltas
  (control original → candidate tier) are reported as arithmetic, not
  measured LCP.

## 6. Commands

```text
# Pilot package (standalone; corepack pnpm 11.7.0, never bare pnpm 10.x)
corepack pnpm --dir infra/cdn-transformer install --frozen-lockfile
corepack pnpm --dir infra/cdn-transformer run check
node --test pilot/*.test.mjs pilot/fixtures/*.test.mjs   # from infra/cdn-transformer

# Acquisition (one asset per invocation; inventory validated on append)
node pilot/acquire.mjs --url <https-url> --merchant <uuid> --asset <id> \
  --role <logo|product|hero> --slot <slot-id> \
  --input-root .pilot-input --inventory .pilot-input/inventory.json

# Generation (serial; absolute 120 s/job deadline; 2 GiB + 100 MiB guards)
node pilot/generate.mjs --inventory .pilot-input/inventory.json \
  --input-root .pilot-input --output-root .pilot-output

# Quality sheet (verified files only; inspection aid, not acceptance)
node pilot/quality-sheet.mjs --output-root .pilot-output \
  --acceptance .pilot-output/acceptance.json --out /tmp/pilot-sheet.html

# Lab serving (from apps/web; stage BEFORE starting Next — files added to
# public/ after start are not served, verified 2026-10-03 on next start)
BACI_IMAGE_PILOT_LAB=1 corepack pnpm pilot:stage \
  --input-root <dir> --output-root <dir> --public-dir <public>
corepack pnpm exec next start -p 3122   # only after staging succeeds
# Card image URLs are absolute (the original renderer rejects relative
# ones) but Host headers are untrusted: only loopback Hosts are reflected.
# For a shared/staged lab origin, set BACI_IMAGE_PILOT_ORIGIN=https://… —
# otherwise card URLs fall back to http://localhost:3000.

# Final validation (Task 7)
pnpm turbo lint
pnpm turbo typecheck
pnpm turbo test
pnpm --dir infra/cdn-transformer run check
coderabbit review --agent -t uncommitted
```

## 7. Risks, deviations, and decision log

- Sharp reports AVIF bytes as `heif` (verified 2026-10-01, Sharp 0.35.4):
  worker normalizes `heif`→`avif` on input accept and output verify paths.
  No design change; decoder-label mapping only, covered by fixture tests.
- Disk at plan time (9.3 GiB) is below the 10 GiB browser-batch start
  margin: Task 8 cannot start until the gate passes. Code/correctness work
  is unaffected.
- Bare `pnpm` on PATH is 10.28.1; the repo pins 11.7.0. All pilot pnpm
  commands use `corepack pnpm`.
- No material design deviations. Two decoder/contract refinements, both
  covered by tests: (1) Sharp labels AVIF bytes `heif` — normalized on
  input accept and output verify; (2) acceptance matcher uses set
  semantics so no-upscale-deduplicated tiers validate.
- S26 hero upper tiers (768/800) re-encode larger than the already-tiny
  10 KB AVIF source at q70. Reported as a finding; no policy change
  (design fixes quality/budgets, and both tiers still pass budgets).
- Product-card `sizes` (50vw mobile) disagrees with the actual 1-col
  mobile box (~380px). Pre-existing; disclosed, not changed.
- Never-larger guard is conditional per rung/format: when a rung exceeds
  source bytes but the source codec is incompatible with the rung branch,
  delivery keeps `generated-over-source` (e.g. OgaBassey WebP fallback
  larger than its AVIF original). Disclosed; merchant-wide protection is
  a production follow-up, not a pilot change.
- (Log further deviations here as they occur; material design deviations
  return to the owner/reviewer instead of being assumed approved.)
