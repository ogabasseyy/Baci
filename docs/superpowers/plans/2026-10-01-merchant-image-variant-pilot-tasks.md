# Merchant image variant pilot — tasks (§5)

*Part of the [implementation plan](./2026-10-01-merchant-image-variant-pilot.md) (§0–§4); [operations](./2026-10-01-merchant-image-variant-pilot-operations.md) (§6–§7) is the third part.*

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

---

*Back to the [implementation plan](./2026-10-01-merchant-image-variant-pilot.md).* 
