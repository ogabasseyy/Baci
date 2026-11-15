# Ogabassey PDP design: data-binding audit

Date: 14 November 2026. Scope: local product.html design preview compared with this redesign checkout. This is a source audit, not a production integration or performance certification.

## Verdict

The design is implementable without creating a separate catalog or commerce system. Most factual content already has a source. The preview itself is a static Tecno example: its price, specifications, options and purchase link are not connected to the production PDP state. Apply its visual treatment to the existing critical shell and commerce islands instead of shipping the preview as a replacement page.

## Binding inventory

| Visible element | Existing source / connection | Required implementation |
| --- | --- | --- |
| NEW · TECNO | Selected offer condition + product.brand | Format condition with existing helpers. Update badge with selected offer; omit unknown brand rather than guessing. |
| Product heading | product.name | Preserve exact catalog title; remove hand-inserted line break and period. Let CSS wrap long names. |
| Breadcrumb | Resolved category name/slug, product name, merchant basePath | Reuse critical-shell breadcrumb links and existing canonical route. Never hardcode Tablets. |
| Gallery | Existing primary-image/media resolution and selected-variant image | Retain image sizing, preload and fallback behavior. Bind thumbnails to actual images; no invented colour choices. |
| Price | Critical commerce provider, pinned route offer, selected variant, currency config | Both main price and pay-in-full panel use the same resolved price. Do not bind directly to parent price when an offer/variant is selected. |
| RAM / storage / condition chips | Actual variants, variant axes and selectable combinations | Restyle existing selectors; render only axes that exist. Preserve unavailable combinations, route selection, offer identity and stock validation. One fixed 6GB/128GB chip cannot represent the catalog. |
| Availability | Existing commerce stock resolution, manage_stock and selected offer | Preserve unknown availability versus out-of-stock. Do not infer availability from a price or image. |
| Intro paragraph | Catalog description/excerpt; optionally a deterministic factual summary | The bespoke Tecno paragraph is preview copy. Use an existing safe excerpt by default. Do not fabricate features to fill space. |
| Four specification cards | buildProductSpecData(...).specs | Use category-aware normalized facts; render up to four suitable facts, fewer when missing. Do not force display/processor/storage/battery cards onto every category. |
| Full specification section | buildProductSpecData(...).detailedSpecs | Keep the full normalized table below the cards. Cards are highlights, not a replacement. Selected configuration facts must agree with selectors. |
| Product description | Existing server-sanitized descriptionSlot | Preserve full description and server rendering; promotional text cannot replace it. |
| Purchase CTA | Existing critical commerce/cart components | Replace preview's external Continue link with functional add-to-cart, quantity and existing validation. Retain selected variant/offer identity. |
| Delivery / help | Existing delivery estimate/location flow and merchant support details | Restore delivery information. Avoid universal delivery-time or free-shipping promises. |
| Instalment panel | Merchant financing-provider settings and existing eligibility flow | Settings include provider enablement and amount bounds. General 25–40% / 3–6 month copy is not a product-specific quote. Render actual terms only from the financing result; otherwise show eligibility-qualified information. |
| Save towards this device | Existing merchant-scoped wallet route | A wallet link exists. Product-linked savings target creation and applicable interest terms are not proven by that link and need a separate contract/flow verification before promising them. |
| Google review section | google_reviews_enabled, google_place_id, existing Google reviews adapter | Resolve settings for the merchant, preserve attribution and failure fallback. These are reviews of the store, not this product; do not feed them into product review counts or Product aggregateRating. Local newest-sort proxy is preview infrastructure, not the production integration. |
| Product rating / reviews | Existing product rating source and product-review UI | Preserve separately from Google business reviews. Do not copy Google's store score next to a product as its rating. |
| Repair / sustainability panel | Ogabassey brand content and enabled service routes | Reusable brand-level copy is appropriate. Gate service links by actual availability; do not imply every device is used or repairable. |
| Footer contacts / socials | Existing Footer merchant support fields, address, social_media | Restyle the existing component; avoid independent hardcoded contact details. |
| Footer policy links | Existing merchant trust profile and publishable-policy checks | Preserve conditional returns/shipping/warranty links. Preview currently displays links unconditionally. |
| Service navigation | Existing routes plus feature availability and merchant basePath | Keep expanded layout; show relevant services only. Avoid copying Ogabassey's services into unrelated merchants. |

