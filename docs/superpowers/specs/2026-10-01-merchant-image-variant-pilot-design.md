# Merchant image variant pilot

Date: 2026-10-01
Status: design for user review; runtime implementation has not started.
Branch: `codex/merchant-image-pilot`, isolated from the dirty primary checkout.
Source baseline: `635a1655aa` (`origin/main` when the worktree was created).

## Intent and boundaries

Merchants should not have to optimize their own uploads to get appropriately sized storefront images. Preserve original artwork, generate bounded delivery variants before activation, and measure the effect on mobile and desktop. OgaBassey should be eligible for the same policy without breaking its existing specialized delivery path.

This design covers the first implementation: an offline, tenant-scoped generator, a versioned manifest, lab-only consumption through the existing web image-delivery seam, and a representative acceptance report. It does not switch live uploads, publish customer assets, enable a production worker, migrate native clients, disable Supabase transformations, buy infrastructure, change VPS limits, or deploy. Those are later migration steps, not implied by a passing pilot.

There is no promise that every hero becomes 1.6KB, or that image optimization alone guarantees LCP below 2.5s. Success means verified derivatives, bounded generation, preserved rendering and a measured outcome. The separate generic-storefront loading/CLS problem remains separate.

## Evidence and current implementation

The read-only investigation lives outside the repository at `/Users/mac/.codex/cwv-lab-builds/20261001-merchant-sample/IMAGE-PIPELINE-INVESTIGATION.md`. Its October 1 measurements are observations, not reproducible test fixtures until input bytes are captured and hashed:

- Omnimart logo: original/current `w`/`q` object URL delivered 692,445 bytes at 1125x750; a real 96px, aspect-preserving transform delivered 1,580 bytes at 96x64.
- Zorvexa product: original delivered 1,827,400 bytes at 1254x1254; genuine transformation delivered 12,894 bytes at 384x384 and 30,192 bytes at 750x750.
- These byte checks did not establish visual acceptance or LCP improvement.

Existing seams verified on the baseline:

- [Web loader](../../../apps/web/src/lib/image-loader.ts): ordinary external URLs receive `w`/`q`; Supabase object downloads do not implement those transformations.
- [Media CDN mapping](../../../apps/web/src/lib/storefront-media-cdn-url.ts): storage proxy mapping, not an encoder.
- [Upload route](../../../apps/web/src/app/api/media/route.ts): merchant-authorized original upload; 10MiB file limit.
- [Featured-image generator](../../../apps/web/src/lib/blog-featured-image-variants.ts): existing Sharp generation pattern, not a general media contract.
- [Transformer](../../../infra/cdn-transformer/transform-cache.mjs): local-file encoders, bounded queue and cache. The standalone package on this baseline pins Sharp 0.35.4; use the actual lockfile, not the older primary checkout's version.
- [Native URL hook](../../../apps/mobile-admin/hooks/useCachedImageUri.ts): existing dependency on Supabase's transform endpoint. Disabling it now is unsafe.

Read-only VPS snapshots found four CPUs, approximately 16GB RAM and 22GB free disk (89% used). The live transformer approaches a 512MiB service memory limit with swap/reclaim pressure but no recorded OOM kill. These snapshots require capacity follow-up; they do not prove a leak or justify a hardware purchase. The pilot runs locally and does not add production load.

## Approaches considered

1. **Selected: pre-generated variants using existing Sharp tooling.** No first-shopper encoding; explicit byte budgets and versioned output; storage/delivery costs remain. Requires an upload/publishing integration after this pilot proves the contract.
2. **Managed Supabase transforms.** Smallest immediate loader correction and an optional future compatibility bridge, but entails managed transformation usage and does not itself enforce a publishing budget. Leave enabled for current consumers; do not quietly activate it across every storefront.
3. **Expand the VPS's on-demand endpoint to all merchant URLs.** Rejected for this pilot: first-request latency, resource contention, arbitrary-URL/tenant risks and cache-miss workload. The new generator is an offline tool, not a new public resizing proxy.

## Pilot data flow

Reviewed public asset snapshot -> validated job -> serial encoder -> verified versioned directory -> ready manifest -> lab-only storefront resolver -> matched browser runs.

Input acquisition is a separate bounded diagnostic step. Capture public images from Omnimart, SquishyLand, Zorvexa and the current OgaBassey hero; record exact URL, merchant identity, slot, time, SHA-256, dimensions and response content type. No catalog mutation or broad backfill. Unit tests use deterministic local fixtures, not live CDN objects. If a source rotates, a hash mismatch invalidates the comparison rather than silently changing content.

### 1. Job contract and authority

The generator consumes local files beneath a configured pilot input root. It accepts no arbitrary remote fetch URL and uses no Supabase credential. A validated job specifies schema version, merchant UUID, asset ID, source-relative path, expected SHA-256, and role (`logo`, `product`, `hero`). The reviewed input inventory binds the local snapshot to its tenant; a body-selected merchant ID alone is not ownership proof.

