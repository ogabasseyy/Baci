/**
 * Layered edge-caching headers for Google Merchant feed responses.
 * - `Vercel-CDN-Cache-Control`: consumed by Vercel's Edge Network (1h fresh, 24h SWR)
 * - `CDN-Cache-Control`: forwarded to downstream CDNs (Cloudflare); uses `max-age`
 *   (never `s-maxage`) so `stale-while-revalidate` and `stale-if-error` remain active
 * - `Cache-Control`: browser/client directive (5m fresh, 24h SWR)
 */
export const GOOGLE_MERCHANT_FEED_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
  'CDN-Cache-Control':
    'public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400',
  'Vercel-CDN-Cache-Control':
    'public, max-age=3600, stale-while-revalidate=86400',
} as const;

export function buildGoogleMerchantFeedResponseHeaders(
  merchantId?: string
): Record<string, string> {
  const cacheTags = merchantId
    ? `google-merchant-feed,merchant-feed-${merchantId}`
    : 'google-merchant-feed';

  return {
    'Content-Type': 'application/xml; charset=utf-8',
    ...GOOGLE_MERCHANT_FEED_CACHE_HEADERS,
    'Vercel-Cache-Tag': cacheTags,
  };
}

/**
 * Build the canonical base URL for a merchant's storefront.
 * Used by the feed route to generate deterministic product links.
 */
export function buildMerchantBaseUrl(merchant: {
  slug: string | null;
  custom_domain?: string | null;
}): string {
  if (merchant.custom_domain) {
    const normalizedDomain = merchant.custom_domain
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^\/+|\/+$/g, '');

    const hostnamePattern =
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
    if (normalizedDomain && hostnamePattern.test(normalizedDomain)) {
      return `https://${normalizedDomain}`;
    }
  }

  const slug = merchant.slug?.trim();
  if (!slug) {
    throw new Error('Merchant slug is required to build storefront URL');
  }

  return `https://${slug}.baci.app`;
}
