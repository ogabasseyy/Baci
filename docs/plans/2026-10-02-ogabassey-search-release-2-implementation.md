# Ogabassey Search Release 2 — implementation record

Implementation branch: `codex/ogabassey-search-refinements`, based on `origin/main`.
Worktree: `/Users/mac/.codex/worktrees/ogabassey-search-refinements/Baci-app`.
Specification: [reviewed Release 2 research](2026-10-02-ogabassey-search-release-2-research.md).

## Implemented locally

- Shared exact-brand, category, condition, price, rating, and sort criteria; malformed filters remain visible errors. Blank prices are unrestricted; zero remains a real bound.
- Additive published-storefront results and brand-facet RPCs. Existing `search_products_v2` remains unchanged. A bounded public projection exposes purchasable option prices and matching identifiers without protected inventory/cost columns or new public table grants.
- Conditions and prices match one option. Results sort by the lowest matching purchasable price, including descending order; matching selection travels to the product page. Unrefined sold-out products remain visible with an unavailable-price label.
- Desktop sidebar, immediate category/brand/condition controls, explicit price Apply, and top-right sort. Mobile web/app quick controls, persistent bottom Sort/Filters, full-height draft filter panel, and bounded sort panel.
- Applied filter removal, Clear preserving query/sort, retryable filter errors, exact multi-brand OR, and sorted pagination. Native rating is retained.
- Web URL restoration and native query resets, route-feedback guards, invalid-route fetch pause, and navigation debounce cancellation. Filter actions do not create search-history submissions. Bottom content clearance follows measured toolbar geometry.

## Local verification

- Anonymous and authenticated disposable SQL fixture checks: matching-option price/condition, publication, zero bounds, sold-out visibility, legacy stock drift, serialized public availability, global sort/page offsets, multi-brand OR, and 130 brand facets. Neither test role has protected variant/offer SELECT access.
- The fixture is a minimal contract database, not a full migration-history replay or a production-schema assertion.
- Browser fixture used actual web control components with test products: desktop sidebar/sort, 390×844 mobile panel, combined Apply, and sort preserving filters. At the last card, button bottom was 735px and toolbar top 784px. This is control/layout evidence, not end-to-end storefront API evidence.
- Fresh branch review and follow-up verified the implementation. Valid findings were fixed: history drafts, typo recovery, stock drift, native timer cancellation, measured spacing, and invalid-route pauses.
- Full repository lint and typecheck passed (10 tasks); existing lint warnings remain. Web typecheck passed again after final test/registry additions.
- Full shared suite passed (189 files, 1,282 tests); native storefront full suite passed (1,224 suites, 7,165 tests). Mobile-admin and other package suites passed.
- The full web run reported 6,413 passing files and 10 failing files. Search history restoration was corrected during that run; subsequent focused checks passed. Migration-registry failures were fixed by registering the additive migration as pending with its exact hash, preserving all historical migration bytes. Missing colocated UI tests were added.
- Final migration/history and refinement rerun: 10 files / 61 tests passed; one coverage-authority check requested a direct desktop-draft hook test, which was added. The final hook and coverage-authority rerun passed (2 files, 14 tests).
- Three full-web checks remain blocked by repository authority contracts: Cloudflare evidence requires a clean tooling worktree, and storefront edge inventory/snapshot checks bind source bytes to the prior approved commit. The modified search source differs from that approved snapshot. These contracts were not weakened or reapproved by this implementation. The complete monorepo test command is therefore not green.
- Scoped search behavior, SQL contract, and rendered control checks are separate from those remaining repository release gates.

## Local query timing

On the same disposable 134-product fixture, using the existing v2 function and the new contract under `anon`, four EXPLAIN ANALYZE runs per path produced these warm medians:

| Path | Existing v2 | New refined contract |
| --- | ---: | ---: |
| Unrefined 130-result query | 5.004ms | 12.495ms |
| Apple with maximum price | 4.469ms | 5.827ms |
| Two brands, second page | No equivalent | 5.880ms |
| Brand facets | No equivalent | 11.702ms |

The new price projection adds SQL work; it avoids application full-catalog hydration and per-brand request fan-out. Results use one RPC plus one bounded page hydration; facets use one brand RPC. These small local fixtures do not establish production latency or cold-cache performance. Production-like indexed catalog/variant fixtures and equivalent cold/warm request measurements remain rollout gates.

## Release gates

