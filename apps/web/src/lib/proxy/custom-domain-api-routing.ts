import { type NextRequest, NextResponse } from 'next/server';
import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import { MERCHANT_SLUG_QUERY_PARAMS } from '@/lib/proxy/api-alias';
import type { CustomDomainContext } from '@/lib/proxy/custom-domain-context';
import { isLocalhost, isValidSubdomain } from '@/lib/proxy/host';
import { buildProxyRequestHeaders } from '@/lib/proxy/request-headers';
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import { getRouteType } from '@/lib/proxy/routing-policy';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

function buildCustomDomainApiResponse(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string,
  context: CustomDomainContext,
  url = request.nextUrl
): NextResponse {
  const headers = buildProxyRequestHeaders(request);
  headers.set('x-custom-domain', context.domain);
  headers.set('x-merchant-domain', context.domain);
  const response =
    url === request.nextUrl
      ? NextResponse.next({ request: { headers } })
      : NextResponse.rewrite(url, { request: { headers } });
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

/** Handles safe internal API rewrites before general custom-domain storefront routing. */
export async function runCustomDomainApiRouting(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string,
  context: CustomDomainContext
): Promise<NextResponse | null> {
  const { domainMerchantSlug, domainPathSegments } = context;
  const firstSegment = domainPathSegments[0];
  const apiPath = domainPathSegments[1]?.toLowerCase() === 'api';

  if (
    domainMerchantSlug &&
    firstSegment?.toLowerCase() === domainMerchantSlug.toLowerCase() &&
    apiPath
  ) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(firstSegment.length + 1) || '/';
    return buildCustomDomainApiResponse(
      request,
      url.pathname,
      hostname,
      userAgent,
      context,
      url
    );
  }

  if (domainMerchantSlug && firstSegment && apiPath) {
    const aliasPrefix = firstSegment.toLowerCase();
    if (
      aliasPrefix !== domainMerchantSlug.toLowerCase() &&
      isValidSubdomain(aliasPrefix) &&
      !storefrontRouteSegments.STOREFRONT_ROUTE_FIRST_SEGMENTS.has(
        aliasPrefix
      ) &&
      !storefrontRouteSegments.CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS.has(
        aliasPrefix
      )
    ) {
      const currentSlug = await getCurrentSlugForAlias(aliasPrefix);
      if (
        currentSlug &&
        currentSlug.toLowerCase() === domainMerchantSlug.toLowerCase()
      ) {
        const url = request.nextUrl.clone();
        url.pathname = pathname.slice(firstSegment.length + 1) || '/';
        for (const param of MERCHANT_SLUG_QUERY_PARAMS) {
          if (url.searchParams.get(param)?.toLowerCase() === aliasPrefix) {
            url.searchParams.set(param, currentSlug);
          }
        }
        return buildCustomDomainApiResponse(
          request,
          url.pathname,
          hostname,
          userAgent,
          context,
          url
        );
      }
    }
  }

  if (!pathname.startsWith('/api')) {
    return null;
  }
  let url: typeof request.nextUrl | undefined;
  if (domainMerchantSlug) {
    const current = domainMerchantSlug.toLowerCase();
    const candidate = request.nextUrl.clone();
    for (const param of MERCHANT_SLUG_QUERY_PARAMS) {
      const value = candidate.searchParams.get(param)?.toLowerCase();
      if (value && value !== current) {
        const aliasCurrent = await getCurrentSlugForAlias(value);
        if (aliasCurrent && aliasCurrent.toLowerCase() === current) {
          candidate.searchParams.set(param, domainMerchantSlug);
        }
      }
    }
    if (candidate.search !== request.nextUrl.search) url = candidate;
  }
  return buildCustomDomainApiResponse(
    request,
    pathname,
    hostname,
    userAgent,
    context,
    url
  );
}
