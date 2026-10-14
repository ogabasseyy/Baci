# Merchant image variant pilot — operations (§6–§7)

*Part of the [implementation plan](./2026-10-01-merchant-image-variant-pilot.md) (§0–§4); [tasks](./2026-10-01-merchant-image-variant-pilot-tasks.md) (§5) is the second part.*

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

# Quality sheet (verified files only; inspection aid, not acceptance).
# --slots is operator JSON mapping slot ids to {cssWidth}; all five flags
# are required.
node pilot/quality-sheet.mjs --input-root .pilot-input \
  --inventory .pilot-input/inventory.json --output-root .pilot-output \
  --slots slots.json --out /tmp/pilot-sheet.html

# Lab serving (from apps/web; stage BEFORE starting Next — files added to
# public/ after start are not served, verified 2026-10-03 on next start).
# Export the lab env for BOTH commands: the stage CLI keeps flag-derived
# roots in its own process, so next start needs them exported too —
# otherwise the startup gate aborts on the staged non-lab assets.
export BACI_IMAGE_PILOT_LAB=1
# next start defaults to NODE_ENV=production, where the lab flag stays
# off without this acknowledgement — and the startup gate then aborts
# on the staged merchant tree as non-lab assets. Required for the
# sequence below, not just for shared origins.
export BACI_IMAGE_PILOT_ALLOW_PROD=1
export BACI_IMAGE_PILOT_INPUT_ROOT=<dir>
export BACI_IMAGE_PILOT_OUTPUT_ROOT=<dir>
export BACI_IMAGE_PILOT_PUBLIC_DIR=<public>
corepack pnpm pilot:stage
corepack pnpm exec next start -p 3122   # only after staging succeeds
# Card image URLs are absolute (the original renderer rejects relative
# ones) but Host headers are untrusted: only loopback Hosts are reflected.
# For a shared/staged lab origin, set BACI_IMAGE_PILOT_ORIGIN=https://… —
# otherwise card URLs fall back to http://localhost:3000.
#
# Exposure model (read before enabling the lab anywhere but localhost):
# staged merchant bytes serve as ordinary static files under
# public/__pilot — originals at predictable
# /__pilot/originals/<merchantId>-<assetId>.<ext> names — bypassing
# every lab route gate, with no authentication. Merchant IDs/slugs and
# asset IDs are NOT secrets: anyone who guesses or learns them fetches
# full-resolution originals, not just the operator — including
# originals for UNACCEPTED bindings, which stage alongside accepted
# ones by design (out-of-coverage slots render the real control, not a
# not-optimized row). Acceptance gates derivative activation only.
# Any Vercel deployment
# (production, preview, AND development) refuses the lab flag outright;
# standalone/VPS production additionally requires
# BACI_IMAGE_PILOT_ALLOW_PROD=1 as explicit acknowledgement. A shared
# lab origin is operator opt-in only: never enable the lab on a
# reachable box you would not publish the merchant catalog from.
# ALLOW_PROD pre-flight (all must hold before exporting it): the box is
# measurement-only, not the live storefront; the box is network-isolated
# (loopback-only or firewalled to the operator — staged bytes are plain
# static files, and direct asset fetches never re-check); the lab env
# (flag, roots, staged tree) lives only on that box and is never copied
# to a shared deployment; every boot prints LAB ENABLED IN PRODUCTION —
# if you see it somewhere unexpected, unset the flag there. When
# measurement ends, unset BACI_IMAGE_PILOT_LAB and delete the staged
# tree (recovery line below) so no later boot can serve it.
# Residual window (accepted): files planted under public/__pilot AFTER
# boot are statically servable until the next lab page render re-runs
# the binding check — and after a degraded boot (failed lab init),
# every render attempt still re-checks against the empty binding set
# and refuses loudly. BUT direct static-asset requests (GET
# /__pilot/...) never invoke a lab handler, so a plant fetched only
# that way is served with NO re-check until restart: page renders
# fail loud, raw asset fetches do not. Two hard rules follow. (1)
# Network isolation is a HARD prerequisite, not advice: the lab (and
# especially ALLOW_PROD) runs on a loopback-only or operator-
# firewalled host — never on a box where an untrusted party can fetch
# URLs. (2) A failed lab init is FATAL when ALLOW_PROD is set (the
# original init error propagates and boot refuses): with production
# exposure acknowledged, continuing runtime-less is never acceptable.
# Without ALLOW_PROD the degraded boot stays fail-loud (lab routes
# fail closed) on the isolated dev box. Never live-edit the staged
# tree; unexpected content means re-stage and restart.
#
# Recovery when a non-lab build/boot reports a staged tree. BUILD is
# the enforcement point and refuses: staged-merchant shapes (image
# files under originals/, generation dirs, fillers/, or the __pilot
# root), confinement breaks (symlinks, hardlinked or special files —
# Next would serve or block on them), pinned-filler drift (a merchant
# image renamed to a filler name must never ship silently), and a
# BACI_PILOT_PUBLIC_DIR preset that disagrees with the served config
# tree (the boot gate trusts the stash — unset or correct the
# preset). Empty leftover dirs pass silently and unrelated strays
# (.DS_Store, renamed leftovers) warn. RUNTIME boots split by
# finding: filler drift still refuses (a same-tree build already
# passed these bytes, so drift means post-build tamper — restore
# public/__pilot/fillers from version control or re-pin the
# fixture), while staged-content and confinement findings move the
# offending entry to __pilot-quarantine/ beside public/ (timestamped,
# same filesystem — symlinked entries move as links, un-traversed)
# and continue with the tree clean, so a leftover stage neither
# bricks the production boot nor stays served. To restore a
# quarantined entry after investigating: move it back under
# public/__pilot/ (lab on) or re-run pilot:stage; remove the vault
# when done. Three runtime cases stay fatal: a failed quarantine
# (read-only tree — serving unverified bytes is not an option), an
# unverifiable tree (symlinked or unreadable __pilot root), and an
# unchecked boot under pilot intent ('refusing an unchecked boot':
# no checkable app tree at all while pilot env was configured).
# Unanchored candidate trees warn WITHOUT quarantine (a foreign tree
# may belong to a live lab session — this process must not mutate
# it); boots with zero pilot configuration (serverless functions,
# migrations) warn instead of refusing. BACI_PILOT_PUBLIC_DIR names
# the served tree for the boot gate when the config anchor is
# unavailable (standalone/VPS, custom servers). To clear a dirty
# tree: re-run pilot:stage with the intended inventory (reconcile
# removes unreferenced generations), or delete
# public/__pilot/{originals,<64-hex-dirs>} outright on a box that
# should never have staged. The build refusal is intentional
# fail-closed (staging is gitignored operator state, yet a leftover
# stage must never silently ship merchant bytes): confirmed by
# pilot-next-gate.test.ts 'refuses staged data in non-lab mode like
# the inline gate', which runs the real build-gate path against a
# staged fixture with the lab off.

