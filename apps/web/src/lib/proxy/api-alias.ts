import { type NextRequest, NextResponse } from 'next/server';
import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import {
  extractSubdomain,
  isLocalhost,
  isValidSubdomain,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import { buildProxyRequestHeaders } from '@/lib/proxy/request-headers';
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import { getRouteType } from '@/lib/proxy/routing-policy';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

export const ANALYTICS_CONVERSION_API_PATH = '/api/analytics/conversion';

export const LEGACY_ANALYTICS_CONVERSION_PATH = '/analytics/conversion';

export const KLUMP_WEBHOOK_API_PATH = '/api/payments/klump/webhook';

export const LEGACY_KLUMP_WOOCOMMERCE_WEBHOOK_PATH =
  '/wc-api/klp_wc_payment_webhook';

export const MERCHANT_SLUG_QUERY_PARAMS = [
  'merchantSlug',
  'merchant_slug',
  'merchant',
] as const;

export function isLegacyKlumpWooCommerceWebhookPath(pathname: string): boolean {
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;

  return (
    normalizedPathname.toLowerCase() === LEGACY_KLUMP_WOOCOMMERCE_WEBHOOK_PATH
  );
}

export function isLegacyAnalyticsConversionPath(pathname: string): boolean {
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;

  return normalizedPathname.toLowerCase() === LEGACY_ANALYTICS_CONVERSION_PATH;
}

export function matchAliasApiPrefixShape(
  pathname: string
): { apiPathname: string; prefix: string } | null {
  const [first, second] = pathname.split('/').filter(Boolean);
  if (!first || second?.toLowerCase() !== 'api') {
    return null;
  }
  const prefix = first.toLowerCase();
  if (
    !isValidSubdomain(prefix) ||
    storefrontRouteSegments.STOREFRONT_ROUTE_FIRST_SEGMENTS.has(prefix) ||
    storefrontRouteSegments.CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS.has(prefix)
  ) {
    return null;
  }
  return { apiPathname: pathname.slice(first.length + 1) || '/', prefix };
}

export async function buildSubdomainApiResponse(
  request: NextRequest,
  subdomain: string,
  hostname: string,
  userAgent: string
): Promise<NextResponse> {
  const requestHeaders = buildProxyRequestHeaders(request);
  requestHeaders.set('x-merchant-slug', subdomain);

  let rewrittenApiUrl: URL | null = null;
  if (!isLocalhost(hostname)) {
    const hostAliasCurrentSlug = await getCurrentSlugForAlias(subdomain);
    const currentSlug = hostAliasCurrentSlug || subdomain;
    const currentSlugLower = currentSlug.toLowerCase();
    const retiredHostSlug = subdomain.toLowerCase();
    const url = request.nextUrl.clone();

    for (const param of MERCHANT_SLUG_QUERY_PARAMS) {
      const value = url.searchParams.get(param)?.toLowerCase();
      if (!value || value === currentSlugLower) {
        continue;
      }

      const aliasCurrentSlug =
        hostAliasCurrentSlug && value === retiredHostSlug
          ? hostAliasCurrentSlug
          : await getCurrentSlugForAlias(value);

      if (aliasCurrentSlug?.toLowerCase() === currentSlugLower) {
        url.searchParams.set(param, currentSlug);
      }
    }

    if (url.search !== request.nextUrl.search) {
      rewrittenApiUrl = url;
    }
  }

  const response = rewrittenApiUrl
    ? NextResponse.rewrite(rewrittenApiUrl, {
        request: { headers: requestHeaders },
      })
    : NextResponse.next({ request: { headers: requestHeaders } });

  const { pathname } = request.nextUrl;
  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    getRouteType(pathname),
    isLocalhost(hostname),
    undefined,
    request,
    hostname
  );
}

export function isAliasApiShapedOnRewritableHost(
  hostname: string | undefined,
  shape: { apiPathname: string; prefix: string } | null
): boolean {
  if (!shape) {
    return false;
  }
  const subdomain = hostname ? extractSubdomain(hostname, ROOT_DOMAIN) : null;
  const isOnMerchantSubdomain =
    subdomain !== null && !RESERVED_SUBDOMAINS.has(subdomain);
  return !isOnMerchantSubdomain;
}
