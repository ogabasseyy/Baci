# Merchant image variant pilot

Date: 2026-10-01
Status: design for user review; runtime implementation has not started.
Branch: `codex/merchant-image-pilot`, isolated from the dirty primary checkout.
Source baseline: `635a1655aa` (`origin/main` when the worktree was created).

## Intent and boundaries

Merchants should not have to optimize their own uploads to get appropriately sized storefront images. Preserve original artwork, generate bounded delivery variants before activation, and measure the effect on mobile and desktop. OgaBassey should be eligible for the same policy without breaking its existing specialized delivery path.

This design covers the first implementation: an offline, tenant-scoped generator, a versioned manifest, explicit lab-only adapters for the mounted image consumers, and a representative acceptance report. It does not switch live uploads, publish customer assets, enable a production worker, migrate native clients, disable Supabase transformations, buy infrastructure, change VPS limits, or deploy. Those are later migration steps, not implied by a passing pilot.

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
- [Transformer](../../../infra/cdn-transformer/transform-cache.mjs): local-file encoders, bounded queue and cache. Its [standalone package](../../../infra/cdn-transformer/package.json) pins Sharp 0.35.4, but has no lockfile and is outside the root pnpm workspace. A reproducible pilot must add its own lockfile; the root lock does not lock this package's dependency graph.
- [Native URL hook](../../../apps/mobile-admin/hooks/useCachedImageUri.ts): existing dependency on Supabase's transform endpoint. Disabling it now is unsafe.
- [Builder Hero](../../../apps/web/src/components/builder/hero-component.tsx): renders a CSS background, so it bypasses the shared loader. The [Puck storefront](../../../apps/web/src/components/storefront/puck-storefront.tsx) loads published configuration client-side; its existing loading behavior is not fixed by smaller image bytes.
- [Mobile OgaBassey image](../../../apps/web/src/components/storefront/ogabassey/components/mobile-lcp-hero-image.tsx): uses a separate loader and `<picture>` sources, with a transparent fallback `<img>`. Its [size declaration](../../../apps/web/src/components/storefront/ogabassey/components/hero-mobile-image-config.ts) is 40vw on mobile, not 100vw. Its mobile resource hints need the same projection as its rendered sources.
- [Committed LCP slot](../../../apps/web/src/app/(storefront)/[slug]/(home)/ogabassey-home-committed-lcp.tsx): on this baseline, emits a configured constant through the scanner-visible preload link. The [static homepage](../../../apps/web/src/app/(storefront)/ogabassey/ogabassey-static-home-page-content.tsx) can also emit hints for cached slide-0. A correct rendered variant alone does not eliminate stale or duplicate hints from these owners.

Read-only VPS snapshots found four CPUs, approximately 16GB RAM and 22GB free disk (89% used). The live transformer approaches a 512MiB service memory limit with swap/reclaim pressure but no recorded OOM kill. The repository's [service unit](../../../infra/cdn-transformer/baci-cdn-transformer.service) instead declares `MemoryMax=1G`: source and effective live configuration differ. Verify the effective unit/drop-ins and installed encoder versions before any future capacity decision; neither value authorizes raising the limit. These snapshots do not prove a leak or justify a hardware purchase. The pilot runs locally and does not add production load.

## Approaches considered

1. **Selected: pre-generated variants using existing Sharp tooling.** No first-shopper encoding; explicit byte budgets and versioned output; storage/delivery costs remain. Requires an upload/publishing integration after this pilot proves the contract.
2. **Managed Supabase transforms.** Smallest immediate loader correction and an optional future compatibility bridge, but entails managed transformation usage and does not itself enforce a publishing budget. Leave enabled for current consumers; do not quietly activate it across every storefront.
3. **Expand the VPS's on-demand endpoint to all merchant URLs.** Rejected for this pilot: first-request latency, resource contention, arbitrary-URL/tenant risks and cache-miss workload. The new generator is an offline tool, not a new public resizing proxy.

## Pilot data flow

Reviewed public asset snapshot -> validated job -> serial encoder -> machine-ready generation -> hash-bound visual acceptance -> verified lab index -> selected mounted slot -> matched browser runs.