## Copy ownership

Keep three distinct sources: product facts from the catalog; operational promises from merchant settings and authoritative commerce responses; brand copy from Ogabassey's reusable content configuration.

“Your next possibility”, “Made for your big ideas” and “Good tech. A longer story.” can be shared brand copy. Product-specific slogans should be optional editorial content with an approved authoring path, not mandatory new fields for every SKU. No verified existing PDP slogan field was identified in this audit. Start with a factual description fallback; do not add a CMS or per-request AI generation just to preserve mockup text.

An existing buildOgabasseyProductVisibleSummary helper derives brand/name and selectable variant facts, rejecting conflicting or missing values. However, a source search in this checkout found its definition and tests, but no runtime caller. Treat it as an available, tested building block that still needs explicit integration—not an already-connected production feature.

## Existing code to preserve

Paths below are repository-relative:

- apps/web/src/app/(storefront)/[slug]/(catalog)/(pdp)/[category]/[productSlug]/page.tsx: route-pinned offer/variant selection, critical provider, image preloading, metadata/JSON-LD and deferred content.
- apps/web/src/components/storefront/ogabassey/pdp/critical-shell.tsx: server shell, breadcrumb, product identity, rating and commerce slots.
- apps/web/src/components/storefront/ogabassey/pdp/critical-product.ts: primary image, category and critical product projection.
- apps/web/src/components/storefront/ogabassey/pdp/build-product-visible-summary.ts: deterministic factual summary; currently no runtime caller found.
- apps/web/src/lib/storefront-specs/spec-data.ts: structured/legacy/key specs, description fallback, category filtering and summary priorities. Reuse its precedence rather than creating a second parser.
- apps/web/src/components/storefront/ogabassey/pages/product-details-page/product-normalization.ts: normalized media, specifications and product details.
- apps/web/src/components/storefront/ogabassey/pages/product-details-page/offer-resolution.ts: existing offer/variant price and identity resolution.
- apps/web/src/components/storefront/ogabassey/pages/product-details-page/deferred-product-details-sections.tsx: server description slot and deferred interaction sections.
- apps/web/src/hooks/merchant/queries.ts: merchant feature projection, including financing provider settings and Google review settings.
- apps/web/src/components/storefront/ogabassey/pages/wallet.tsx: merchant-scoped customer wallet integration.
- apps/web/src/components/storefront/ogabassey/components/Footer.tsx: contact/social sources and conditional policy links.
- apps/web/src/lib/google-places-reviews.ts: existing Google review adapter.

## Implementation order and acceptance

1. Restyle the existing critical shell, badges, selectors and purchase controls. Preserve the route/provider architecture.
2. Bind intro, specification highlights and full details through existing normalization. Define missing-data behavior and category-aware card selection.
3. Connect merchant reviews, footer and service availability. Keep brand content shared and optional product editorial copy separate.
4. Connect financing and savings only to the verified flows; leave unsupported promises out until their contracts are established.

Before launch, verify a simple product, a multi-variant phone, a used/open-box offer, a laptop, an accessory, unknown stock, out-of-stock and incomplete specifications. Check that deep-linked variants keep matching price, condition, image and cart identity. Verify disabled services and missing merchant policies disappear cleanly.

Preserve existing canonical URLs, metadata, Product/Breadcrumb JSON-LD, crawlable links, full server description and semantic spec content. Compare rendered facts against structured data. Keep reviews and optional interaction below the critical render path, preserve the LCP image strategy, and reserve image/section space. Run focused semantic/selection regression tests and measure representative product routes before and after with the same conditions. A static preview cannot establish CWV parity.

Audit produced documentation only; no runtime bindings, schema changes, deployment or new performance measurements were made in this audit.

## Connected implementation — 2026-11-15

The approved design now decorates the existing critical product shell and commerce components. Catalog condition, brand, identity, image and price retain their existing sources. Single-value configuration facts use the existing variant-axis helpers; multi-value selections retain the existing commerce state. Optional intro copy uses the existing description excerpt helper and is omitted when unavailable. Highlights use the same normalized server spec sections as structured data; configuration-specific and uncertain editorial notes are excluded from highlights while full specifications remain intact.

