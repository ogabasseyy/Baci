# Commercial template corrections — 2026-10-25

## Implementation

- Category fallback cards now name the actual product destination, identify the brand as a product pick, and state counts as products **on this page**. Real smartphone authority cards keep their collection URLs and supplied category-wide totals/lower bounds. Counts derived from a page slice are explicitly page-scoped even when an authority route qualifies.
- Brand matching normalizes whitespace/case consistently when selecting the representative product, avoiding a missing card for values such as ` HP `.
- The shared grid says “Brands and product picks.” Laptop category pages add a crawlable `/laptops/best-under/under-1m` guide link through their existing deferred navigation section. Eligibility comes from the destination's public offer loader, including variant/availability rules, rather than the currently displayed product slice. A missing/ineligible guide is omitted; a failed optional load preserves existing comparison links. The guide and comparison inventory load in parallel.
- Pagination, canonical generation, smartphone authority URLs, and offer/schema content remain intact. No privileged client, migration, environment, proxy, deployment, or catalog mutation was introduced.

## Regression verification

Before implementation, three new card tests failed on misleading names/count scope and normalized brand selection. A new deferred-navigation test failed because the eligible laptop guide was absent. They pass after implementation.

Eight focused suites cover category cards/model, rendered/SSR product links, hub sections, support links, deferred guide eligibility/load failure, and category page composition: **46 tests passing**. Biome passed on the included owned files. The repository configuration excludes the touched SEO component files from `biome check`; the new JSX test was formatted through Biome stdin. Full application validation and CodeRabbit review are coordinated by the parent task.

## Bounded public cold-mobile exploration (T3)

Evidence: `template-pdp-mobile-20261025/` alongside the original audit, outside Git. Includes exact runner, JSON summaries, Chrome traces, minimal HAR without bodies, recorded videos, filmstrips, and settled screenshots. This measures the currently public release, not these local changes.

One fresh browser context per route; Chrome 156.0.8078.48 / Playwright 1.63.0; 390×844 viewport, touch/mobile emulation, 4× CPU slowdown, 150 ms configured latency, 1.6 Mbps down / 750 Kbps up, cache disabled, 12 seconds of observation after DOMContentLoaded. Sequential navigation-only runs. Android Chrome user agent is emulated; this is a macOS lab, not a physical handset. Other agents ran local checks, so host contention is uncontrolled.

| Observation | iPhone 16 | MacBook Pro M5 |
| --- | ---: | ---: |
| HTTP status | 200 | 200 |
| Encoded document body, zstd | 45,637 B | 35,999 B |
| Decoded HTML | 614,221 B | 244,335 B |
| Observed completed-request network bytes (CDP) | 707,327 B | 693,627 B |
| Observed script network bytes (CDP) | 555,083 B | 554,934 B |
| Navigation LCP observation | 5.300 s | 5.048 s |
| Layout-shift score during observation | 0.299477 | 0.299477 |
| ScriptDuration (CDP) | 0.405 s | 0.427 s |
| TaskDuration (CDP) | 1.473 s | 1.347 s |
| Recorded long tasks | 99 ms, 70 ms | 107 ms, 77 ms |

Both traces contain one main-frame LayoutShift without recent input, so the raw observer sum equals that single shift score. This is bounded navigation evidence, not a complete session/CWV verdict. Both LCP elements were the main product image. Filmstrips/screenshots show the expected product images and cookie notice overlap. Each session had a guest-cart 401 and an aborted privacy RSC prefetch; there were no uncaught page JavaScript errors. Two image elements per page had empty source/unloaded dimensions; full image validation and full-video review remain incomplete. These runs are not a release performance pass.

The large difference in decoded HTML did **not** establish a corresponding script-execution increase in these two uncontrolled samples. The larger document's encoded body was only 9,638 bytes larger. No avoidable duplicate serialization or causal hydration bottleneck was demonstrated; no payload optimization or structured-offer removal was made. More samples and independent profiling are needed before changing PDP serialization. INP was not measured; no interaction claim, field CrUX/Search Console result, ranking outcome, or production improvement is asserted.

## Remaining verification

Render the changed local category routes against representative published inventories and then verify raw/rendered production HTML after an authorized deployment. Field CWV, complete rich-result validation, a repeatable performance baseline, and production completion are separate from these local fixes and exploratory measurements.
