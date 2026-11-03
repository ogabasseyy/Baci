# Storefront authority-hub eligibility

Brand and model-family destination pages and live article hub links use
`apps/web/src/lib/storefront-category/authority-hub-eligibility.ts`.

## Authoritative inputs

The input is the complete public, hydrated, category-scoped brand inventory from
`getCachedBrandAuthorityInventory` (or its existing products adapter). The reader
owns merchant isolation, active publication, category membership, parent/standalone
selection, hydration and bounded pagination. Existing anonymous clients and RLS
remain responsible for public access.

The shared contract normalizes those rows with `normalizeProduct`, retains the
canonical brand's available products, and applies the maintained taxonomy's
minimum count. Family eligibility applies the family's product matcher and count
threshold to that complete available parent pool. Consumers apply display limits
only after eligibility; family pages and sibling links never count a sliced page.

An active category and a maintained taxonomy entry remain prerequisites. A family
inherits its eligible parent brand. Pages return no destination below threshold;
optional links omit that same destination. Optional link reads additionally retain
their existing timeout/error fallback so supplemental content cannot block a page.

## Candidate discovery is separate from eligibility

Live article links start with `authority-hub-candidates.ts`, which selects maintained
taxonomy entries matching the article's inferred brands. It makes no stock/count
decision. `verify-eligible-hubs-against-destination.ts` loads the destination pool
and invokes the shared contract, deriving returned counts from those products.

The smaller semantic preview pool is useful for article relevance and featured
products, but cannot establish or veto destination eligibility. In particular,
an empty, partial or stale preview must not suppress an otherwise valid hub.

The existing `skipDestinationVerification` override is reserved for callers that
explicitly supply a destination-verified fixture/override pool. Its legacy pure
resolver remains compatible with those supplied rows; live calls do not use it
as a preliminary eligibility gate. No request parameter grants this override.

Comparison and price-band destinations keep their existing dedicated contracts;
this change consolidates the brand/model-family authority paths without changing
their ranking, inference taxonomy, schema, or public stock policy.

## Regression coverage

- An empty semantic preview still links a valid hydrated destination.
- Unmanaged zero-stock products follow normal storefront availability.
- Wrong-brand, malformed and unavailable managed rows cannot inflate counts.
- Family thresholds use the complete parent inventory before display limits.
- Existing page, content-link and comparison consumer suites cover integration.