The footer retains merchant contact/policy configuration and adds sustainability content and feature-gated Google business reviews. These remain store reviews, separate from product ratings. The existing production reviews adapter returns relevance order, so the connected component says “Most relevant.” Financing copy links to existing checkout/wallet behavior without inventing eligibility, interest or payment amounts.

Local preview: `http://127.0.0.1:3477/ogabassey/tablets/tecno-megapad-2` and `/ogabassey/tablets/ipad-10th-gen-2022`. The preview uses a temporary development launcher to accommodate shared dependency/version mismatches. Its reviews request forwards to the existing public production endpoint because local Google credentials were unavailable; no production credentials or settings changed.

Observed: iPad storage selection updates price from ₦440,000 (64GB) to ₦590,000 (256GB); Tecno renders catalog RAM/storage; light/dark styling and a 390px viewport were checked with no horizontal overflow. Tecno renders one H1, ProductGroup and BreadcrumbList; its local canonical uses the existing development base URL. Production canonical output was not re-certified.

Validation: the final six-file binding regression run passed 27 tests; subsequent shell/server-detail verification passed 14 tests in two matched files. Focused Biome checks and whitespace checks passed. Broader app lint/typecheck could not run because pnpm refused to replace the shared node_modules symlink. Existing image preload/reserved dimensions, server description, metadata generation and deferred architecture remain in place. No production performance measurement, deployment, commit or release review was performed. The full before/after performance and product-state acceptance matrix above remains a release gate.

## Visual correction and dependency validation — 2026-11-15

The connected page initially retained too much of the previous layout. The corrected shell restores the approved concept's larger warm gallery, bold wrapping title, dark price, clean themed header and bordered configuration controls. Mobile dark mode was inspected at 390px: the image decoded, the document had no horizontal overflow, and one H1 remained. The new development preview is `http://127.0.0.1:3479/ogabassey/tablets/tecno-megapad-2`.

The task worktree now has an independent frozen-lockfile pnpm installation, replacing its symlink to the shared checkout's dependency directory. No environment files were changed. The old development launcher and temporary TypeScript workaround are no longer used.

A regression discovered during the full checks was corrected: the introduction now strips stale absolute-price sentences using the existing description sanitizer before deriving its excerpt. The product/route regression run passed 98 tests. The final design, navigation, shell and footer run passed 40 tests across eight files. Image preload/render parity checks passed after updating the shared desktop size hint for the wider gallery. The runtime authority/coverage verification passed after associating the new modules with their existing behavioral integration suites and adding footer settings tests.

The requested full monorepo checks and strict production build are still in progress as of this entry. The mobile storefront run passed 1,929 suites / 11,447 tests. Web results are not yet final, and a dependency scaling test also reported a failure that still requires classification. The production bundle compiles; build-time type checking is pending. These are not release or performance approval. The shared Mac is under load from other jobs, so current development rendering timings cannot establish CWV non-regression. No deployment or commit has been made.

Build follow-up: strict production TypeScript completed successfully. Page-data collection then failed because this local checkout lacks `SUPABASE_AGENTIC_JWT_PRIVATE_JWK` (or its configured fallback) and `QUIZ_RPC_SERVER_SECRET`. No placeholder credentials or environment-validation bypass were introduced. Production-mode performance comparison is blocked until the authorized build environment supplies these settings. The isolated smol-toml recheck passed both tests; the full-suite scaling failure is not reproduced and has not been fixed by changing the dependency or weakening its test. The full monorepo run remains active, with its log at `/tmp/ogabassey-full-checks-resumed.log`.

## Verification follow-up — 2026-11-15

This entry supersedes the in-progress status above. The full monorepo lint,
typecheck and test run completed: 20 of 22 tasks passed initially; web tests and
web typecheck needed corrections or isolated follow-up runs. The original web
failures subsequently passed focused rechecks. Web lint and the complete web
typecheck command passed. This is a full run followed by targeted repairs and
rechecks, not a claim that one untouched full run was green.

Production compilation revealed that the optimized PDP does not load
`globals.css`. The gallery color tokens now load through the existing critical
PDP stylesheet; a regression test failed before the correction and passed
afterward. CodeRabbit reviewed this correction with zero findings.

