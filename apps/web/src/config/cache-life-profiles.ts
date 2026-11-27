export const CACHE_LIFE_PROFILES = {
  merchant: { stale: 300, revalidate: 300, expire: 3600 },
  products: { stale: 300, revalidate: 1800, expire: 86400 },
  'storefront-page': { stale: 300, revalidate: 1800, expire: 86400 },
  categories: { stale: 300, revalidate: 3600, expire: 86400 },
  blog: { stale: 300, revalidate: 3600, expire: 86400 },
} as const;
