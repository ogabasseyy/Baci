import { type NextRequest, NextResponse } from 'next/server';
import { getSlugForCustomDomain } from '@/lib/domain-cache-simple';
import {
  runCustomDomainAliasRouting,
  runCustomDomainCurrentSlugCanonicalization,
} from '@/lib/proxy/custom-domain-alias-routing';
import { runCustomDomainApiRouting } from '@/lib/proxy/custom-domain-api-routing';
import type { CustomDomainContext } from '@/lib/proxy/custom-domain-context';
import { isLocalhost } from '@/lib/proxy/host';
import {
  buildMerchantFeedPassThroughResponse,
  buildStorefrontFaviconRewriteResponse,
  buildStorefrontRootSitemapRewriteResponse,
  INDEXNOW_KEY_PATH,
  STOREFRONT_ROOT_SITEMAP_PATH,
  toLlmApiPath,
} from '@/lib/proxy/machine-responses';
import {
  buildProxyRequestHeaders,
  setStorefrontMetadataCacheBucketSearchParam,
} from '@/lib/proxy/request-headers';
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import {
  getRouteType,
  isPublicMachineReadablePath,
  shouldPartitionStorefrontMetadataCache,
} from '@/lib/proxy/routing-policy';
import { runStorefrontPreflight } from '@/lib/proxy/storefront-preflight';
import { buildLegacyTermsAliasRedirectResponse } from '@/lib/proxy/terms-redirects';

function decorate(
  response: NextResponse,
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string
): NextResponse {
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

function customHeaders(
  request: NextRequest,
  context: CustomDomainContext
): Headers {
  const headers = buildProxyRequestHeaders(request);
  headers.set('x-custom-domain', context.domain);
  headers.set('x-merchant-domain', context.domain);
  return headers;
}

/** Owns every validated custom-domain request, preserving the former branch order. */
export async function runCustomDomainRouting(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string,
  context: CustomDomainContext
): Promise<NextResponse> {
  const {
    domain,
    domainMerchantSlug,
    normalizedRequestHost,
    requestHostHadWww,
  } = context;
  const aliasResponse = await runCustomDomainAliasRouting(
    request,
    pathname,
    context
  );
  if (aliasResponse) return aliasResponse;
  if (pathname === '/favicon.ico')
    return buildStorefrontFaviconRewriteResponse({
      request,
      pathname,
      userAgent,
      hostname,
      routeIdentifier: domainMerchantSlug ?? domain,
      customDomain: domain,
      merchantSlug: domainMerchantSlug,
    });
  if (pathname === INDEXNOW_KEY_PATH && domainMerchantSlug) {
    const headers = customHeaders(request, context);
    headers.set('x-merchant-slug', domainMerchantSlug);
    return NextResponse.next({ request: { headers } });
  }
  if (pathname === STOREFRONT_ROOT_SITEMAP_PATH)
    return buildStorefrontRootSitemapRewriteResponse({
      request,
      pathname,
      userAgent,
      hostname,
      routeIdentifier: domainMerchantSlug ?? domain,
      customDomain: domain,
      merchantSlug: domainMerchantSlug,
    });
  if (isPublicMachineReadablePath(pathname))
    return buildMerchantFeedPassThroughResponse({
      request,
      pathname,
      userAgent,
      hostname,
      customDomain: domain,
      merchantSlug: domainMerchantSlug,
    });
  const terms = buildLegacyTermsAliasRedirectResponse(request, pathname);
  if (terms) return terms;
  const currentSlugResponse = runCustomDomainCurrentSlugCanonicalization(
    request,
    pathname,
    context
  );
  if (currentSlugResponse) return currentSlugResponse;
  const apiResponse = await runCustomDomainApiRouting(
    request,
    pathname,
    hostname,
    userAgent,
    context
  );
  if (apiResponse) return apiResponse;
  if (pathname === '/auth/confirm' || pathname.startsWith('/auth/confirm/')) {
    const confirmedSlug =
      domainMerchantSlug ??
      (requestHostHadWww
        ? await getSlugForCustomDomain(normalizedRequestHost)
        : null);
    if (confirmedSlug)
      return decorate(
        NextResponse.next({
          request: { headers: customHeaders(request, context) },
        }),
        request,
        pathname,
        hostname,
        userAgent
      );
  }
  if (pathname === `/${domain}` || pathname.startsWith(`/${domain}/`))
    return decorate(
      NextResponse.next({
        request: { headers: customHeaders(request, context) },
      }),
      request,
      pathname,
      hostname,
      userAgent
    );
  if (pathname.startsWith('/sitemap/') || pathname === '/blog/sitemap.xml') {
    const url = request.nextUrl.clone();
    url.pathname = `/${domainMerchantSlug ?? domain}${pathname}`;
    const headers = customHeaders(request, context);
    if (domainMerchantSlug) headers.set('x-merchant-slug', domainMerchantSlug);
    return decorate(
      NextResponse.rewrite(url, { request: { headers } }),
      request,
      pathname,
      hostname,
      userAgent
    );
  }
  if (pathname.endsWith('.md') && domainMerchantSlug) {
    const url = request.nextUrl.clone();
    url.pathname = toLlmApiPath(pathname, domainMerchantSlug);
    return NextResponse.rewrite(url, {
      request: { headers: customHeaders(request, context) },
    });
  }
  const preflight = await runStorefrontPreflight({
    request,
    pathname,
    hostname,
    userAgent,
    merchantIdentifier: domainMerchantSlug ?? domain,
  });
  if (preflight) return preflight;
  const url = request.nextUrl.clone();
  url.pathname = `/${domain}${pathname}`;
  if (
    shouldPartitionStorefrontMetadataCache(
      pathname,
      hostname,
      getRouteType(pathname)
    )
  )
    setStorefrontMetadataCacheBucketSearchParam(url, request);
  return decorate(
    NextResponse.rewrite(url, {
      request: { headers: customHeaders(request, context) },
    }),
    request,
    pathname,
    hostname,
    userAgent
  );
}