The production-mode comparison uses the existing `VERCEL_ENV=preview` catalog
cap. The first three-run mobile iPad comparison was 85 live versus 82 new. The
manifest showed iPad was absent from that capped prerender set, while Tecno was
present. Preview sampling now pins both fixed-configuration and multi-variant
QA products. The regression test failed before the fix; all 11 static-param
tests pass afterward, including unchanged full-catalog production coverage.
Both paths exist in the rebuilt prerender manifest. Local iPad first-byte time
dropped from approximately 920 ms to 6 ms in the follow-up curl probe. This is
a preview coverage correction, not evidence of a production runtime speedup.

The preview-coverage build was `JbhgqDrlT0m9JJ1bz_H2w`. It compiled, passed strict
TypeScript and completed 834 static pages. Full production catalog enumeration
was not run to completion. The current preview is
`http://127.0.0.1:3478/tablets/tecno-megapad-2`, with the sibling
`/tablets/ipad-10th-gen-2022` path for variant verification.

The local ignored configuration contains an isolated quiz build secret, a saved
legacy signer, the existing Google Maps key and the existing payment-provider
key. No secrets were committed. The saved signer does not verify against the
project JWT; current Vercel downloads return the signing/quiz values empty.
Runtime signing is therefore still unresolved locally. The performance proxy
forwards only `POST /api/events` to the actual live endpoint and preserves its
response. Other storefront requests use the local production server. This
setup does not certify local signing or quiz authorization.

Both products' final fetched metadata (title, canonical, description, robots,
H1) and complete ProductGroup/Breadcrumb JSON-LD compare identically to live,
including accepted payment methods after restoring the existing local gateway
configuration. Lighthouse's shared meta-description warning remains distinct
from this content-parity result: the normal streamed response places the tag in
the body. No deployed SEO configuration was changed.

Raw evidence is in `/tmp/ogabassey-pdp-comparison/`. Lighthouse is 13.4.1 with
Chrome 149.0.7827.22, cold browser samples, default simulated mobile throttling
and the desktop preset. Sitespeed 42.7.0/Chrome 152 video runs are visual checks,
not mixed into Lighthouse medians. Initial Docker HTTP samples were rejected
because CSP upgraded asset requests to HTTPS. A separate video-only local proxy
removes that directive for the Docker HTTP hostname; production CSP is intact.
The four corrected video checks each loaded 53 requests without failed HTTP
responses and showed the intended gallery and loaded product image.

These are public-CDN-versus-local-server lab measurements on a heavily loaded
shared Mac. They cannot establish a causal code speedup, field INP, or a field
CWV non-regression guarantee. No deployment, push, merge, purchase or payment
was performed.

A follow-up also found a protocol mismatch: the live origin negotiated HTTP/3
while the local HTTP server used HTTP/1.1. The final paired Lighthouse batch
forces HTTP/2 on both targets (`--disable-quic`) and serves the local build
through a task-only HTTPS HTTP/2 proxy. Both audit browsers receive the same
certificate-error flag for the local self-signed certificate. Earlier protocol-
mismatched runs remain diagnostic evidence only. A `NO_NAVSTART` trace failure
was rejected, retained separately and retried rather than counted as a score.

The subsequent gallery audit found another concrete sizing mismatch: the
editorial image has 2rem horizontal padding on each side, but its shared image
and preload hints still described the outer frame. The hints now subtract
64px. Two existing sizing checks failed first; all 13 image/source/preload
checks then passed. The non-editorial fallback keeps its original full-frame
hint, and its seven gallery tests pass. The final production-mode build is
`xpZRe-Iau60Obq6FqFIWW`: compilation, strict TypeScript and 834 prerendered pages
completed. Metadata and JSON-LD still compare identically to live. A scan of
1,069 compiled client files found zero matches for the task's server secrets.

The route-inventory source receipt now targets `1f9cbc29d4`; all 630 route
classifications are unchanged, and all seven repository snapshot tests pass.
CodeRabbit completed the preview/critical-image review with zero findings. The
follow-up covering the fallback-gallery adjustment was rate-limited (29-minute
wait; provider seat unavailable for usage-based reviews). That last review gate
is pending; the final image/fallback changes remain uncommitted.