Input acquisition is a separate bounded diagnostic step. Capture public images from Omnimart, SquishyLand, Zorvexa and the current OgaBassey hero; record exact URL, merchant identity, slot, time, SHA-256, dimensions and response content type. No catalog mutation or broad backfill. Unit tests use deterministic local fixtures, not live CDN objects. If a source rotates, a hash mismatch invalidates the comparison rather than silently changing content.

### 1. Job contract and authority

The generator consumes local files beneath a configured pilot input root. It accepts no arbitrary remote fetch URL and uses no Supabase credential. A validated job specifies schema version, merchant UUID, asset ID, source-relative path, expected SHA-256, and role (`logo`, `product`, `hero`). The reviewed input inventory binds the local snapshot to its tenant; a body-selected merchant ID alone is not ownership proof.

Reject absolute paths, traversal, encoded separators, NUL/control characters, symlinks escaping the root, malformed IDs, hash mismatch, unknown roles, duplicate conflicting jobs and source mutation during processing. Output directories cannot escape their configured root. Idempotency identity includes merchant, asset ID, source hash, role, the complete versioned tier/quality recipe and encoder identity. Tenant and asset identity participate in output paths and manifest lookup; two assets containing identical source bytes cannot accidentally inherit each other's manifest. Encode the same validated input snapshot that was hashed, rather than reopening a mutable source path without verification.

The eventual production producer must authenticate with the normal RLS client, resolve ownership/staff permission, and enqueue only the caller's authorized asset. Production worker credentials, queue claims and Storage policy integration are a separate reviewed security contract; this pilot provides no service-role exception and does not deploy such a producer.

### 2. Encoder and resource limits

Keep this offline responsibility in focused modules under `infra/cdn-transformer/`; do not alter the existing request-serving transform behavior. Use the existing package's Sharp dependency and extract genuinely shared encoder primitives only if behavior remains unchanged and tests cover both consumers.

Planned additions: a package-local `infra/cdn-transformer/pnpm-workspace.yaml` scoped to this package only (`packages: ['.']`) and its own `pnpm-lock.yaml`. Preserve the applicable safeguards from the [root dependency policy](../../../pnpm-workspace.yaml): release-age minimum, trust policy, strict dependency-build handling, reviewed build allowlist and security overrides/patches for the actual standalone graph. Keep native/workspace-specific unrelated settings out; do not invent broader trust exceptions or allow every dependency's build script. Sharp's native installation needs its explicit reviewed allowance.

Use the root-declared pnpm version and verify the local effective policy before dependency resolution. Generate the local lock with `pnpm --dir infra/cdn-transformer install --lockfile-only`, then install with `pnpm --dir infra/cdn-transformer install --frozen-lockfile`. Do not use `--ignore-workspace`: the installed CLI confirms it drops parent workspace policy, including release-age, trust and strict-build settings. The nested workspace must supply those safeguards itself; verify its scope, effective settings and locked security pins rather than assuming inheritance. A missing safeguard blocks installation, not an automatic exception. Keep root workspace membership and Turbo unchanged. Record Node, pnpm, Sharp, libvips and codec versions plus encoding options in each generation report; never import Sharp/transformer modules into the web bundle.

- JPEG, PNG, static WebP and static AVIF input; maximum 10MiB encoded input, 40 million decoded pixels and 16,384 pixels on either axis.
- Set the decoder's `limitInputPixels` to 40 million, `limitInputChannels` to 5, `unlimited: false` and `failOn: 'warning'` before decoding. Independently verify actual format, dimensions, channels and frame/page count; reject animated input, SVG and unsupported formats rather than silently taking a first frame. Encoded size limits and post-decode checks alone are not resource protection. Existing publication remains untouched.
- Apply EXIF orientation before measuring/resizing; preserve aspect ratio and alpha, never upscale, never auto-crop or flatten a transparent logo.
- Start at quality 70, then 65, 60 and 55 only as required to meet the role/tier budget. Lowest quality is an engineering floor, not visual approval. No automatic blur or lower resolution to manufacture compliance.
- AVIF plus WebP fallback, using explicit format URLs rather than `Accept`-dependent bytes under a cache that may ignore `Vary`.
- Explicitly convert accepted color profiles to sRGB before removing EXIF/GPS and other metadata; preserve alpha. Include CMYK/profiled inputs in color tests and fail on unsupported/corrupt profiles rather than silently changing branding colors. Record resulting format, dimensions, byte size, SHA-256 and chosen quality.
- One job and one encoding at a time, bounded 20-job input inventory, maximum 15 seconds per encoding and 120 seconds per job.
- Enforce the absolute job deadline from validation through final output verification, not a fresh deadline per retry. Every native Sharp operation, including metadata/profile inspection and verification decoding, runs inside a killable subprocess under that remaining deadline and a maximum 15-second operation timeout. An encoding-only timeout leaves malformed-input preflight and output verification unbounded. Terminate on timeout/cancellation, escalate if necessary, and wait for confirmed child exit before releasing the concurrency slot. Failure leaves the prior ready output intact.
- Require at least 2GiB free before generation and recheck between jobs; cap a job's staging output at 100MiB and stop before exceeding the cap. Clean only staging files owned by that failed job. Record elapsed time, peak resident memory and generated disk bytes. Pixel limits and serial execution are not a hard RSS guarantee: use worst-case fixtures to report observed capacity, not to claim VPS readiness. Browser build/video batches separately retain the repository's 10GiB start and 5GiB stop margins.

