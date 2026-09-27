export type StorefrontPublicCachePolicy = {
  readonly slug: string;
  readonly customHostnames: readonly string[];
  readonly cacheableCategorySegments: readonly string[];
  /** Opt-in only after exact-product + broad hostname purge is qualified. */
  readonly durablePdpPurge?: boolean;
};

export const STOREFRONT_PUBLIC_CACHE_POLICIES = [
  {
    slug: 'ogabassey',
    // Remain at five minutes until the mutation-to-edge release gates pass.
    durablePdpPurge: false,
    customHostnames: ['ogabassey.com', 'www.ogabassey.com'],
    // These MUST mirror the live category path segments (the first URL segment
    // of every canonical PDP/listing, e.g. `/smartphones/<slug>`) AND the
    // Cloudflare dashboard cache rule that edge-caches `ogabassey.com/*`. A
    // segment missing here is served no-store by the proxy, so its PDPs never
    // reach the CDN (LCP regression); an extra segment risks caching a
    // non-category route. Regenerate after catalog changes by taking the unique
    // first path segments of every URL in
    // https://ogabassey.com/sitemap/products.xml, then sort alphabetically.
    // Verified against the live products sitemap on 2026-07-03.
    cacheableCategorySegments: [
      'accessories',
      'audio',
      'childrens-tablets',
      'desktops',
      'earbuds',
      'gaming',
      'gaming-accessories',
      'gaming-consoles',
      'gaming-laptops',
      'gift-cards',
      'laptops',
      'lg-tvs',
      'monitors',
      'nintendo-switch',
      'nintendo-switch-2',
      'playstation-4',
      'playstation-5',
      'portable-gaming',
      'printers',
      'samsung-tvs',
      'smartphones',
      'smartwatches',
      'soundbars',
      'tablets',
      'vr-headsets',
      'wearables',
      'xbox',
    ],
  },
] as const satisfies readonly StorefrontPublicCachePolicy[];

// Product/PDP documents use a 30m freshness window with a LONG
// stale-while-revalidate window. Tag/path invalidation handles mutations; the
// time window remains a bounded fallback when an invalidation is delayed.
export const STOREFRONT_CACHE = {
  productsSMaxAge: 1800,
  productsStaleWhileRevalidate: 86400,
} as const;
