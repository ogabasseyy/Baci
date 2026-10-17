# Ogabassey search Release 2: research and implementation recommendation

Date: 2 October 2026. Status: researched proposal; runtime and runner changes have not been made.

## Release 1 and Android delivery check

- Search journey PR [#3547](https://github.com/ogabasseyy/Baci/pull/3547) merged on 30 September at SHA `0e65eba26d21d19284ed1fd586c206a5b953b7f1`. Analytics follow-up PR [#3569](https://github.com/ogabasseyy/Baci/pull/3569) separates submissions from result renders.
- Web pagination was observed at `/search?q=iphone&page=2`, with results 21–40, an editable query, and pagination controls. This establishes the rendered results route, not every interaction.
- The latest [Android storefront release run](https://github.com/ogabasseyy/Baci/actions/runs/36748956583) used the Release 1 merge SHA and failed. No later storefront workflow run exists in the checked history. The separate Android admin workflow builds a different app and cannot establish storefront delivery. No GitHub releases were listed.
- Failure: Hermes host configuration cannot link a simple C program: `/usr/bin/ld: cannot find Scrt1.o` and `crti.o`; CMake also reports no C++ compiler. This points to an incomplete Linux host compiler/libc development toolchain. Android SDK/NDK setup alone does not supply that host toolchain.
- Next repair: inspect the self-hosted runner's OS/package state, provision its required C/C++ compiler and libc development packages, and add an early compile/link preflight. On a Debian/Ubuntu host, `build-essential` and `libc6-dev` are the likely packages; verify the host distribution and installed state before choosing commands. Re-run the storefront AAB build and inspect any subsequent failure separately.
- A build does not automatically prove publication. The current workflow makes Play upload opt-in (`publish_to_play`, default false), with internal as the default track. After a successful build, verify the artifact's source SHA/version code, explicitly authorized upload, Play track, and availability in an installed build.
- EAS has a production Android build profile, so manual builds remain a possible alternative path. `eas build:list --platform android --limit 5 --json --non-interactive` could not run because Expo authentication was unavailable. Manual EAS releases and Play Console customer availability remain unverified. No build, upload, or runner mutation was triggered by this research.

## What Jumia shows in the supplied screenshots

These observations concern the supplied 2 October screenshots. Live access to Jumia's catalog through the web research tool failed; the mobile panels were not opened or tested.

| Surface | Observed layout | Useful pattern for Ogabassey |
| --- | --- | --- |
| Mobile web | Preserved query, breadcrumbs, Express/Brand/Price chips, related searches, two-column cards, floating Sort by/Filter control | Compact refinement controls reachable during scrolling |
| Mobile app | Back/search/cart header, Express/Brand/Price chips, two-column cards, floating Sort/Filters control | Similar shopping workflow with native navigation |
| Desktop | Category/filter sidebar, price range with numeric inputs and Apply, brand search/checkboxes, result count, related searches, four-column cards, sort at top right | Use available space to expose filters alongside results |

Desktop sort options shown: Popularity, Newest Arrivals, Price Low to High, Price High to Low, Product Rating. Mobile screenshots show sort/filter triggers, not their panel contents, apply/cancel behavior, or persistence. Those behaviors below are our recommendations.

Jumia's sponsored placement, Express badge, and Official Store badge describe its marketplace. Ogabassey should use only labels backed by its own catalog and fulfillment rules. Variable electronics products should open a variant chooser or product page when required before adding to cart.

## Research basis

- [Baymard: applied filters overview](https://baymard.com/research-articles/how-to-design-applied-filters): show the actual selected values with a removal action, so shoppers can understand and broaden the result set without reopening filters.
- [Baymard: filter UI](https://baymard.com/blog/ecommerce-filter-ui): visible desktop filters, compact mobile panels, precise price inputs, preserved back-navigation state, and multiple selections within a filter group support refinement. Use OR within brands and AND between filter groups.
- [Baymard: product lists and filtering](https://baymard.com/research-articles/current-state-product-list-and-filtering): treat listing, filtering, and sorting as one browsing journey. A control that changes only the loaded page does not refine the full search.

## Recommended Release 2 experience

### Desktop web

Retain Ogabassey's visual design. Place query/result count above the grid, sort at the upper right, and Price, Brand, Condition, and Category in a left sidebar. Use the existing responsive grid rather than forcing four columns at every desktop width. Display removable applied-filter chips and Clear filters above products.

Category/brand/condition changes apply immediately on desktop. Price inputs apply together through an explicit Apply action. A slider is optional; numeric naira inputs are required and usable with keyboard alone. Desktop price fields are local drafts: other committed refinements leave them unsubmitted, and the current price chips continue to show committed bounds. Clear filters, a new committed query, or history navigation discards those drafts; changing brands alone does not submit them. Label the price Apply action clearly and show inline validation next to its fields.

Use the storefront's existing `lg` breakpoint for the sidebar layout; smaller widths use the mobile controls. Start with a 240–280px sidebar and a flexible grid, checking actual card width rather than inheriting four columns after subtracting the sidebar. Sidebar groups follow Category, Price, Brand, Condition, then Rating when supported. Keep Brand searchable. Use normal page scrolling; do not introduce a small independently scrolling sidebar. Desktop sort is a labelled single-choice dropdown anchored to its trigger, with the selected value visible after closing.

### Mobile web and customer app

Keep a two-column grid at normal phone widths and adapt at narrow widths or large text settings. Keep the query editable. Offer Price, Brand, and Condition quick chips; each opens the same filter panel focused on that group. Category belongs in the full panel.

Provide a persistent Sort/Filters control, inspired by the screenshots. Its bottom offset is the existing navigation height, any additional safe-area inset not already included there, and a small visual gap. Reserve content space for that offset plus the control's measured height; do not add the safe-area inset twice. It must not cover the last card, cart action, retry, or load-more control. Hide it when the keyboard is editing the query or a panel is open. Verify collision with storefront chat controls and mobile browser chrome.

Use an accessible mobile filter panel with draft selections, Clear, Cancel, and Apply filters. Closing by backdrop, back gesture, or Android Back cancels drafts. Apply commits all groups once and returns to the first results. Preserve committed selections across product navigation. Quick chips and the full panel share the same state. Use existing shared native modal/sheet primitives where possible.

Do not put a predicted number on Apply until an independent server count query exists. Show the truthful committed result count after Apply. Sort uses a separate single-choice panel and applies immediately.

### Positioning and panel contract

These are proposed Ogabassey design values, not measurements or tested behavior from Jumia.

| Element | Placement and details |
| --- | --- |
| Mobile quick filters | Below the query/result summary and above applied chips; horizontally scrollable Price, Brand, Condition buttons, with an active state and selected summary. They open the full panel at the requested section. |
| Mobile Sort/Filters | One centered bottom control with separately labelled buttons, minimum 44px touch targets, and a Filters badge counting selected values (a price range counts as one). Current sort is visible near the result summary; do not rely only on an icon. Keep controls available for zero matches and request errors. |
| Full mobile filter panel | Full-height modal within the safe viewport, fixed title/Close header, scrollable groups, and fixed Clear/Apply footer. Order: Category, Price, Brand, Condition, Rating when available. This gives brand search and numeric price editing enough room. |
| Mobile sort panel | Content-height bottom sheet with five labelled radio choices and Close; cap it at the visible safe viewport and allow its choices to scroll with large text or landscape. Choosing a different sort commits and closes. Dismissing keeps the current sort. Desktop uses the equivalent dropdown. |
| Applied filters | Above the product grid, after quick filters on mobile. Each removable chip names its value; price uses a readable naira range. Clear filters remains reachable without horizontal scrolling. |

Size the footer and bottom control from their actual rendered height. The filter panel must remain usable with the keyboard open and large text; its footer stays within the visible viewport. If short landscape space makes a floating bottom control impractical, use a sticky Sort/Filters row above results. Verify mobile web browser viewport changes rather than assuming native safe-area behavior is sufficient.

Only one panel opens at a time. Opening filters copies committed values into drafts. Clear inside the panel clears drafts only; Apply commits them, Cancel/Close discards them. Selecting the already committed values is a no-op: do not refetch or reset scroll. Outside the panel, removing a chip or Clear filters commits immediately. Changing the viewport between sidebar and mobile layout discards open drafts and retains committed filters.

On web, lock background scrolling, trap modal focus, support Escape, and restore focus to the opener. Native panels support Android Back, screen reader modal isolation, and focus restoration. Announce the resulting count after a committed request completes; while refreshing, show Updating results rather than presenting an old total as the count for new criteria.

### Common behavior

- Sort: Relevance by default, Price low to high, Price high to low, Newest, Most viewed. Current `popular` orders by `view_count`, so do not label it Best selling. No rating sort is supported by the existing contract; retain a minimum-rating filter only where trustworthy rating data is available.
- Brand: multiple selections let an undecided shopper compare Apple and Samsung in one result set. This requires an additive backend contract; existing adapters accept one string. Multi-brand support is a Release 2 requirement; implement the contract before enabling the UI. Existing released apps continue using their single-brand contract.
- Condition: use established catalog values and normalization; verify equivalent meaning on web and app before exposing the quick chip. Do not invent condition families from labels alone.
- Price: optional bounds, nonnegative finite values, minimum no greater than maximum. Clearing bounds means unrestricted, not a hidden fixed maximum. Display card prices consistent with the matching condition/variant; explicitly test parent versus variant price differences.
- Applied chips: removable selected values, with Clear filters retaining the query and chosen sort. Provide a separate Reset all action if needed. Sorting/refining does not record another search submission.
- Empty filtered results: retain controls and selections; offer Clear filters while keeping the query. Search/request errors have Retry, never a false zero-results message.
- Do not derive facets or totals from the current 20 products. A count badge for each facet option requires a backend aggregation contract; omit it until implemented.
- Defer storage/RAM/processor facets and related-query expansion until normalized catalog attributes or a grounded suggestion source exist. Keep the existing corrected-query recovery where available.

For Release 2, Category and Condition stay single-choice; Brand is multi-choice with OR semantics. Filter groups combine with AND. Condition multi-select can follow after family/variant semantics are consistent. A different normalized query clears all filters and resets sort to Relevance when it commits. On web this happens on Submit. Preserve the app's existing 250ms typing commit as well as explicit Submit/recent-search commits, but route all of them through the same atomic query transition. Before that commit, input text is only a draft and the result summary identifies the committed query. An explicit same-query submit preserves refinements. A shared/deep-linked URL with explicit valid refinements initializes exactly those values; browser Back restores its historical state. Route restoration must not be mistaken for a fresh query submission that clears URL refinements.

While native input is waiting for a different valid query to commit, prevent a filter/sort action from being applied to the previous result set. Settle the pending query first through the shared transition, then open refinement controls. Invalid/too-short input retains its validation/idle state and cannot open a panel against hidden results. Cancel pending typing timers when applying a route or navigating away; product back navigation must not re-commit a query or erase restored refinements. Preserve the existing explicit-submission analytics distinction: a typing commit is not a new explicit submission event.

Maintain selected values even when their current facet count is zero. Loading or failed facet requests must not silently remove selections or broaden the search. Facet errors show Retry while existing selections remain clearable. Category and brand labels come from authorized catalog data, with stable IDs/values behind display names.

Keep brand display labels separate from their stored filter values. The current RPC compares `p.brand` exactly: lowercasing, trimming, or otherwise rewriting a brand value can turn a valid choice into zero matches. Facets must return the exact stored value (or a deliberately introduced canonical key mapped consistently server-side); formatting a display label must not change that value. Deduplicate and sort exact values for query keys, and apply the same mapping in both clients and the facet query.

Brand search filters labels inside the panel only; it neither changes the product query nor clears selected brands hidden by that search. Show selected brands separately and offer a clear distinction between No brands match this text and No matching products. Facets while editing a mobile draft reflect the last committed criteria in this release; label them as available for the current results and do not disable choices based on draft combinations. Apply resolves the combination server-side and may legitimately return zero products. This avoids implying live draft preview that has not been implemented.

## Source findings and implementation workstreams

Findings checked against fetched `origin/main` on 2 October:

1. `apps/web/src/lib/storefront-search.ts` accepts one `brand`, category, condition, price bounds, minimum rating, stock, and five sort modes. `apps/mobile-storefront/hooks/product-utils.types.ts` supports the same four nondefault sorts, with undefined mapped to relevance in `product-pages.ts`. `app/search.tsx` currently does not pass `sortBy`.
2. `hooks/product-brands.ts` requests pages of 500 and stops when returned IDs are fewer than 500. The current `search_products_v2` migration clamps results to 100. Under that source contract, discovery stops after the first 100 matches. Fix this with a fixture where a brand exists only after result 100; do not merely increase the requested limit. Confirm the deployed RPC contract before rollout.
3. `app/search.tsx` clears a selected brand when absent from `brandNames`. Preserve valid selections while facets are loading or erroring; an unavailable facet must remain removable and should not silently broaden a search.
4. Web condition-family filtering may hydrate all ranked candidates. Measure broad-query behavior and align condition semantics before enabling it. The RPC price filters compare product-row `price`; UI grouping/hydration must not create misleading displayed prices or totals.
5. Native `app/search.tsx` auto-commits input after 250ms, but only route-query application currently resets filters. Reuse the existing timer/validation and move reset decisions into a single committed-criteria transition. Do not add a second debounce controller.
6. The inspected web adapter hydrates ranked product IDs one-to-one; its condition-family branch filters hydrated products without collapsing IDs. The native page adapter likewise orders/transforms ranked product IDs, and `product-transform.ts` exposes both row `price` and variant prices. No new family grouping is justified by these paths. Start from product-ID result identity and verify downstream grid/card behavior before changing that unit.

### A. Contracts and correctness

- Define a shared normalized filter/sort contract used by adapters in both apps. Keep routing, rendering, and platform interactions app-specific.
- Correct brand discovery pagination. Use the RPC's supported page size and verify continuation beyond the first 100 matches. Add a merchant-scoped facet aggregation for query/category/condition/price/rating to avoid downloading every matching product. Available-brand calculation excludes the selected brand group while honoring other committed filters; preserve selected zero-match values. Aggregate over the same searchable/public product population and relevance eligibility as results, with the same counting unit; bound/cache requests by merchant and normalized criteria. Per-option counts remain outside the first UI scope.
- Add multi-brand matching with OR semantics through an append-only migration and backward-compatible RPC/adapters. Preserve existing single-brand callers; inspect every caller, grants, RLS, and public visibility projection. Do not combine separate brand searches client-side: paging, totals, and global sorting would be incorrect.
- Prefer a separately named search RPC for the array-based contract if changing `search_products_v2` would introduce PostgREST overload ambiguity. Keep the old contract usable by installed app versions; define and test adapter precedence instead of sending both single-brand and multi-brand inputs.
- Preserve the existing final product-ID sort tie-breaker and truthful totals after grouping; verify pages have no duplicates/skips for a stable fixture. Assess condition-family latency and variant-aware prices with production-like fixtures. No arbitrary client cap may silently truncate results.
- Preserve product-ID identity across grid cards, totals, facets, paging, and sort; verify downstream cards do not merge those IDs. Any confirmed family grouping requires an explicit contract decision before implementation. Do not change grouping as an incidental UI refactor. For a grouped card, price filtering/sorting must use its matching purchasable variant price, and the card must show that same price/condition. Carry matching selection to the product page; never imply the cheaper excluded variant satisfies the filter. If the current contract cannot provide this, resolve it in workstream A before enabling that refinement.
- Condition and price predicates must match the same offer/variant. A New variant priced at ₦500,000 and Used variant at ₦200,000 must not satisfy New plus maximum ₦250,000. For a product with several matching variants, choose the lowest matching purchasable price as its single effective price for both ascending and descending price sorts; descending orders those effective prices in reverse. Use that price on the card and preserve the matching variant/offer selection on entry to the product page. Products with unknown prices cannot satisfy price bounds and sort last in either price direction. Verify stock/availability semantics against the current storefront contract rather than imposing a new stock filter.
- Stage database support before deploying new callers. A missing new RPC returns a recoverable availability error; never silently fall back to single-brand or unfiltered results. Keep old RPCs available through app rollout and verify their parity fixtures. Migration rollback uses an additive corrective migration; previous released clients remain supported.

### B. Web controls and state

- Add a validated query-parameter schema for query, brands, category, condition, price, sort, and page. Use repeated `brand` parameters for multiple brands; normalize/deduplicate/sort values for stable cache keys. Other scalar parameters remain single-valued. Preserve custom-domain path prefixes. Bound input size and reject malformed values; unknown sort values normalize to Relevance. Blank price fields become undefined; zero is a valid explicit bound.
- For malformed scalar params, invalid category IDs, nonfinite/negative prices, or reversed bounds in a direct link, render an Invalid filters state with Edit filters and Clear filters; do not silently drop constraints and fetch broader results. Keep the valid query editable. Repeated brand values are allowed and deduplicated; a well-formed unavailable brand stays selected and may return zero matches. Do not use the current facet response as URL validation authority. Normalize unknown sort to Relevance consistently in the displayed selection and request.
- Filter or sort commits reset page to one; apply the query-change policy above atomically. Invalid price ranges show an inline correction message instead of sending an invalid request. Use committed URL navigation for Back history; drafts create no history entry. Preserve filters/sort in pagination and out-of-range recovery links, query editing, and retries.
- Query editing preserves the current committed refinements until a different query is submitted; that submission follows the reset policy above. Removing the applied price chip also clears the desktop price drafts so a later Apply cannot accidentally restore the removed range. Removing another group's chip leaves price drafts unsubmitted.
- Use URL state for reload/share/back; preserve the query-only canonical and noindex behavior. Old query-only links continue working. Build desktop sidebar and mobile panel from common web filter fields.

### C. Native controls and state

- Add `sortBy` to the committed search options/query key. Move refinement orchestration into a focused hook rather than expanding the already large screen.
- Keep draft panel state separate from committed hook options. Query, filter, or sort commits clear old pages and restart fetching. Ignore late responses for older criteria; never mix result sets.
- Canonicalize brand array order in query keys. Initialize deep-link refinements through the validated contract; a mounted route receiving new parameters follows the same atomic transition rules. Preserve existing query-scoped next-page locks and explicit next-page retry behavior in `useProducts`; do not replace them with a second pagination controller.
- Sync committed native route parameters as one criteria object. Update refinement parameters without pushing another search screen, and adapt `useSearchRouteQuerySync` so same-query refinement updates do not run the old query-only reset callback. Keep input draft and filter drafts out of route params. Deep-link initialization and product-back restoration must distinguish route-owned criteria from fresh search intent.
- Prevent route write/read feedback: compare canonical criteria before writing params, mark local writes as already applied, and do not save search history or issue an analytics submission during their restoration. Preserve parameterless screen entry and invalid-`q` handling. Product navigation carries matching offer/variant IDs through existing supported route contracts; use validated selection parameters if extension is necessary and recheck availability/pricing on the product page. A route parameter never authorizes price or availability.
- Preserve list position on product back navigation and reset it on explicit refinement. Reuse platform primitives, support Android Back, safe areas, keyboard, focus return, and screen reader selected-state announcements.

### D. Verification and rollout

- Regression tests: brand beyond match 100; selected facet during loading/error; combined brands across page boundaries; price/condition variants; stable global sort; invalid/repeated URL params; custom domains; draft cancel/apply; stale-response isolation; empty/error recovery; filter/sort changes do not increment search-submission analytics.
- Add cases for explicit maximum price zero, blank bounds, same-query submission, changed-query reset, same-filter no-op, old installed-app RPC compatibility, facet/result publication parity, filter-aware pagination recovery, and resized layouts with open drafts. Verify Apply fires once, panel Clear remains uncommitted until Apply, and no panel or background control remains focusable behind a modal.
- Cover delayed typing commits and explicit submits with the same reset fixture; pending timer plus route restoration; desktop unsubmitted price drafts plus brand change; same-offer condition/price matching; multiple-variant effective price order in both directions; and new-RPC unavailability without incorrect fallback. Assert counts and facets use distinct product IDs when multiple variants match.
- Test brand values with case differences and surrounding whitespace as stored, formatted labels with unchanged filter keys, and removing a price chip while different price bounds are still drafted. An exact-value filter must behave the same through a quick chip, the full panel, a direct link, and native route restoration.
- Interaction QA: desktop, mobile web, Android, and iOS. Check panel dismissal, keyboard, large text, bottom-control collisions, and returning from a product with query/filters/sort/position intact. Use repository emulator commands when native QA begins.
- Follow `docs/agent-guidance/validation.md`; shared runtime/RPC changes require consumer and monorepo checks. Run the required CodeRabbit review before committing code.
- Repair Android delivery independently of feature UI. Release 2 is complete only after web interaction verification and app delivery/installed-build verification; a merged PR or successful AAB is an intermediate state.

## Scope decision

Recommend a dedicated Release 2 PR sequence: contracts/facet correctness first, web controls second, app controls third. Keep ranking-engine changes and new merchandising signals separate. This is a moderate feature across three surfaces, not a small visual patch. The original missing browse journey was Release 1; this release helps shoppers compare the resulting choices.

The first UI scope requires Category, Price, Brand, Condition, and the five existing sort modes. Do not add a slider, predictive Apply count, per-option facet counts, storage/RAM controls, rating sort, or a new comparison page as prerequisites. Preserve the existing native minimum-rating filter and show its chip when active; adding it to web depends on verifying real catalog coverage. Android runner repair is a separate delivery task and does not block preparing or locally validating the filter/sort changes.

### Acceptance checklist

| Journey | Required outcome |
| --- | --- |
| Broad search on desktop | Sidebar and sort fit alongside readable cards at the existing desktop breakpoint; narrower widths switch to mobile controls. |
| Refine on mobile | Price/Brand/Condition chips open the appropriate section; Apply commits once; Close, Back, or Cancel changes nothing; both Sort and Filters remain reachable after scrolling. |
| Compare brands | Select two brands; each qualifying product ID occurs once; totals and global sorting remain correct beyond page one. |
| Edit price and condition | Both predicates match one offer/variant; displayed effective price and product-page selection agree; zero/blank/reversed bounds follow the stated rules. |
| Recover and return | Zero matches keeps removable selections; request errors show Retry; product Back restores criteria and position; a changed query resets refinements atomically. |
| Screen and release compatibility | Large text/keyboard/browser chrome leave panel actions and last-card actions reachable; old app clients retain their RPC; new clients show a recoverable error if their contract is unavailable. |

For backend performance verification, compare current and proposed implementations on the same supported query/filter/page fixtures under equivalent warm and cold conditions, with request counts and query plans. Measure new multi-brand and facet paths separately, since the current implementation has no equivalent. Keep unrefined queries as an additional baseline, not the sole comparison for refined latency. Record measured regressions and resolve repeated full-catalog hydration or per-brand request fan-out before rollout. This is a required implementation check, not a performance result already obtained by this document.

## Review outcome, 2 October

The review tightened panel geometry, group order, Clear/Cancel/Apply semantics, viewport transitions, query reset policy, price-zero handling, old-app compatibility, and facet/result price consistency. The positioning proposal is ready for implementation planning. Jumia's mobile panel internals remain unverified; supplied screenshots establish trigger placement only. Backend result-unit and matching-variant pricing verification are explicit prerequisites for implementation, not completed findings.

Second review: confirmed the adapters start from product-ID results and clarified the native typing-commit/reset mismatch, desktop price drafts, same-variant condition/price matching, effective-price sorting, native route synchronization, and database-before-client sequencing. Matching-variant pricing still needs runtime contract implementation/verification; this review inspected source, not the deployed RPC.

Third review: corrected bottom spacing to include navigation without double-counting safe area; bounded sort-panel height; specified brand-panel search and committed-facet behavior; defined invalid-filter link recovery and native route feedback prevention; and added a bounded UI scope and acceptance checklist. No further design contradiction was identified in this pass. Source/deployed-contract parity, matching-variant behavior, latency, and installed-build QA remain implementation verification tasks; Jumia mobile panel internals remain unverified competitor evidence.

Fourth review: specified exact brand-value preservation against the RPC's equality comparison, removal of pending price drafts when clearing a price chip, and like-for-like performance comparisons. The research document is the authoritative Release 2 behavior specification; the earlier journey document summarizes its scope. No additional UI feature was added in this pass.