### 3. Initial delivery budgets

These are proposed pilot acceptance ceilings in decimal bytes, not a production policy or guaranteed encoding result. Quality and clarity of embedded text still need visual acceptance. The 384px tier is a pixel width, not a universal CSS viewport: `sizes` and DPR must select the correct tier.

| Role and target pixel width | AVIF ceiling | WebP ceiling |
| --- | ---: | ---: |
| Logo 96 | 5,000 B | 5,000 B |
| Logo 192 | 12,000 B | 12,000 B |
| Logo 384 | 25,000 B | 25,000 B |
| Product 384 | 25,000 B | 40,000 B |
| Product 768 | 75,000 B | 100,000 B |
| Product 1280 | 150,000 B | 200,000 B |
| Hero 384 | 20,000 B | 35,000 B |
| Hero 768 | 60,000 B | 90,000 B |
| Hero 1280 | 150,000 B | 200,000 B |

These ladders are bounded pilot coverage, not a complete replacement for Next.js's configured device widths. First record each mounted slot's CSS box, crop mode, source aspect ratio and effective `sizes`; for `cover`, account for both axes of the cropped image. Check mobile viewports 360/390/412 at DPR 1/2/3 and desktop 1365 at DPR 1/2. A 96 CSS-px logo needs 288 pixels at DPR 3; a full-width 412 CSS-px image needs 1236 pixels. Choose a sufficient tier without silently shrinking resolution to meet a byte limit. If a slot/profile needs more than this ladder supports, mark it out of coverage and retain its control behavior; it cannot count as an optimized pass. OgaBassey's desktop path remains a control, not a generated hero migration.

Generate the full covered ladder for the role. If the original is smaller, use its natural oriented dimensions and deduplicate identical tiers while retaining an explicit selection mapping and disclosing source-resolution limitations. A tier over budget at the quality floor fails the job; no ready manifest is activated. A visual rejection also prevents acceptance even when bytes pass. Retain originals for editing and zoom; this pilot does not reduce zoom quality or replace SEO/source originals.

### 4. Atomic manifest and cache identity

Manifest fields include schema/policy/encoder versions and recipe identity, merchant UUID, asset ID, role, source hash and oriented dimensions, and each tier's relative path, explicit content type, dimensions, byte size, quality and output hash. Output object names include the actual output-byte hash, not only the source hash. Strictly validate manifest paths and counts; no arbitrary remote URLs, traversal, unknown fields or unbounded tier arrays. Require all intended tiers to verify before publishing the manifest.

Claim an exclusive per-key job, encode into its own staging directory, independently decode/verify each output, and place the ready manifest inside that directory. Sync completed files and the staging directory, then rename the complete generation directory on the same filesystem as the single visibility commit and sync its parent. If an active reference is needed, sync its temporary file, replace it atomically only after the generation commit, and sync the reference's parent directory. Process-crash atomic visibility and power-loss durability are separate properties; do not claim the latter on a filesystem where the required sync operations are unsupported or failed. An existing generation can be reused only after validating its identity and all output hashes; never overwrite it or delete another job's staging files. Test each crash/sync-error point and concurrent claimant. No full source URL with signed query/token may enter a public manifest.

