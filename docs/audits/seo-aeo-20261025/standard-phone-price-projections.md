# Standard phone-card price coverage — 2026-10-25

## Confirmed gap and fix

The live homepage contained an iPhone 16 record with `price="₦600,000"`, `rawPrice=600000`, and no selected variant. Its ID was `094152bc-689b-4c27-8901-325a2ecce92d`. The previous PDP/price-range change could not fix this: homepage selects and category-window selects returned parent prices, the shared hydration leg only resolved inventory summaries, and the actual card mappers formatted parent prices directly. The receipt is `02-default-advertised-phone-card-evidence.json` beside the original audit. Live output remains a pre-deployment observation, not evidence that this uncommitted change is deployed.

A server-only listing projection now reads public variants only for phone families already present in the requested product window, through the existing cached public variant RPC. It uses the same default-variant selector and canonical public purchasability projection as the PDP paths. It returns scalar advertised price, condition, min/max, comparison-price suppression and selected primary imagery; it never attaches variant arrays to the client DTO.

Crucially, the raw parent `price`, `condition`, `compare_at_price` and `images` are preserved. Nullable variant overrides still inherit the real parent checkout price. The listing mappers consume explicit `advertised_*` fields; the PDP and feed sources are unchanged. Unsupported parent RRP/discount claims are suppressed for a different selected configuration. A selected primary image is used only when present in actual variant data; unknown imagery falls back to the family gallery.

## Actual paths covered

- `cached-data.ts`: bounded home product, launch-product, and category detail-window projection legs. Existing cache directives/tags, merchant-scoped product queries and public RPC contracts remain in place.
- Homepage: `ogabassey-home-product-adapter.ts` → `home-product-feed.ts` → existing HomeProductGridCard/ProductGridItemChrome.
- Category: `normalize-product.ts` → `category-page-content-helpers.ts` → existing ProductCard.
- Plain search: `storefront-search-products.ts`; only the selected result window receives variant-price projection. The pre-existing family-filter candidate read is not expanded with all-candidate variant reads.
- Generic public API listing: `/api/storefront/products` cached filtered/unfiltered results, requested IDs and plain ranked-search result mapping. Projection happens after the existing scoped/windowed read and applicable filters.
- Refined search: `storefront-search-refined-products.ts` verifies the exact matched phone variant through `check-refined-phone-matches.ts`. It drops stale/missing public SKU identities and implicit restricted selections. It does not replace them with another SKU or relax brand/condition/budget/processor constraints. A clear positive Wi-Fi-only query preserves the exact restricted offer with an explicit configuration title and connectivity disclosure; negated/exclusion requests are not positive intent.

`has_variants` and `variant_model` survive the compact mapping chain. The already-existing “Choose options” guards therefore route to selection instead of adding a parent product with an advertised variant price. No card renderer rewrite was needed.

## Bounds, counts and recall

Phone families with no eligible public cellular offer are excluded from standard cards, including restricted-only families. Normal Wi-Fi tablets remain unaffected. Parent prices are never used to fill an unknown or unavailable phone-variant projection, and public RPC failure propagates through existing unavailable/error handling.

Global catalog totals and page boundaries remain the existing all-active-row scope; only the current returned window is filtered. This does not establish a new globally eligible product count. The category integration regression explicitly preserves `productCount=1` while returning no standard cards for a restricted-only family.

If a newly advertised default lies outside an existing budget or condition constraint, that result is omitted rather than substituted with an unrelated SKU. SQL may not refill a different eligible variant after a refined match is filtered, and legacy SQL candidate sorting/filtering still uses its existing catalog projection. This can reduce recall or leave sparse windows. A future typed connectivity intent and backend candidate selection could improve recall; no new SQL/RPC/migration or unbounded catalog read was introduced here.

## Verification and scope

- Initial exact regression: RED six failures demonstrating parent 600k reaching actual home/category card mapper chains, missing display facts, restricted-only fallback and unreadable-RPC fallback. GREEN after implementation.
- Refined guard: RED five failures for implicit/negated restricted recommendations and missing explicit disclosure; GREEN after implementation.
- RRP/image regression: RED parent 600k / parent RRP 1.2m incorrectly carried into a different 900k selection; GREEN with unsupported RRP suppressed and actual selected image used.
- Post-projection constraint regression: RED default outside budget/condition remained visible; GREEN after rejection guard.
- Final affected-package run: **324 tests passed across 23 files**, including real public API GET, plain/refined search, cache-window integration, home/category mapper chains and existing card selection guards. Biome checked 19 owned files clean; whitespace diff check passed.
- New runtime modules: price projection 148 lines, exact refined-match check 79 lines, listing facade 23 lines. Their focused tests remain below 300 lines.
- Full semantic typecheck, review and final source-hash regeneration remain with the parent task. No heavy TypeScript run, commit, database mutation, provider submission or deployment was performed by this subtask.

## Semantic-boundary follow-up

Addressed the five parent-reported type errors without `any` or suppression: generated fixtures pass through the existing RawDbProduct runtime guard, refined sort fixtures use `price_asc`, and the dynamic category select now passes through `readPublicListingProductRows`. The latter validates identity, product context and scalar pricing/inventory policy fields while retaining safe selected specification columns; malformed rows fail closed. Numeric stock strings remain typed accurately and are normalized only in the calculation parent through the existing stock helper, leaving raw records untouched. Added the required colocated listing-facade boundary test for public merchant/ID scoping, request constraints, no parent mutation/client arrays and failure propagation. New focused result: **134 tests passed across seven files**, with Biome and whitespace checks clean. The parent task retains final semantic typecheck confirmation.

## Final projection-ingress validation

Removed the remaining generic row cast at the standard-listing facade. A generic assertion backed by the same runtime reader now narrows the original typed rows while preserving all extra selected fields, without an unchecked cast back to the caller type. Both the facade and direct price-projection entry assert the boundary before any public variant RPC, covering home, category, plain search and API inlets. Exact malformed-ID/bad-price regressions were RED (three failures) before the fix and passed afterward; typed extra-column preservation and merchant/ID forwarding remain covered. Expanded focused validation: **188 tests passed across 16 files**, Biome clean on the five changed files, whitespace check clean. No semantic typecheck or commit was run by this subtask.
