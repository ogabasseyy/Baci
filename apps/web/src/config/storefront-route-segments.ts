const RESERVED_STOREFRONT_SEGMENTS = new Set([
  'about',
  'account',
  'api',
  'blog',
  'cart',
  // Legacy category roots — `/category/{slug}` and `/product-category/{slug}`
  // resolve to category pages (see storefront-link-normalization.ts), so they
  // must NOT be collapsed to `/products/{slug}` when stripping a merchant slug
  // prefix on custom domains.
  'category',
  'checkout',
  'faq',
  'llms-full.txt',
  'llms.txt',
  'pages',
  'privacy-policy',
  'product-category',
  'products',
  'repair',
  'repairs',
  'robots.txt',
  'sitemap',
  'swap',
  'terms',
  'track-order',
  'wallet',
  'wishlist',
]);

// First content segments that must NEVER be edge-cached as a public document.
// = RESERVED_STOREFRONT_SEGMENTS plus the per-user/authenticated route groups
// not already reserved: (customer) my-account/delete-account/receipts,
// (commerce) order-success, (utility) member-status/imei-check/quiz/reviews.
// Keep this in sync with the (customer)/(commerce)/(utility) route groups —
// caching any of these would leak per-user content (orders, receipts, etc.).
// The canonical PDP/category shape (`/<category>/<product>`) is intentionally
// NOT in this set, so it remains cacheable.
const NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS = new Set<string>([
  ...RESERVED_STOREFRONT_SEGMENTS,
  // Singular `/product/{slug}` is a legacy redirect-only / noindex route (not in
  // RESERVED, which only has plural `products`) — keep it no-store.
  'product',
  'my-account',
  'delete-account',
  'receipts',
  'order-success',
  'member-status',
  'imei-check',
  'quiz',
  'reviews',
]);

// Every FIRST URL segment that resolves to a real storefront route under
// (storefront)/[slug]/... — verified exhaustively against that route tree
// (blog/catalog/commerce/content/customer/utility groups + the top-level
// `storefront` legacy segment). Superset of NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.
//
// Used ONLY by the retired-slug PREFIX strip on custom domains: a merchant can
// retire a slug that happens to equal a route name (e.g. a store once slugged
// "blog"), which becomes an alias. On its custom domain, custom.example/blog/post
// is a LIVE /blog route serving many URLs, so it must NOT be mistaken for a
// legacy /<oldSlug>/... link and stripped to /post. A live route always wins
// over redirects for a narrow set of ambiguous legacy links. Keep in sync with
// the (storefront)/[slug] route groups.
const STOREFRONT_ROUTE_FIRST_SEGMENTS = new Set<string>([
  ...NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS,
  'compare',
  'search',
  'contact',
  'privacy',
  'returns',
  'shipping',
  'warranty',
  'terms-and-conditions',
  'terms-of-service',
  'storefront',
]);

// Live storefront PAGE first-segments that must be excluded from the
// retired-slug PREFIX STRIP but from NOTHING ELSE.
//
// `unlock-orders` is a real (storefront)/[slug]/unlock-orders page, and it was
// the only live first segment missing from the strip's exclusion list — so on a
// custom domain a merchant whose RETIRED slug was "unlock-orders" had their own
// live page 302-stripped as if it were a legacy slug-prefixed link.
//
// It gets its own set because every existing set is too broad for it:
//   - RESERVED_STOREFRONT_SEGMENTS also drives merchant-slug validity
//     (isStorefrontHomeDocument), the metadata-cache partition and the PDP
//     hard-404 / canonical-308 helpers — a merchant or PRODUCT legitimately
//     slugged `unlock-orders` would lose its CDN policy and proxy handling.
//   - NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS additionally rejects
//     `/<category>/<product>` PDPs whose CATEGORY is slugged `unlock-orders`
//     and forces those URLs to no-store.
//   - STOREFRONT_ROUTE_FIRST_SEGMENTS also guards the retired-alias API
//     rewrites (matchAliasApiPrefixShape and the custom-domain API branch), so
//     `custom.example/unlock-orders/api/...` would stop being rewritten. The
//     live page owns the exact `/unlock-orders` path only, never an `/api`
//     subtree, so that rewrite must keep working.
//
// Like `quiz`, the page is template-gated (notFound() unless
// template_id === 'ogabassey'). The proxy cannot resolve that template before
// the strip, so it preserves the exact page path; the page checks for a matching
// retired alias and redirects non-OgaBassey stores to their home. A suffixed
// `/unlock-orders/<path>` remains eligible for the proxy's retired-alias redirect.
const RETIRED_SLUG_STRIP_LIVE_PAGE_SEGMENTS = new Set<string>([
  ...STOREFRONT_ROUTE_FIRST_SEGMENTS,
  'unlock-orders',
]);

// First URL segments that are PLATFORM/app routes reachable on a custom domain
// but are NOT (storefront)/[slug] routes — so they don't belong in
// STOREFRONT_ROUTE_FIRST_SEGMENTS (that set is kept in sync with the storefront
// route tree and would prune these). Like the storefront set, these must be
// excluded from the retired-slug PREFIX strip so a merchant whose retired slug
// is literally "auth" or "feeds" doesn't break the live route:
//   - 'auth'  -> the /auth/confirm magic-link pass-through (further down this branch)
//   - 'feeds' -> the machine-readable feed pass-through (isPublicMachineReadablePath)
// Tradeoff: an exotic genuine retired link custom.example/auth/<path> (old slug
// was "auth") no longer 301-strips and falls through to the storefront 404 —
// preserving the security-critical live /auth/confirm route is the right call.
const CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS = new Set<string>([
  'auth',
  'feeds',
]);

function shouldStripRetiredSlugPrefix(
  firstSegment: string,
  pathSegmentCount: number
): boolean {
  const livePageCollision =
    RETIRED_SLUG_STRIP_LIVE_PAGE_SEGMENTS.has(firstSegment) &&
    !(firstSegment === 'unlock-orders' && pathSegmentCount > 1);

  return (
    !livePageCollision &&
    !CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS.has(firstSegment)
  );
}

export const storefrontRouteSegments = {
  CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS,
  NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS,
  RESERVED_STOREFRONT_SEGMENTS,
  RETIRED_SLUG_STRIP_LIVE_PAGE_SEGMENTS,
  STOREFRONT_ROUTE_FIRST_SEGMENTS,
  shouldStripRetiredSlugPrefix,
};
