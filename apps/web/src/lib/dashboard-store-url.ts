export type DashboardStoreUrlMerchant = {
  slug?: string | null;
  custom_domain?: string | null;
};

/**
 * Builds the "Visit Store" link for the merchant dashboard.
 *
 * Unlike the canonical `buildStoreUrl` (used for absolute server-side URLs),
 * development returns a relative path so the value is identical during SSR
 * and the first client render (no `window` read, no hydration mismatch) and
 * works on any dev port, `127.0.0.1`, or LAN host. Relative paths also pass
 * `StoreLink`'s allowlist, which only accepts same-origin or trusted URLs.
 */
export function buildDashboardStoreUrl(
  merchant: DashboardStoreUrlMerchant | null | undefined
): string {
  if (!merchant?.slug) return '#';

  if (process.env.NODE_ENV === 'development') {
    return `/${merchant.slug}`;
  }

  if (merchant.custom_domain) {
    return `https://${merchant.custom_domain}`;
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
  return `https://${merchant.slug}.${rootDomain}`;
}