A hard-killed process cannot clean up its own claim. Bind claims and staging paths to a run token and owner process identity; report an abandoned claim instead of stealing it based on age or PID alone. Recovery may remove only that run's staging after proving the owner exited and revalidating paths beneath the output root. Test hard termination, recovery and PID reuse; unrelated or live claimants remain untouched.

`ready` means machine-verified generation, not visual approval or publication. Record pilot visual acceptance separately, bound to merchant/asset/source, recipe and every output hash. A changed source, quality or encoded byte invalidates that acceptance. Only a matching acceptance record permits candidate use in the lab resolver; rejection leaves the original control active. The pilot's review record is not a production publishing authorization.

The future Storage adapter uploads immutable objects first, verifies availability, then changes the authorized active reference using a source-version compare-and-swap. The pilot exercises that interface using local storage only; no cloud credentials or production write adapter is supplied.

### 5. Lab-only storefront consumption

Add an explicit manifest-aware resolver that takes the trusted merchant, asset ID and current source hash, requested role/width and format. Do not derive tenant authority from a URL alone, fetch a manifest from an untrusted host, or ship all tenants' mappings to the browser. Reject foreign, incomplete, stale and policy-mismatched manifests. Validate the serialized contract in both the standalone generator and a web schema under `apps/web/src/schemas/`, using shared contract fixtures; there is no web import of the generator's native dependencies.

Mounted consumers currently receive URLs, not verified asset hashes. Bridge that contract with a reviewed private pilot inventory binding merchant UUID, stable mounted-slot/product-image identity and exact original URL to the pilot asset ID and captured source hash. Assign an asset ID once in that inventory when no existing image identity is available; do not pretend it is a production media-table ID. Hash the captured bytes during acquisition/generation, never infer a content hash from a URL or filename. A changed slot, original URL or source byte invalidates the binding and comparison.

The lab launcher/preflight validates all ready manifests, matching visual-acceptance records and output hashes, then loads a bounded immutable server-only index for the selected inventory (maximum 20 jobs). Quality sheets inspect verified files directly before acceptance; they do not bypass the resolver's acceptance requirement. After the existing trusted-host/publication/tenant guards, request rendering performs only an in-memory lookup and receives the selected approved tuple, not an all-tenant browser mapping. No image download, decode, encoding or full-directory hashing runs on a shopper request. Missing or mismatched inventory entries retain the control path and are reported as not optimized. Any input/index change requires revalidation and a new frozen comparison, not a silent mid-batch refresh.

Use the existing loader as a compatibility seam only after resolving an approved ready variant; a loader cannot perform a network lookup synchronously. The shared original-URL behavior stays unchanged outside the explicit pilot adapter. Private/signed URLs, native callers, PDP zoom, cards not selected for the pilot, and OgaBassey's desktop path remain untouched.

Record a per-store mounted-consumer coverage table before implementation. The [builder configuration](../../../apps/web/src/components/builder/config.tsx) routes Hero to its CSS-background renderer, Header to [HeaderLogo](../../../apps/web/src/components/storefront/blocks/header-logo.tsx), Image to `next/image`, and ProductGrid through its own card subtree. Identify the actual selected card/image component from the rendered store; do not assume every template or slot uses this configuration. Uncovered consumers must be reported, not silently omitted from the acceptance denominator.

Bind each selected slot by merchant/asset/source identity in a cloned lab configuration, without changing `published_config`, fetching less product data or rewriting every URL globally. A CSS hero needs an explicit background-image adapter (for example, breakpoint-scoped `image-set()`), preserving its box, cover/position, overlay and animation; it is not fixed by the shared loader. OgaBassey's mobile `<picture>` and [mobile hero hints](../../../apps/web/src/app/(storefront)/ogabassey/ogabassey-home-hero-resource-hints.ts) consume one projection, with the transparent `<img>` behavior and separate desktop path preserved.

The lab adapter must preserve dimensions, aspect ratio, effective `sizes`, alt text, loading/priority, crop mode and discovery timing. Emit width descriptors matching the actual encoded widths. Do not return a 768px object for a loader request labelled `750w`, or append an ignored `w`/`q` to an immutable variant. If an explicit responsive projection replaces Next-generated candidates, use the same adapter in both comparison arms and validate a no-op control against the mounted original renderer before claiming storefront CWV. Do not change global `deviceSizes`, quality configuration or component loading architecture for this pilot.