Because Lighthouse's simulated iPad LCP worsened while the observed trace LCP
improved, the evidence also includes three paired mobile samples using
`--throttling-method=devtools`. This is a separate diagnostic series with
throttling applied to the browser, not a replacement or selective removal of
the default simulated scores. Neither series measures field INP.

### Final live-versus-local measurements

Lighthouse 13.4.1 / Chrome 149, three cold samples, HTTPS HTTP/2 on both
targets, default simulated profiles. All 24 final reports passed the request,
LCP/CLS and screenshot validity gate. The local candidate build is
`xpZRe-Iau60Obq6FqFIWW`.

| Product | Profile | Live score | New score | Live LCP | New LCP |
|---|---|---:|---:|---:|---:|
| Tecno MegaPad 2 | Mobile | 77 | 82 | 5.18s | 4.87s |
| Tecno MegaPad 2 | Desktop | 90 | 95 | 1.71s | 1.46s |
| iPad 10th Gen | Mobile | 95 | 85 | 2.78s | 4.20s |
| iPad 10th Gen | Desktop | 93 | 98 | 1.20s | 0.97s |

CLS is unchanged: 0 mobile, 0.061 desktop. Both sides score SEO 92,
accessibility 97 and best practices 100. The separate directly throttled iPad
mobile medians are 84 live / 82 new, LCP 3.50s / 3.48s, TBT 111ms / 117ms.
The iPad mobile live-versus-local gap is not cleared by these results; it must
not be hidden by the better desktop or Tecno scores.

Persistent reports, sample ranges and individual HTML audits:
`/Users/mac/.codex/visualizations/2026/11/12/01a1d19a-fed4-7443-8a9c-1fdf54c9b531/ogabassey-pdp-performance-2026-11-15/comparison.md`.

A same-server replay diagnostic served both captured public pages/static assets
from memory using the same HTTPS/HTTP2 server and gzip compression, while
forwarding APIs to their actual upstreams. Initial baseline samples that
blocked the analytics-flags POST were rejected and rerun. All six corrected
reports passed network/screenshot/metric validation and had no console errors.
The live-design scores were 86, 86, 87; new-design scores were 87, 87, 87. This
supports a delivery/test-environment explanation for the larger default
live-versus-local gap. It is not a substitute for the actual scores and does
not certify production-hosted CWV.

Final browser check: decoded 640px iPad image, canonical production URL, one
H1, 35 specification terms, no desktop overflow or console errors. At 390px in
dark mode there is no horizontal overflow; selecting 256GB sets the pressed
state and updates the displayed price to ₦590,000. No cart or checkout action
was taken.

### Follow-up verification — 2026-11-15 08:30 WAT

The previously quota-blocked CodeRabbit review completed with zero findings
for all eight outstanding files (`/tmp/ogabassey-review-signing-final.log`).
Signing-material and event-ingress capability tests passed: two files, ten
tests (`/tmp/ogabassey-signing-guards-check.log`). This verifies rejection of
invalid configuration, not successful signing against production.

The configured legacy JWT value is a UUID/key identifier, not verified signing
material. A locally available legacy secret verified only another project's
anon token; a separate build JWK did not match the current project's public
JWKS. Neither was installed. The user does not know the trusted private key's
location. Existing local and VPS configuration checks did not recover it. No
production signing key was created, rotated or revoked; no secrets were logged.
Supabase documents that private signing material cannot be extracted after
moving to signing keys: https://supabase.com/docs/guides/auth/signing-keys.
Recovering the original private key or explicitly approving a separately
reviewed production signing-key configuration is still required.

Fresh local response headers measured domain-context routing at 788–847ms
and domain-routing at 377–893ms, totaling 1.16–1.74s before page delivery.
The local preflight also reports missing INTERNAL_API_SECRET. These are
configuration/hosting differences to investigate, not proof that the observed
mobile score gap is fixed. The original live-versus-local results remain the
authoritative recorded comparison; no new score is claimed. No deployment,
push or merge occurred.

### Agent-assisted performance follow-up — 2026-11-15

Sol implemented observer-driven search docking; Terra reviewed the final changes.
The same 51-step browser exercise fell from 50 layout reads to one, including
verification on the final production homepage. Search text/focus are preserved.
Reserve and real hero now share the header-search hiding selector; its regression
test failed before the change and passed afterward. The asynchronous observer
race found by CodeRabbit was also fixed and regression-tested.

