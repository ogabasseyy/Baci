import { type NextRequest, NextResponse } from 'next/server';
import { getCustomDomainForSlug } from '@/lib/domain-cache-simple';
import { MERCHANT_SLUG_QUERY_PARAMS } from '@/lib/proxy/api-alias';
import {
  isLocalhost,
  isRootDomain,
  isValidSubdomain,
  isVercelPreview,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import { buildStorefrontRootSitemapRewriteResponse } from '@/lib/proxy/machine-responses';
import { buildProxyRequestHeaders } from '@/lib/proxy/request-headers';
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import { resolveRetiredSlugRedirect } from '@/lib/proxy/retired-slug';
import {
  PLATFORM_ROOT_ROUTE_SEGMENTS,
  ROOT_DOMAIN_ONLY_MAIN_APP_ROUTES,
} from '@/lib/proxy/routing-constants';
import { getRouteType, matchesMainAppRoute } from '@/lib/proxy/routing-policy';
import { runStorefrontPreflight } from '@/lib/proxy/storefront-preflight';
import { normalizeStorefrontTermsAliasPath } from '@/lib/proxy/terms-redirects';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

function isRootOrPreviewStorefrontHost(hostname: string): boolean {
  return (
    !isLocalhost(hostname) &&
    (isRootDomain(hostname, ROOT_DOMAIN) || isVercelPreview(hostname))
  );
}

function isRootOnlyMainAppRoute(pathname: string): boolean {
  return (
    ROOT_DOMAIN_ONLY_MAIN_APP_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`)
    ) || matchesMainAppRoute(pathname)
  );
}

function buildRetiredAliasApiResponse(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string,
  slug: string,
  currentSlug: string
): NextResponse {
  const url = request.nextUrl.clone();
  const strippedPathname = pathname.slice(`/${slug}`.length) || '/';
  url.pathname = strippedPathname;
  const retiredSlug = slug.toLowerCase();
  for (const param of MERCHANT_SLUG_QUERY_PARAMS) {
    if (url.searchParams.get(param)?.toLowerCase() === retiredSlug) {
      url.searchParams.set(param, currentSlug);
    }
  }
  return applySecurityHeaders(
    NextResponse.rewrite(url, {
      request: { headers: buildProxyRequestHeaders(request) },
    }),
    strippedPathname,
    userAgent,
    getRouteType(strippedPathname),
    isLocalhost(hostname),
    undefined,
    request,
    hostname
  );
}

async function runRootSlugRedirect(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string,
  slug: string
): Promise<NextResponse | null> {
  const isReserved = RESERVED_SUBDOMAINS.has(slug);
  if (
    !isValidSubdomain(slug) ||
    (isReserved && PLATFORM_ROOT_ROUTE_SEGMENTS.has(slug.toLowerCase()))
  ) {
    return null;
  }

  if (isReserved) {
    if (pathname.split('/').filter(Boolean)[1]?.toLowerCase() === 'api') {
      const currentSlug = await getCurrentSlugForAlias(slug);
      return currentSlug && currentSlug !== slug
        ? buildRetiredAliasApiResponse(
            request,
            pathname,
            hostname,
            userAgent,
            slug,
            currentSlug
          )
        : null;
    }
    const stripped = pathname.replace(`/${slug}`, '') || '/';
    const redirect = await resolveRetiredSlugRedirect(
      slug,
      normalizeStorefrontTermsAliasPath(stripped),
      request.nextUrl.search,
      request.method
    );
    return redirect ? NextResponse.redirect(redirect, 302) : null;
  }

  if (!PLATFORM_ROOT_ROUTE_SEGMENTS.has(slug.toLowerCase())) {
    if (pathname.split('/').filter(Boolean)[1]?.toLowerCase() === 'api') {
      const currentSlug = await getCurrentSlugForAlias(slug);
      if (currentSlug && currentSlug !== slug) {
        return buildRetiredAliasApiResponse(
          request,
          pathname,
          hostname,
          userAgent,
          slug,
          currentSlug
        );
      }
    } else {
      const stripped = pathname.replace(`/${slug}`, '') || '/';
      const redirect = await resolveRetiredSlugRedirect(
        slug,
        normalizeStorefrontTermsAliasPath(stripped),
        request.nextUrl.search,
        request.method
      );
      if (redirect) return NextResponse.redirect(redirect, 302);
    }
  }

  const customDomain = await getCustomDomainForSlug(slug);
  if (!customDomain) return null;
  const stripped = pathname.replace(`/${slug}`, '') || '/';
  return NextResponse.redirect(
    `https://${customDomain}${normalizeStorefrontTermsAliasPath(stripped)}${request.nextUrl.search}`,
    301
  );
}

/** Runs root/preview slug aliases, sitemap routing, then document preflight. */
export async function runSlugRoutingStage(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string
): Promise<NextResponse | null> {
  if (!isRootOrPreviewStorefrontHost(hostname)) return null;

  const segments = pathname.split('/').filter(Boolean);
  const slug = segments[0];
  if (slug && !isRootOnlyMainAppRoute(pathname)) {
    const redirect = await runRootSlugRedirect(
      request,
      pathname,
      hostname,
      userAgent,
      slug
    );
    if (redirect) return redirect;
  }

  if (
    segments.length === 2 &&
    segments[1]?.toLowerCase() === 'sitemap.xml' &&
    isValidSubdomain(segments[0]) &&
    !RESERVED_SUBDOMAINS.has(segments[0])
  ) {
    return buildStorefrontRootSitemapRewriteResponse({
      request,
      pathname,
      userAgent,
      hostname,
      routeIdentifier: segments[0],
      merchantSlug: segments[0],
    });
  }

  if (
    !slug ||
    isRootOnlyMainAppRoute(pathname) ||
    PLATFORM_ROOT_ROUTE_SEGMENTS.has(slug.toLowerCase()) ||
    !isValidSubdomain(slug) ||
    RESERVED_SUBDOMAINS.has(slug)
  ) {
    return null;
  }
  return runStorefrontPreflight({
    request,
    pathname,
    hostname,
    userAgent,
    merchantIdentifier: slug,
    homePathPrefix: `/${slug}`,
  });
}