Preload and rendered sources must select the same asset, format and width ladder. Inventory every homepage hint owner: the committed LCP slot, scanner-visible link, static homepage's react-dom hint and rendered `<picture>`. Use one identity/projection across those lab adapters; preserve critical-shell host order and existing Suspense/guard ownership. At initial navigation, preload AVIF only with `type="image/avif"` and let a non-AVIF browser discover WebP from the fallback source; do not preload both supported formats, which can fetch two images even though only one paints. Verify this fallback in a real browser without AVIF support. Existing desktop/PDP emitters remain untouched.

Gate the OgaBassey comparison on a served-HTML/HAR preflight that proves all hint owners agree with the frozen rendered slide-0 in both arms. If the committed constant is stale on the implementation baseline, block that comparison until an upstream correction is incorporated and re-frozen; do not fix only the candidate or count removal of old preload waste as an encoding-only gain. Never suppress an inconvenient baseline request silently.

For a fixed initial viewport, verify one selected hero download with no stale original or unused-format duplicate. Rotation or crossing a responsive breakpoint may legitimately request a new tier: label those interaction requests separately and verify the new selection/geometry rather than demanding one download for the entire journey. Guard/publication checks remain upstream and unchanged. Do not move tenant data into a prerendered public shell to get a faster score. A standalone image fixture is a microbenchmark, not a merchant-storefront LCP result.

On missing/rejected manifest, the control path remains unchanged and is explicitly reported as not optimized. In the proposed future publishing integration, a new critical image remains pending: retain the previous approved image, or an honestly labelled dimensioned placeholder when none exists. Never silently promote an oversized original as an optimized critical-image fallback. Broken/missing hero samples cannot count as performance wins.

## Validation and success criteria

### Automated correctness

Write tests first and demonstrate failures before implementation. Exercise real decoding/encoding using deterministic fixtures with readable text, photographic detail, alpha and EXIF orientation; mock only cloud/network boundaries.

Cover tenant/path isolation, identical bytes belonging to different asset IDs, missing and mismatched source hashes, missing/foreign/changed mounted-slot bindings, malformed manifests, duplicate keys, content type mismatch, corrupt input, source mutation, animation/pixel/channel/byte limits, color conversion, aspect ratio, alpha, no upscaling, budget pass/fail at the floor, timeout during metadata/encoding/verification, absolute job deadlines, staging caps, hard-kill/abandoned-claim recovery, idempotent reuse, atomic activation/crash/sync-error points, stale version/visual-acceptance rejection, bad-output rejection during index preflight, request lookup without acquisition/encoding I/O, actual width descriptors, DPR/tier coverage, CSS-background selection and all preload-owner equality. Validate selected response bytes and dimensions, not only URL string shape.

Because the contract spans generator and web and adds a dependency lock, use `pnpm turbo lint`, `pnpm turbo typecheck` and `pnpm turbo test`, plus `pnpm --dir infra/cdn-transformer run check`. Extend that package's `check` script to include new pilot modules; root Turbo tasks do not cover it. Obtain required current-head CodeRabbit review for runtime implementation; unavailable review remains an incomplete gate. This document-only rereview needs contract/reference checks, not an application build. No instruction, middleware or environment edit is included in this pilot.

The current owner validation guide is `/Users/mac/Baci-app/docs/agent-guidance/validation.md`, read-only guidance outside this frozen worktree; that file is absent on the pilot baseline. Its cross-package/dependency rule agrees with the full commands above. Do not import unrelated primary-checkout changes to obtain the guide.

### Image and browser acceptance

