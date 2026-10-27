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

## PDP optional-read budget and surface audit (2026-10-27)

The PDP adapter uses the existing inventory reader's bounded mode, not a new
stock/category loader. It accepts a complete pool of at most 100 brand candidates
across the merchant, using a 101-row sentinel and exact count to reject oversized
or server-truncated results before hydration. This deliberately omits optional
links for large brands, even when their destination remains eligible. It does not
infer eligibility from a sample or inflate counts from a lower bound.

A single 1-second operation deadline covers the active-category read, product
query and existing public serialized-stock hydration. The same signal is applied
at the anonymous client's transport so nested variant/count requests also abort;
checks between phases prevent late work. Errors escape the cached reader and are
caught outside it, preventing transient failures from becoming cached empty pools.
Budget arguments form a separate cache key from the complete destination scan.
Product and category cache tags invalidate the bounded result.

The adapter delegates normalization and brand eligibility to
`authorityHubEligibility`; provisional link builders now delegate brand and family
threshold decisions to that same contract. The existing category membership,
parent/standalone SQL scope, hydration and stock filter remain in the inventory
reader. Bounded reads select only eligibility fields and category evidence.

Audit boundary and remaining findings:

- Both generic and OgaBassey PDP semantic callers use this adapter; no critical
  commerce or above-fold rendering path gains a new query.
- Primary brand/family destinations still use the existing complete scan (up to
  20 pages of 100 rows). Their counts are not replaced by the optional PDP budget.
- Article verification uses `loadBrandAuthorityInventorySafely` with the same
  complete-pool ceiling as PDP enrichment and a 3-second shared deadline per
  brand. Active-category validation runs inside that operation; the verifier no
  longer starts a separate uncancellable category read. Category, product and
  hydration aborts omit both brand and dependent family links. Parallel brands
  retain their own deadlines; primary destination reads remain unchanged.
- Serialized hydration retains its existing policy/variant/count implementation;
  this patch bounds its input product IDs and elapsed time, not the number of
  variants a product may have. There is no new inventory policy or RLS exception.

Regression coverage includes oversized/truncated pools, exact ceiling and empty
results, category joins and legacy membership, serialized stock after hydration,
managed/unmanaged availability, numeric-string prices, brand/family thresholds,
and aborts during category, product and hydration phases. Public-client tests
verify the deadline reaches actual fetch signals and blocks subsequent requests.
