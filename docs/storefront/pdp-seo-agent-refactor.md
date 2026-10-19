# Product detail refactor: SEO and agent research

Research date: 2026-10-03. Baseline: main `6e4605d21f`.

## Official guidance

- Google recommends Product structured data in the initial HTML; JavaScript-generated price/availability markup can make Shopping crawls less reliable. Preserve server JSON-LD and use the existing safe serializer. https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
- ProductGroup groups variants using hasVariant, productGroupID and supported variesBy values. Each variant needs accurate Product/Offer facts and a URL that actually selects that variant. Match the site's single-page or multi-page design; do not invent unsupported axes or manufacturer identifiers. https://developers.google.com/search/docs/appearance/structured-data/product-variants
- Next.js recommends narrow client boundaries for interactive controls. Client Components can still be prerendered: a use-client directive alone does not prove missing initial HTML. Measure rendered output and bundles before claiming performance improvement. https://nextjs.org/docs/app/getting-started/server-and-client-components
- Chrome documents WebMCP as early preview. Structured tools can improve product discovery and configuration; retain readable HTML and normal links as a fallback rather than requiring browser support. https://developer.chrome.com/blog/webmcp-epp

## Repository findings

- The large `ogabassey/pages/product-details.tsx` is a template preview with no production import found. Refactoring it would not improve the live PDP.
- The live category/product route uses server-rendered critical details and commerce, deferred client islands, request-scoped semantic sections, canonical metadata and JSON-LD. Preserve these existing boundaries.
- `generateProductSchema` already emits ProductGroup and per-variant prices, conditions, stock, images and selection URLs. Audit its consumers rather than add duplicate schema generators.
- Existing WebMCP search_catalog, get_product and get_store_policies tools are read-only and merchant scoped. The latest main includes colour-image choice work (#3606); preserve that contract.

## First focused slice

Extract the live route's product/breadcrumb structured-data assembly into one pure module, keeping specification enrichment, canonical product URL, currency, provider availability and trust policy behavior intact. Add integration coverage of public URL parity, missing category and variant offer accuracy. This is a behavior-preserving foundation, not a ranking or performance claim.

## Subsequent slices

1. Audit initial HTML and schema against visible selected variant, published catalog API, Markdown and agent responses. Cover new/used, zero/out-of-stock, unavailable combination and canonical redirects with deterministic fixtures.
2. Extract route loading/projection and canonical resolution by responsibility, retaining cache ownership and request-scoped boundaries. Work toward route orchestration under 300 lines without artificial splitting.
3. Tighten missing variant identifiers/options and public tool responses only for verified gaps. Preserve publication, tenant scope, safe columns and explicit consent for mutations.
4. Improve semantic specs, links and purchase controls where evidence shows gaps; validate desktop/mobile and PDP-to-cart navigation in the actual in-app browser.
5. Measure bundles, hero loading and page stability using the repository's storefront performance protocol before claiming improvements.

## Gates and scope

Use affected web lint/typecheck and meaningful route/schema/tool tests. Review the pushed exact SHA and account for required CI before merging. Local fixture QA, PR review, deployment readiness and live verification are separate evidence. No production orders, charges, credential/proxy edits or fabricated product claims are part of this task. Rich-result eligibility is not a guarantee of ranking or appearance. Browser WebMCP support is not universal.
