# Merchant-listing dimension investigation — 2026-10-25

## Result

The inspected Search Console examples have incomplete public variant attributes, not a confirmed serializer omission. Earlier product/feed fixes do **not** resolve these dimension errors. No runtime or catalog mutation was made for this investigation. No claim is made that these four URLs account for every provider-reported error.

The measurement agent read the Merchant listings report updated 2026-10-24 and supplied bounded missing-color and missing-size examples. Detailed private report metrics remain in task artifacts, outside the repository. The four corresponding public PDPs returned HTTP 200 during this follow-up; initial JSON-LD and exact normalized public variant records from their server-rendered flight data were parsed read-only. No database query or provider submission was needed.

## Exact owner-verification queue

| Public family | Variant ID | Actual public attributes | Missing fact |
| --- | --- | --- | --- |
| [Google Pixel 8a](https://ogabassey.com/smartphones/google-pixel-8a) | `1cc5a0c6-cf50-4164-92f3-c24b8c1e8dd0` | `storage=256GB` | Exact unit color |
| [Google Pixel 8a](https://ogabassey.com/smartphones/google-pixel-8a) | `5a087c55-1081-4c75-aab6-b3dc253c652e` | `storage=128GB` | Exact unit color |
| [Google Pixel 9a](https://ogabassey.com/smartphones/google-pixel-9a-12gb-128gb) | `46d97cdf-a991-4120-bcec-bd1c5b29185b` | `storage=256GB` | Exact unit color |
| [Google Pixel 9a](https://ogabassey.com/smartphones/google-pixel-9a-12gb-128gb) | `c898f683-ddc5-49db-8adf-7b9752f2370c` | `storage=128GB` | Exact unit color |
| [Dell Precision 5530](https://ogabassey.com/laptops/dell-precision-5530-workstation) | `07700d81-21dc-4ea7-84de-c56e8502ac44` | `ram=32GB; display=FHD; storage=1TB; ram_type=DDR4; processor=Intel Core i9` | Exact unit color |
| [ASUS ROG Strix G16](https://ogabassey.com/gaming-laptops/asus-rog-strix-g16-g614jv-rtx-4060) | `7b0f1c81-438a-48f9-a5c8-2bcdd681564e` | `{}` | Exact configuration, including actual size/storage/RAM, and whether this empty option is intended saleable |

These groups contain other variants with the declared dimension, so the group `variesBy` includes color or size. The missing attributes are also absent from the exact normalized public records. Case/alias mapping is therefore not an evidenced cause for these samples. The database source itself was not inspected, so this evidence establishes the public projection/catalog deficiency and does not locate the original writer or assert physical unit facts.

Parent color values are visible for the Pixel/Dell groups, but they are not verified per-unit fallback values for the incomplete selections. The family gallery cannot establish their physical colors. ASUS's empty variant must not inherit the configuration of either differently specified RTX 4070 or RTX 5070 sibling.

## Honest fallback assessment

The current [Google variant documentation](https://developers.google.com/search/docs/appearance/structured-data/product-variants) supports nested variants or separate Product nodes linked through `isVariantOf`; common group properties must describe the variants accurately, and selection links must show the appropriate item facts. The [merchant-listing documentation](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing) separately requires truthful Product/Offer data.

No documented fallback was found that both preserves these actual single-page variant relationships and cures an unknown physical dimension. Converting every selection to an unrelated standalone Product would change grouping and may introduce multiple-primary-product ambiguity; merging them into one Product/Offer list would conflate configurations. Omitting real variants or removing an actual varying dimension solely to clear a report would conceal the deficiency. None was implemented.

Status: **catalog verification remains required**. Verify the exact listed unit facts and intended saleability before any separately authorized data correction. Then re-read each public selection, validate representative output with Rich Results Test, deploy/revalidate if code or caches change, and use Search Console's validation/recrawl path. Local unit tests cannot certify GSC acceptance or clear its historical counts.

## Readiness distinction

The serializer supports known color/colour and size/storage/RAM values, and existing tests cover truthful omission when none is supplied. This is implementation capability, not data completeness. The catalog queue above remains unresolved, and the GSC invalid-item count remains an external gate. Shipping/return optional promises were not changed to silence unrelated warnings.

Evidence receipts, saved outside the repository alongside the original audit:

- `02-gsc-dimension-samples.json`: selected initial ProductGroup/variant fields from four live PDPs.
- `02-gsc-dimension-variant-attributes.json`: exact normalized public IDs/attribute maps above, parsed from those PDPs.
- Directory: `/Users/mac/.codex/visualizations/2026/10/24/01a16f51-6346-7d60-a360-6aeedf9be5b3/seo-aeo-audits-20261025/`.
