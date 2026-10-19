import { type NextRequest, NextResponse } from 'next/server';
import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import {
  extractLocalhostSubdomain,
  extractSubdomain,
  isLocalhost,
  isPlatformHost,
  isValidCustomDomain,
  isValidSubdomain,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import { normalizeCacheSafeStorefrontPathname } from '@/lib/proxy/path-normalization';
import {
  applySecurityHeaders,
  applyStorefrontDocumentCacheHeaders,
} from '@/lib/proxy/response-headers';
import {
  DRAFT_MODE_COOKIE_NAMES,
  PLATFORM_ROOT_ROUTE_SEGMENTS,
} from '@/lib/proxy/routing-constants';
import {
  getRouteType,
  getStorefrontContentSegments,
} from '@/lib/proxy/routing-policy';
import { getStorefrontDocumentHomePath } from '@/lib/storefront-document-home-path';
import type { StorefrontDocumentHomePathRules } from '@/lib/storefront-document-home-path-rules';
import { isStorefrontDocumentNavigation } from '@/lib/storefront-document-navigation';
import { hasUnsafeStorefrontPdpSegments } from '@/lib/storefront-unsafe-pdp-segments';

export const HARD_STATUS_HOME_PATH_PATTERN =
  /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

export const PDP_HTML_CACHE_CONTROL =
  'no-cache, no-store, max-age=0, must-revalidate';

export const STOREFRONT_DOCUMENT_HOME_PATH_RULES: StorefrontDocumentHomePathRules =
  {
    isSlugPrefixedHost: isPlatformHost,
    extractMerchantSubdomain: (hostname) =>
      extractSubdomain(hostname, ROOT_DOMAIN),
    extractLocalhostSubdomain,
    isValidCustomDomain,
    isValidMerchantSlug: isValidSubdomain,
    reservedSubdomains: RESERVED_SUBDOMAINS,
    platformRootRouteSegments: PLATFORM_ROOT_ROUTE_SEGMENTS,
  };

export function buildHardStatusStorefrontResponse(
  status: 404 | 410,
  request: NextRequest,
  pathname: string,
  userAgent: string,
  hostname: string | undefined,
  homePath = '/'
): NextResponse {
  const title = status === 410 ? 'Page gone' : 'Page not found';
  const safeHomePath = HARD_STATUS_HOME_PATH_PATTERN.test(homePath)
    ? homePath
    : '/';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="robots" content="noindex, follow"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head><body style="font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center"><main><h1>${title}</h1><p>The page you’re looking for isn’t here. <a href="${safeHomePath}">Go to the homepage</a>.</p></main></body></html>`;

  // HEAD must not carry a body (RFC 9110 §9.3.2); the noindex signal travels in
  // the X-Robots-Tag header below so a HEAD crawl still sees it.
  const body = request.method === 'HEAD' ? null : html;
  const response = new NextResponse(body, { status });
  response.headers.set('Content-Type', 'text/html; charset=utf-8');
  applySecurityHeaders(
    response,
    pathname,
    userAgent,
    'storefront',
    isLocalhost(hostname ?? ''),
    undefined,
    request,
    hostname
  );
  // Header-level noindex (belt-and-suspenders with the body <meta>): crawlers
  // that only HEAD, or don't parse the body, still get the directive.
  response.headers.set('X-Robots-Tag', 'noindex, follow');
  // Clear every split CDN header LAST: the cache section runs inside
  // applySecurityHeaders and would otherwise mark a product-shaped path
  // cacheable, edge-caching a false 404/410 at the highest-precedence layer.
  applyStorefrontDocumentCacheHeaders(response, 'non-cacheable', null);
  response.headers.set('Cache-Control', PDP_HTML_CACHE_CONTROL);
  return response;
}

export function resolveUnsafeStorefrontPdpPath(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  userAgent: string
): NextResponse | null {
  if (!isStorefrontDocumentNavigation(request.method, request.headers)) {
    return null;
  }

  // Imported smart punctuation has a safe, one-hop ASCII canonicalization.
  // Judge that recoverable form so the later 308 remains available, while
  // keeping the raw path for any terminal hard-404 response.
  const safetyPathname =
    normalizeCacheSafeStorefrontPathname(new URL(request.url).pathname) ??
    pathname;
  const routeType = getRouteType(safetyPathname);
  if (routeType !== 'storefront') {
    return null;
  }

  const homePath = getStorefrontDocumentHomePath(
    safetyPathname,
    hostname,
    STOREFRONT_DOCUMENT_HOME_PATH_RULES
  );
  if (!homePath) {
    return null;
  }

  const contentSegments = getStorefrontContentSegments(
    safetyPathname,
    hostname,
    routeType
  );
  if (
    !hasUnsafeStorefrontPdpSegments(
      contentSegments,
      storefrontRouteSegments.NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS
    )
  ) {
    return null;
  }

  return buildHardStatusStorefrontResponse(
    404,
    request,
    pathname,
    userAgent,
    hostname,
    homePath
  );
}

export function isEligibleForHardStatusPreflight(
  request: NextRequest,
  pathname: string
): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }
  if (
    request.headers.get('rsc') === '1' ||
    request.headers.has('next-router-prefetch') ||
    request.headers.has('next-router-state-tree')
  ) {
    return false;
  }
  const fetchDest = request.headers.get('sec-fetch-dest')?.toLowerCase();
  if (fetchDest && fetchDest !== 'document') {
    return false;
  }
  if (
    DRAFT_MODE_COOKIE_NAMES.some((cookieName) =>
      request.cookies.has(cookieName)
    )
  ) {
    return false;
  }
  return getRouteType(pathname) === 'storefront';
}