1. Apply the additive database migration before enabling new callers; verify actual deployed grants/schema and public prices. Old clients continue to use their existing RPC.
2. Complete installed iOS/Android keyboard, accessibility, Back/scroll, large-text, and safe-area QA, plus the actual storefront request journey.
3. Repair/verify Android delivery separately. The prior missing runner C/C++ toolchain failure is not modified here.
4. Merge, deploy web, and deliver app only within separately authorized release scope. Local code/tests do not prove customer delivery.

## Review disposition

CodeRabbit completed review of all staged runtime additions and changes. Its valid blank-brand and unfiltered condition-metadata findings were addressed; reversed-range UI coverage and explicit public-role SQL assertions were added. Recommendations to discard matching price/selection entirely when no price/condition filter is active were not applied: that would make unfiltered global price sorting disagree with displayed price and product selection. Original condition metadata is preserved without price/condition constraints. Native condition metadata was already preserved. Parallelizing facets with result loading is a deferred latency optimization; category and brand reads within the facet adapter already run together.

## Metro testing correction

The first device bundle rejected the search screen import of `useIsFocused` from `@react-navigation/native` under Expo Router SDK 57. The screen now imports the supported export directly from `expo-router`; tests mock that same public API. The old import failed the adjusted route tests before the fix; afterward all four search route suites passed (18 tests). Metro subsequently bundled iOS successfully and emitted root/home mounted logs. This confirms bundle/startup recovery, not completion of the search API/database rollout.

## Device feedback: quick-filter labels

Native quick controls now read Price, Brand, Condition without the redundant filters suffix. Web already used those concise labels. Regression checks passed on both surfaces (native 4 tests, web 5 tests). The public API probe confirmed both new search RPCs return PGRST202 / HTTP 404 on the configured database, explaining result/facet failures until migration rollout. The post-Metro native typecheck found six errors in unrelated EliteSlide/FashionSlide/StandardSlide test props; no search type errors were reported.

## Authorized database repair

After the user requested the fix, the additive migration was applied to the configured Baci project `aivqthbxdshhltbwipbr`. Supabase recorded version `20261002090046`; the new, uncommitted migration filename and hash-registry references were aligned with that actual version. Existing historical migrations and the old v2 RPC were not changed. Public anon API verification returned 40 iPhone results, 14 Apple/Used results between NGN 200000 and 500000 with ascending prices, descending-price results, and one brand facet, all HTTP 200. Requests were approximately 195–546ms in this small live probe, not a comprehensive performance benchmark. Migration gate 1 is now applied for this project; installed-device result/card selection and full production performance QA remain pending. Security advisors flagged the intentionally public bounded SECURITY DEFINER price projection; its published merchant/product scope and restricted price-only return shape were reviewed.


## Search rendering follow-up (2026-10-02)

- Native refined listings now render from the ranked search response and base product rows without awaiting variant-detail hydration. Matching option IDs, condition, and price remain from the search RPC. Search-card purchase actions still open product details for authoritative option selection. Cards use the base product gallery until details load; images remain independent of text rendering.
- Web starts filter-option loading alongside the product request. A filter failure remains separate from a results failure. This reduces sequential waiting; it does not stream results ahead of a slow filter request.
- Regression verification: native adapter and product transform (8 tests), web search route suite (22 files, 63 tests), changed-file Biome checks and web typecheck (including tools/workers) pass. Native typecheck remains blocked by six existing ctaLink type errors in EliteSlide, FashionSlide and StandardSlide test fixtures. No measured latency guarantee or device visual verification is claimed.

### Proposed generative search experience (design discussion, not implemented)

Keep a stable results surface and animate one focused search input above the keyboard using the existing keyboard-controller primitive. Preserve the header footprint and avoid replacing the focused input during the animation. Keep typing responsive and prevent stale responses from replacing newer results. Render product text and prices as soon as catalog data arrives with fixed image placeholders.

Use generative assistance to interpret requests such as “used iPhone under ₦500k” into visible, editable filters. Prices, stock and option IDs must come from the catalog. Keep conventional search available. Desktop retains its header search; mobile web needs separate keyboard/viewport verification before adopting the native positioning.

A shortened buying flow should confirm the exact storage, colour, condition and price before handing off to existing checkout. A selector for a known item is preferable to adding a generic product-preview layer for electronics. Payment, shipping and final review remain explicit. This interaction and generative assistance need a concrete prototype and approval before implementation.

References: [KeyboardStickyView](https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-sticky-view), [Baymard electronics quick-view research](https://baymard.com/research-articles/ecommerce-quick-views).