Reject absolute paths, traversal, encoded separators, NUL/control characters, symlinks escaping the root, malformed IDs, hash mismatch, unknown roles, duplicate conflicting jobs and source mutation during processing. Output directories cannot escape their configured root. Idempotency identity includes merchant, source hash, role, policy version and encoder version; tenant identity participates in both output paths and manifest lookup.

The eventual production producer must authenticate with the normal RLS client, resolve ownership/staff permission, and enqueue only the caller's authorized asset. Production worker credentials, queue claims and Storage policy integration are a separate reviewed security contract; this pilot provides no service-role exception and does not deploy such a producer.

### 2. Encoder and resource limits

Keep this offline responsibility in focused modules under `infra/cdn-transformer/`; do not alter the existing request-serving transform behavior. Use the existing package's Sharp dependency and extract genuinely shared encoder primitives only if behavior remains unchanged and tests cover both consumers.

- JPEG, PNG, static WebP and static AVIF input; maximum 10MiB encoded input, 40 million decoded pixels and 16,384 pixels on either axis.
- Verify decoded format, dimensions, channel count and frame/page count; reject animated input, SVG and unsupported formats for the raster pilot rather than silently taking a first frame. Existing publication remains untouched.
- Apply EXIF orientation before measuring/resizing; preserve aspect ratio and alpha, never upscale, never auto-crop or flatten a transparent logo.
- Start at quality 70, then 65, 60 and 55 only as required to meet the role/tier budget. Lowest quality is an engineering floor, not visual approval. No automatic blur or lower resolution to manufacture compliance.
- AVIF plus WebP fallback, using explicit format URLs rather than `Accept`-dependent bytes under a cache that may ignore `Vary`.
- Strip unnecessary metadata; record resulting format, dimensions, byte size, SHA-256 and chosen quality.
- One job and one encoding at a time, bounded 20-job input inventory, maximum 15 seconds per encoding and 120 seconds per job.
- Use a killable subprocess for an encoding timeout; do not release a concurrency slot while native encoding continues. Failure leaves the prior ready output intact.
- Require at least 2GiB free before generation; pause rather than delete unrelated files or grow an unbounded scratch tree. Record elapsed time, peak resident memory and generated disk bytes for the capacity report.

### 3. Initial delivery budgets

These are proposed pilot acceptance ceilings in decimal bytes, not a production policy or guaranteed encoding result. Quality and clarity of embedded text still need visual acceptance. The 384px tier is a pixel width, not a universal CSS viewport: `sizes` and DPR must select the correct tier.

| Role and target pixel width | AVIF ceiling | WebP ceiling |
| --- | ---: | ---: |
| Logo 96 | 5,000 B | 5,000 B |
| Logo 192 | 12,000 B | 12,000 B |
| Product 384 | 25,000 B | 40,000 B |
| Product 768 | 75,000 B | 100,000 B |
| Hero 384 | 20,000 B | 35,000 B |
| Hero 768 | 60,000 B | 90,000 B |
| Hero 1280 | 150,000 B | 200,000 B |

Generate the appropriate full ladder for the role. If the original is smaller, use its natural oriented dimensions and deduplicate identical tiers while retaining an explicit selection mapping. A tier over budget at the quality floor fails the job; no ready manifest is activated. A visual rejection also prevents acceptance even when bytes pass. Retain originals for editing and zoom; this pilot does not reduce zoom quality or replace SEO/source originals.

### 4. Atomic manifest and cache identity

Manifest fields include schema/policy/encoder versions, merchant UUID, asset ID, role, source hash and dimensions, and each tier's relative path, explicit content type, dimensions, byte size, quality and output hash. Require all intended tiers to verify before publishing the manifest.

Encode into a staging directory, independently decode/verify each output, then atomically activate an immutable directory and ready manifest on the same filesystem. Interrupted writes, corrupt output and concurrent same-key jobs must never expose a partial manifest. Do not overwrite a source-hash version; rotate by a new identity. No full source URL with signed query/token may enter a public manifest.

The future Storage adapter uploads immutable objects first, verifies availability, then changes the authorized active reference using a source-version compare-and-swap. The pilot exercises that interface using local storage only; no cloud credentials or production write adapter is supplied.

### 5. Lab-only storefront consumption

Add an explicit manifest-aware resolver that takes the trusted merchant and current source hash, requested role/width and format. Do not derive tenant authority from a URL alone, fetch a manifest from an untrusted host, or ship all tenants' mappings to the browser. Reject foreign, incomplete, stale and policy-mismatched manifests.

Use the existing loader as a compatibility seam only after resolving an approved ready variant; a loader cannot perform a network lookup synchronously. The shared original-URL behavior stays unchanged outside the explicit pilot adapter. Private/signed URLs, native callers, PDP zoom, cards not selected for the pilot, and OgaBassey's desktop path remain untouched.

The lab page/component must preserve actual dimensions, aspect ratio, `sizes`, alt text, loading/priority and crop mode. Preload and rendered `srcset` must select the same asset and format ladder; one hero download, no stale CDN duplicate. Guard/publication checks remain upstream and unchanged. Do not move tenant data into a prerendered public shell to get a faster score.