1. Produce a side-by-side original/AVIF/WebP quality sheet at actual CSS slot sizes and DPR 1/2/3. Manually inspect branding, small text, edges, gradients, color and transparency; bind the pilot acceptance record before candidate browser comparisons. User visual sign-off precedes any production policy. Report every selected asset's pass, rejection or out-of-coverage status, rather than retaining only easy-to-compress examples.
2. Before comparing CWV, freeze the exact current source, merchant, role and rendered content. Record source SHA, generated hashes, app/build IDs, effective browser/profile/throttle settings, route/host, cache state and network topology.
3. Use full Chrome, not headless-shell assumptions. For the byte/variant comparison, serve captured original bytes and derivatives from the same lab asset origin with matched protocol, cache policy and same-site relationship; keep the app's mount/fetch sequence unchanged. Verify effective cold/repeat-visit state and connection reuse from artifacts. A separate current-CDN-versus-proposed-host comparison is delivery-topology evidence, not a byte-only gain. Neither proves future VPS throughput.
4. Run both Lighthouse and Sitespeed/Browsertime sequentially with HAR, trace, console and video/filmstrip. Mobile and desktop are separate comparisons; include fast and throttled links and cold/repeat visits. Use two order-reversed pairs for screening, not a no-regression verdict; a promising candidate proceeds to at least five samples per arm on each claimed metric profile, with sample count and decision rules fixed before the batch. Run DPR/geometry correctness separately across the coverage matrix. Quiet-gate starts (load below 10, CPU idle above 50%, no concurrent build/test workload); contaminated samples are diagnostic only.
5. Inspect LCP element/subparts, FCP, CLS, broken images, download duplication, early/late video frames and scroll-during-load. Reject blanking, unstyled content, changed image identity, unexpected failed requests or hydration errors. Classify known baseline failures separately; no generic API-error allowlist or clean-run claim with unresolved errors.
6. Report raw samples, paired differences, medians and ranges per route/tool/profile, with excluded runs and reasons. Identify the actual LCP element, even when it is text rather than the chosen hero. Smaller bytes do not prove lower LCP; an improvement is accepted only if repeatable with visual/functional parity and no demonstrated FCP/CLS regression. Low-powered or inconsistent results remain inconclusive, not proof of neutrality.
7. Live PSI requires a publicly accessible candidate, so this local pilot uses Lighthouse, not a fictitious local PSI score. Capture a fresh live baseline with the existing PSI key without exposing it. Post-deployment PSI and real-user p75 LCP/INP/CLS are later gates, not evidence obtainable before deployment.

No predetermined percentage improvement or sub-2.5s claim. A neutral outcome is a valid pilot result. Do not keep changing quality, content, throttling or delivery host until a desired score appears.

## Follow-on migration, not part of this implementation

After pilot acceptance, design the smallest authenticated enqueue/Storage activation integration using the normal tenant/RLS model. Inventory web, native, imports, builder imagery and existing stored URLs; migrate each writer and reader, then bounded legacy backfill with old-value guards. Do not remove originals or disable Supabase transforms while supported old clients still depend on them.

Before activating a VPS worker, confirm measured encode capacity and queue latency, disk retention and the existing transformer's memory pressure; propose an isolated service/cgroup limit from evidence. No hardware upgrade or live service edit is pre-approved here.

Before production rollout, validate immutable response headers and cache keys, exact active-source/preload alignment through hero rotation, tenant/publication safety and rollback to the previous ready manifest. Supabase transformation usage and storage/egress remain separate cost checks.

Expand beyond the pilot only after a separately reviewed activation plan. A full mobile homepage rebuild is not included or justified by this image-delivery pilot.

## References

- [Sharp safety and input limits](https://sharp.pixelplumbing.com/api-constructor/)
- [pnpm standalone-install workspace-policy behavior](https://pnpm.io/cli/install#--ignore-workspace)
- [Sharp output formats and metadata behavior](https://sharp.pixelplumbing.com/api-output/)
- [Supabase transformation behavior and disable toggle](https://supabase.com/docs/guides/storage/serving/image-transformations)
- [Supabase transformation usage and pre-generation guidance](https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [LCP resource and render-delay separation](https://web.dev/articles/optimize-lcp)
- [Next.js responsive image width and loader contracts](https://nextjs.org/docs/app/api-reference/components/image)
- [React responsive preload identity and deduplication](https://react.dev/reference/react-dom/preload)
- [Format-specific preload and fallback behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload#including_a_mime_type)
- [Repository storefront evidence workflow](../../perf/storefront-visual-regression.md)

The brainstorming workflow requires user review of this spec, followed by a reviewed implementation plan, before runtime edits. CWV guidance informs the visual, geometry and matched-measurement gates; it does not justify reusing previously rejected CSS/scheduling experiments.