Final build `0iz7nyCcO8LiV9jqkdneQ` passed compilation and TypeScript. All 18 final
iPad Lighthouse reports passed the report-validity gate. Under directly applied
throttling, mobile medians tie 82/82 (live/new). Uncontrolled-origin desktop
medians are 95/83; explicitly warming both origins before each fresh-browser
audit produces 92/98. These are different cache conditions; neither set replaces
the other. The local cold routing cost remains, and production CWV/INP are not
certified. SEO/a11y/best-practice scores match at 92/97/100 across all final runs.

Full ranges, LCP/TBT/response timing, raw reports and remaining limits are at:
`/Users/mac/.codex/visualizations/2026/11/12/01a1d19a-fed4-7443-8a9c-1fdf54c9b531/ogabassey-pdp-performance-2026-11-15/agent-followup/report.md`.
No deployment, push or merge occurred.

### Cold-routing follow-up — 2026-11-15

The custom-domain context now resolves the domain slug's rename alias and an
eligible path-prefix alias concurrently. Matching prefixes share the same
promise. Redirects still require the resolved alias to belong to the effective
merchant; API exclusions, route-collision guards, liveness checks and cache TTLs
are unchanged. The regression test demonstrated the previous serial wait before
passing with the change.

Three alternating fresh Node processes per implementation, querying the same
public routing data under anonymous RLS, measured the previous lookup sequence
at 1554/1517/1693ms and the new context at 1121/1099/1068ms: median 1554 -> 1099ms
(29% lower). This is a routing microbenchmark, not a Lighthouse or field CWV
measurement. The new production build is `FEJ0Bm9n9TwRyOLOb6L_6`. Its first local
iPad PDP request returned HTTP 200 with TTFB 1343ms and proxy timing 1161ms
(domain-context 1151ms, routing 9ms). Cold remote database latency remains.

The production build including TypeScript passed. The final routing/signing
subset passed 20 tests in five files; the implementation agent also verified
32 routing/canonicalization/cache/timing tests. Independent Sol review found no
actionable issue. CodeRabbit completed with no critical/high findings and one
trivial suggestion to extract the prefix eligibility helper. It remains beside
the alias canonicalization logic because the helper is small and shares that
responsibility; the context dependency is type-only in the reverse direction.
`git diff --check` passed. This is not a fresh full-monorepo validation claim.

Signing recovery was explicitly approved, but the Supabase management API
rejected importing a new standby key at the project's trusted-key limit. The
existing standby was briefly moved to previously_used to free the standby slot;
a second HTTP 422 required revoking an existing key. The original standby status
was immediately restored and every original key status verified. No key was
imported, revoked, deleted or rotated. The generated private key remains outside
Git with mode 0600, untrusted and uninstalled. No hosted application environment
or deployment was changed. Signing-dependent runtime checks remain blocked
pending a separate decision about replacing an existing trusted key.

The complete web-package lint and typecheck scripts subsequently passed (lint
has 18 warnings). All 12 final directly throttled iPad reports passed the report
validity assertion: live/new performance medians 82/91 mobile and 96/96 desktop;
LCP medians 3.694/2.814s mobile and 1.000/1.167s desktop. SEO 92, accessibility 97,
best practices 100 and CLS (0 mobile, 0.061 desktop) match. Desktop's 167ms LCP
increase remains visible; equal scores do not clear that difference. One invalid
NO_NAVSTART run was excluded and retried. These are fresh-browser samples with
uncontrolled origin caches, not uniformly cold-server samples. Current browser
verification at 390px shows one H1, correct canonical URL, decoded image, no
horizontal overflow and no console errors/warnings.

Final reports and recovery outcome:
`/Users/mac/.codex/visualizations/2026/11/12/01a1d19a-fed4-7443-8a9c-1fdf54c9b531/ogabassey-pdp-performance-2026-11-15/cold-routing-followup/report.md`.

### Read-only standby usage and desktop trace investigation — 2026-11-15