# Final validation (Task 7)
pnpm turbo lint
pnpm turbo typecheck
pnpm turbo test
pnpm --dir infra/cdn-transformer run check
coderabbit review --agent -t uncommitted
```

## 7. Risks, deviations, and decision log

- Sharp reports AVIF bytes as `heif` (verified 2026-10-01, Sharp 0.35.5):
  worker normalizes `heif`→`avif` on input accept and output verify paths.
  No design change; decoder-label mapping only, covered by fixture tests.
- Disk at plan time (9.3 GiB) is below the 10 GiB browser-batch start
  margin: Task 8 cannot start until the gate passes. Code/correctness work
  is unaffected.
- Bare `pnpm` on PATH is 10.28.1; the repo pins 11.7.0. All pilot pnpm
  commands use `corepack pnpm`.
- No material design deviations. Two decoder/contract refinements, both
  covered by tests: (1) Sharp labels AVIF bytes `heif` — normalized on
  input accept and output verify; (2) acceptance matchers bind rungs
  positionally — each rung's hash and quality compare at its own index,
  so swapped rungs reject. Identical files may still share one stored
  copy on disk; that dedup is storage-only, not acceptance semantics.
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
- First-navigation binding is graded, not binary: Browsertime HARs bind
  only with their verbose navigation record (that driver always logs
  navigations); other drivers' markerless segments bind with
  `firstNavigationUnverified: true` in the launch record (the Caps
  contract preserved, never silently cold). Covered by tests.
- (Log further deviations here as they occur; material design deviations
  return to the owner/reviewer instead of being assumed approved.)

---

*Back to the [implementation plan](./2026-10-01-merchant-image-variant-pilot.md).* 
