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