No signing-key or environment mutation, revocation, deployment, or runtime source
change was made in this follow-up. Final management metadata still shows the
original active key and standby key. Seven daily Supabase edge-log queries
(2026-11-08T00:00Z through 2026-11-15T00:00Z) found 82,590 ES256 requests with the
active key ID and none with standby ID 311dac86-c3ef-474a-8493-e7765d28beeb. VPS
configuration references and current Vercel environment-name metadata did not
identify a consumer of that standby. Archived August records identify it only
as an already published key, not a creation receipt or private-key location.
This is no observed use in checked sources, not proof that an infrequent external
consumer does not exist. Signing-dependent checks remain blocked.

The six existing desktop traces explain the median 167ms LCP difference as
+79ms navigation TTFB, +11ms image discovery, +138ms image loading and -61ms
image render delay. Both pages load the same 2,452-byte cached AVIF. Live receives
HTTP 103 CDN preconnect hints and reuses an HTTP/2 connection; loopback sends
preconnect with the final response and opens a fresh CDN connection. Candidate
image discovery is eager/high-priority in initial HTML, and image render delay
is only 20–24ms. The traces identify no actionable frontend bottleneck. Equivalent
edge/cache delivery remains necessary to quantify the actual production delta;
these findings do not convert local lab scores into a production CWV pass.

Metadata-only key evidence: `cold-routing-followup/standby-key-trace.md` and
`standby-key-log-counts.json`. Per-run phase and trace evidence:
`cold-routing-followup/desktop-delay-trace.md`, under the persistent performance
artifact directory linked above. Existing build/lint/typecheck/tests remain the
latest code validation; no redundant suites were run for this read-only audit.

### Isolated signing integration completed — 2026-11-15

Created a separate unlinked local Supabase stack on loopback ports 54371/54372,
with a newly generated test-only ES256 signing key and two synthetic merchants.
No production keys, hosted environment or deployment changed. The stack applies
12 unchanged event-ingress migrations with repository event tables/policies and
a minimal synthetic merchant prerequisite.

The actual production-mode signer/client passed 31 HTTP integration checks;
four clean-process invalid-configuration checks and 14 focused unit tests also
passed. Real PostgREST/RLS accepted correct capabilities and rejected expired,
forged, unsigned, under-scoped and mismatched claims. Both synthetic tenants see
only their own event. Analytics and platform retries are idempotent. SQL verified
2 analytics rows, 1 platform row, 3 ledger rows and 3 matching queue messages,
with no delivery attempts. Tests make only local HTTP requests and use no admin
client. Independent review corrections were applied before the final passes.

Test configuration/data are preserved outside Git; only this task's stack was
stopped afterward to limit shared-Mac resource use. Evidence contains no local
credentials. The isolated signing integration gate is now passed. This does not
certify the full Next route, Auth login lifecycle, external deliveries or hosted
production signing; production configuration remains a separate release gate.

Evidence:
`/Users/mac/.codex/visualizations/2026/11/12/01a1d19a-fed4-7443-8a9c-1fdf54c9b531/ogabassey-pdp-performance-2026-11-15/isolated-signing/report.md`.

### Isolated HTTP route verification (2026-11-15)

The reusable `apps/web/test-fixtures/event-ingress-isolated` fixture starts a loopback-only Next.js development server and imports the actual `/api/events` handler. It uses the dedicated synthetic Supabase database, generated local ES256 key, real context resolver, cookies, scoped clients, RLS, ledger and queue. It strips inherited environment configuration and rejects external fetch destinations. No production keys or deployment settings changed.

This caught a real legacy persistence bug: PostgREST targeted upsert required SELECT privileges that the ingress capability deliberately does not grant. Plain insertion now acknowledges only the exact event-identity unique-index conflict; other errors remain failures. The failing first-write and replay checks now pass without widening RLS. Eight focused route test files pass (47 tests). Six durable rows have matching queue entries; legacy writes with and without event IDs persist; duplicate requests do not add rows. Signing configuration failures return a safe 500.

This verifies the HTTP handler, not the application proxy, production configuration, login lifecycle or external delivery. The earlier production-mode signer integration remains complementary evidence. Production signing readiness is still a release gate. CodeRabbit CLI was attempted for the final changes but refused review because the included review quota was exhausted and the provider account lacks an assigned usage-based seat; this gate is outstanding, not passed.