On missing/rejected manifest, the control path remains unchanged and is explicitly reported as not optimized. In the proposed future publishing integration, a new critical image remains pending: retain the previous approved image, or an honestly labelled dimensioned placeholder when none exists. Never silently promote an oversized original as an optimized critical-image fallback. Broken/missing hero samples cannot count as performance wins.

## Validation and success criteria

### Automated correctness

Write tests first and demonstrate failures before implementation. Exercise real decoding/encoding using deterministic fixtures with readable text, photographic detail, alpha and EXIF orientation; mock only cloud/network boundaries.

Cover tenant/path isolation, missing and mismatched source hashes, malformed manifests, duplicate keys, content type mismatch, corrupt input, source mutation, animation/pixel/channel/byte limits, aspect ratio, alpha, no upscaling, budget pass/fail at the floor, interrupted/timeout cleanup, idempotent reuse, atomic activation, stale version rejection, DPR/tier choice and preload equality. Validate selected response bytes and dimensions, not only URL string shape.

Because runtime contracts will be shared across generator and web, use the full monorepo lint/typecheck/test gates plus the standalone transformer's tests, according to the applicable repository instructions. Obtain required current-head CodeRabbit review; unavailable review remains an incomplete gate. No instruction, middleware or environment edit is included in this pilot.

### Image and browser acceptance

1. Produce a side-by-side original/AVIF/WebP quality sheet at CSS sizes and DPR 1/2. Manually inspect branding, small text, edges, gradients and transparency; user visual sign-off precedes any production policy.
2. Before comparing CWV, freeze the exact current source, merchant, role and rendered content. Record source SHA, generated hashes, app/build IDs, effective browser/profile/throttle settings, route/host, cache state and network topology.
3. Use full Chrome, not headless-shell assumptions. Preserve production-equivalent same-site relationships between document/CDN in local tests; label any topology intervention rather than passing it off as image-byte improvement.
4. Run both Lighthouse and Sitespeed/Browsertime with HAR, trace, console and video/filmstrip. Mobile and desktop are separate comparisons. Use two order-reversed pairs first; extend to five per arm only when a promising result needs replication. Quiet-gate local starts (load below 10, CPU idle above 50%, no concurrent build/test workload); contaminated samples are diagnostic only.
5. Inspect LCP element/subparts, FCP, CLS, broken images, download duplication, early/late video frames and scroll-during-load. Reject blanking, unstyled content, changed image identity, unexpected failed requests or hydration errors. Classify known baseline failures separately; no generic API-error allowlist or clean-run claim with unresolved errors.
6. Report raw samples, paired differences, medians and ranges per route/tool/profile, with excluded runs and reasons. Smaller bytes do not prove lower LCP; an improvement is accepted only if repeatable with visual/functional parity and no demonstrated FCP/CLS regression.
7. Live PSI requires a publicly accessible candidate, so this local pilot uses Lighthouse, not a fictitious local PSI score. Capture a fresh live baseline with the existing PSI key without exposing it. Post-deployment PSI and real-user p75 LCP/INP/CLS are later gates, not evidence obtainable before deployment.

No predetermined percentage improvement or sub-2.5s claim. A neutral outcome is a valid pilot result. Do not keep changing quality, content, throttling or delivery host until a desired score appears.

## Follow-on migration, not part of this implementation

After pilot acceptance, design the smallest authenticated enqueue/Storage activation integration using the normal tenant/RLS model. Inventory web, native, imports, builder imagery and existing stored URLs; migrate each writer and reader, then bounded legacy backfill with old-value guards. Do not remove originals or disable Supabase transforms while supported old clients still depend on them.

Before activating a VPS worker, confirm measured encode capacity and queue latency, disk retention and the existing transformer's memory pressure; propose an isolated service/cgroup limit from evidence. No hardware upgrade or live service edit is pre-approved here.

Before production rollout, validate immutable response headers and cache keys, exact active-source/preload alignment through hero rotation, tenant/publication safety and rollback to the previous ready manifest. Supabase transformation usage and storage/egress remain separate cost checks.

Expand beyond the pilot only after a separately reviewed activation plan. A full mobile homepage rebuild is not included or justified by this image-delivery pilot.

## References

- [Sharp safety and input limits](https://sharp.pixelplumbing.com/api-constructor/)
- [Sharp output formats and metadata behavior](https://sharp.pixelplumbing.com/api-output/)
- [Supabase transformation behavior and disable toggle](https://supabase.com/docs/guides/storage/serving/image-transformations)
- [Supabase transformation usage and pre-generation guidance](https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [LCP resource and render-delay separation](https://web.dev/articles/optimize-lcp)

The brainstorming workflow requires user review of this spec, followed by a reviewed implementation plan, before runtime edits. CWV guidance informs the visual, geometry and matched-measurement gates; it does not justify reusing previously rejected CSS/scheduling experiments.
