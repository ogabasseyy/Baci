// Canary URL selection for the storefront release-coherence check: the five origin HTML
// pages (home, products, smartphones, one live PDP, blog) whose release marker is verified.
const RESERVED_ROUTE_ROOTS = new Set([
  '_next',
  'about',
  'account',
  'api',
  'blog',
  'cart',
  'checkout',
  'contact',
  'faq',
  'image',
  'images',
  'imei-check',
  'media',
  'privacy',
  'product',
  'products',
  'repairs',
  'returns',
  'search',
  'shipping',
  'static',
  'terms',
  'track-order',
  'wallet',
  'wishlist',
]);

export function normalizePdpPath(value, baseUrl) {
  if (!value.startsWith('/')) throw new Error('Storefront PDP path must start with /');
  const url = new URL(value, baseUrl);
  if (url.origin !== new URL(baseUrl).origin || url.search || url.hash) {
    throw new Error('Storefront PDP path must be a same-origin path without query or hash');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2 || RESERVED_ROUTE_ROOTS.has(segments[0])) {
    throw new Error(`Storefront PDP path is not a product route: ${url.pathname}`);
  }
  return url.pathname;
}

export function discoverPdpPath(html, baseUrl) {
  for (const match of String(html).matchAll(/href=(?:"([^"]+)"|'([^']+)')/g)) {
    const href = (match[1] || match[2]).replaceAll('&amp;', '&');
    let candidate;
    try {
      candidate = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (candidate.origin !== new URL(baseUrl).origin || candidate.search || candidate.hash) continue;
    const segments = candidate.pathname.split('/').filter(Boolean);
    if (
      segments.length === 2 &&
      !RESERVED_ROUTE_ROOTS.has(segments[0]) &&
      segments[1] !== 'compare'
    ) {
      return candidate.pathname;
    }
  }
  throw new Error('Could not discover a stable PDP path from the products page');
}

export function buildCanaryUrls(baseUrl, pdpPath) {
  const origin = new URL(baseUrl).origin;
  const normalizedPdpPath = normalizePdpPath(pdpPath, origin);
  const urls = ['/', '/products', '/smartphones', normalizedPdpPath, '/blog'].map(
    (path) => new URL(path, origin).href
  );
  if (new Set(urls).size !== 5 || urls.some((url) => new URL(url).hostname.startsWith('cdn.'))) {
    throw new Error('Release coherence requires exactly five origin HTML canaries');
  }
  return urls;
}
