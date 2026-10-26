// URL formatting needs only public identity, not the storefront data loader.
type StoreUrlMerchant = { slug: string; custom_domain?: string };

const ROOT_DOMAIN = (
  process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com'
).toLowerCase();

function normalizeStoreHost(rawHost: string | null): string {
  return (
    (rawHost || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .split(',')[0] || ''
  );
}

function isDevelopmentHost(host: string): boolean {
  const normalizedHost = host.split(':')[0].toLowerCase();
  return normalizedHost === 'localhost' || normalizedHost === '127.0.0.1';
}

function normalizeHostname(host: string): string {
  return host.split(':')[0].toLowerCase();
}

function normalizeCustomDomain(
  customDomain: string | null | undefined
): string {
  return (customDomain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function inferProtocol(host: string, headersList: Headers): 'http' | 'https' {
  const forwardedProto = headersList
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return forwardedProto;
  }

  return isDevelopmentHost(host) ? 'http' : 'https';
}

/**
 * Build the canonical base URL for a merchant's storefront.
 * Returns origin + path prefix. Append route paths directly:
 *   `${buildStoreUrl(merchant)}/products/123`
 *
 * Dev:       http://localhost:3000/ogabassey   (path-mode, slug baked in)
 * Custom:    https://ogabassey.com             (domain-mode, no slug)
 * Subdomain: https://ogabassey.usebaci.com     (domain-mode, no slug)
 */
export function buildStoreUrl(merchant: StoreUrlMerchant): string {
  if (process.env.NODE_ENV === 'development') {
    return `http://localhost:3000/${merchant.slug}`;
  }

  if (merchant.custom_domain) {
    const normalized = merchant.custom_domain
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^\/+|\/+$/g, '');
    const hostnamePattern =
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
    if (normalized && hostnamePattern.test(normalized)) {
      return `https://${normalized}`;
    }
  }

  return `https://${merchant.slug}.${ROOT_DOMAIN}`;
}

export function buildRequestScopedStoreUrl(
  merchant: StoreUrlMerchant,
  headersList: Headers
): string {
  const configuredCustomDomain = normalizeCustomDomain(merchant.custom_domain);
  const customDomainHeader = normalizeCustomDomain(
    headersList.get('x-custom-domain')
  );

  if (configuredCustomDomain && customDomainHeader === configuredCustomDomain) {
    return `https://${configuredCustomDomain}`;
  }

  const host = normalizeStoreHost(
    headersList.get('x-forwarded-host') || headersList.get('host')
  );

  if (!host) {
    return buildStoreUrl(merchant);
  }

  const protocol = inferProtocol(host, headersList);
  if (isDevelopmentHost(host)) {
    return `${protocol}://${host}/${merchant.slug}`;
  }

  const normalizedHost = normalizeHostname(host);
  const normalizedCustomDomain = normalizeCustomDomain(merchant.custom_domain);
  const expectedSubdomainHost = `${merchant.slug}.${ROOT_DOMAIN}`.toLowerCase();

  if (
    normalizedHost === expectedSubdomainHost ||
    (normalizedCustomDomain && normalizedHost === normalizedCustomDomain)
  ) {
    return `${protocol}://${host}`;
  }

  return buildStoreUrl(merchant);
}
