# Six-audit SEO/AEO remediation

Source audits: read-only production observations on 25 October 2026. This change covers commercial templates, product variants/feeds, comparisons, budget guides, merchant trust/policies and measurement. It does not assert ranking uplift or provider approval.

## Owner decisions

- Returns: technical defects undisclosed at purchase; 14 days from delivery. The latest 14-day answer supersedes the earlier seven-day selection. Return fees and method remain unconfirmed, so no free-return or in-store-return promise is emitted.
- Warranty: one-year Ogabassey coverage for issues not caused by the user; excludes power surges, screen damage and liquid damage. Ogabassey Assurance protection plans are separate and subject to their own terms.
- Restricted phones: Wi-Fi-only units remain explicitly selectable and disclosed, but do not set standard cellular-phone recommendation/default prices. Normal Wi-Fi tablets remain eligible.

The versioned approved Ogabassey contract is `apps/web/src/lib/storefront-trust/ogabassey-approved-policy.ts`. It is keyed to resolved merchant identity, not template or request hostname, and supplies policy pages, feeds and structured data. Other tenants retain their own configured policies. Future changes to this approved contract must update its shared source and fixtures together; stale CMS/template text must not become an independent commercial promise.

## Implemented areas

1. **Templates:** honest product-pick destinations/names and page-scoped counts where real brand hubs do not exist; real authority hubs preserved; eligible laptop budget guide linked. [Evidence and mobile profiling](commercial-template-corrections.md).
2. **Product data:** safe public variant hydration, exact options/condition/image/link serialization, restricted-device disclosure and correct default price selection across PDP, home/category cards, plain search and public product listings; consistent stock prose; complete optional shipping/return schema only when facts are known. No fabricated global identifiers, grading or physical inventory. [Standard listing-price coverage and limits](standard-phone-price-projections.md).
3. **Comparisons:** compatible pairing and duplicate-entity gates, normalized facts, honest missing/conflicting values, calculated price parity/limitations, visible current offer context and direct PDP links, relevant guides and manufacturer references. [Catalog facts](comparison-catalog-corrections.md).
4. **Budget guides:** exact eligible selectable offers, factual feature-phone exclusions, tracked availability rules, strict price ceiling, explicit condition/configuration and source methodology. Unsupported editorial "best" claims replaced with transparent price-ordered comparison; no invented testing/reviewer/date.
5. **Trust:** approved policies across stale saved FAQ, SSR schema and template copy; specific directions and consistent customer-support versus legal channels; unsupported statistics, credentials and service promises removed; merchant metadata and warranty navigation.
6. **Measurement:** sanitized external-origin/referring-domain and allowlisted campaign attribution, document-scoped SPA consistency, deduplication, consent/opt-out gates and consent-update capture. [Measurement contract](../../seo/measurement-and-crawler-evidence-runbook.md). Fresh private GSC receipts are retained with the task artifacts.

## Guarded catalog correction tooling

`apps/web/tools/seo/correct-audit-product-specs.mjs` transforms the six saved public catalog records in `tools/seo/fixtures/audit-20261025-specs.json`. Regression tests cover the exact incorrect MacBook/JBL/AirPods facts, non-mutation and idempotence. Manufacturer references are retained. Unknown battery capacities and ambiguous integer weights are withheld; exact per-earbud/case weights are labelled explicitly.

`build-audit-spec-correction-sql.mjs` only produces maintenance SQL; it has no credentials or database client. Every update is constrained to the resolved Ogabassey merchant and exact product identity, checks the captured specification hash/current key fields, and rolls the entire batch back on any concurrent change. It changes no price, condition, inventory or schema. The captured public before-image is preserved for review/recovery. Generation/test success is not evidence of a production write. The subsequent [maintenance receipt](catalog-maintenance-receipt.md) records the committed batch, verified database output and six live public responses.

M2 Max's listed 512GB configuration still requires physical/model confirmation. Manufacturer family facts do not establish the exact unit or included accessories. HP duplicate offers are excluded from model comparisons pending reconciliation, with no destructive inventory merge.

## External and data verification remaining

- [Six exact GSC sample variants](gsc-merchant-dimension-catalog-verification.md) lack actual public color/size data. Do not infer those values from stock gallery images or hide real variants to silence errors. Provider-reported invalid items are not claimed resolved by code.
- New imagery needs selected-variant pixel verification; Open Box grading, device limitations, stock sentinels, identifiers and warranty fulfillment need genuine merchant evidence.
- Provider-owned feed processing/destination approval, broad verified crawler/CDN access and payment reconciliation remain separate checks. A private GSC receipt retained with the task artifacts closes specific earlier access gaps; it is not Merchant Center acceptance.
- Post-release attribution ingestion and channel/session reconciliation remain required. Consent-aware collection deliberately changes event volumes; do not compare raw counts as growth without adjusting the measurement contract.
- Custom-throttled mobile profiling did not prove a serialization bottleneck. Valid ProductGroup/variant offers are preserved; no field CWV pass is asserted.

## Release boundaries

Local checks, CodeRabbit findings, commit/PR status, CI, merge, production deployment and provider recrawl are separate outcomes. This document does not certify that the branch has shipped. The approved VPS prebuilt production workflow remains the deployment route.
