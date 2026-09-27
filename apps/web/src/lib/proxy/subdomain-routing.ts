import { type NextRequest, NextResponse } from 'next/server';
import { getCustomDomainForSlug } from '@/lib/domain-cache-simple';
import { buildSubdomainApiResponse } from '@/lib/proxy/api-alias';
import {
  extractLocalhostSubdomain,
  extractSubdomain,
  isLocalhost,
  isVercelPreview,
  normalizeHostname,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import {
  buildMerchantFeedPassThroughResponse,
  buildStorefrontFaviconRewriteResponse,
  buildStorefrontRootSitemapRewriteResponse,
  STOREFRONT_ROOT_SITEMAP_PATH,
  toLlmApiPath,
} from '@/lib/proxy/machine-responses';
import { annotateMerchantTrace } from '@/lib/proxy/merchant-tracing';
import {
  buildProxyRequestHeaders,
  setStorefrontMetadataCacheBucketSearchParam,
} from '@/lib/proxy/request-headers';
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import { resolveRetiredSlugRedirect } from '@/lib/proxy/retired-slug';
import {
  getRouteType,
  isPublicMachineReadablePath,
  matchesMainAppRoute,
  shouldPartitionStorefrontMetadataCache,
} from '@/lib/proxy/routing-policy';
import { runStorefrontPreflight } from '@/lib/proxy/storefront-preflight';
import { buildLegacyTermsAliasRedirectResponse } from '@/lib/proxy/terms-redirects';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

export function getRequestSubdomain(hostname: string): string | null {
  return isLocalhost(hostname)
    ? extractLocalhostSubdomain(hostname)
    : extractSubdomain(hostname, ROOT_DOMAIN);
}

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

function annotateSubdomainTrace(subdomain: string, hostname: string): void {
  const normalized = normalizeHostname(hostname).replace(/^www\./, '');
  annotateMerchantTrace(
    subdomain,
    normalized !== ROOT_DOMAIN &&
      !isLocalhost(hostname) &&
      !isVercelPreview(hostname)
      ? normalized
      : ''
  );
}

/** Runs the reserved-alias and storefront subdomain branches in their former order. */
export async function runSubdomainRouting(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string,
  subdomain: string | null
): Promise<NextResponse | null> {
  if (!subdomain) return null;
  annotateSubdomainTrace(subdomain, hostname);
  if (RESERVED_SUBDOMAINS.has(subdomain) && !isLocalhost(hostname)) {
    if (pathname.startsWith('/api')) {
      const current = await getCurrentSlugForAlias(subdomain);
      if (current && current !== subdomain)
        return buildSubdomainApiResponse(
          request,
          subdomain,
          hostname,
          userAgent
        );
    } else if (matchesMainAppRoute(pathname)) {
      return NextResponse.redirect(new URL(pathname, `https://${ROOT_DOMAIN}`));
    } else {
      const redirect = await resolveRetiredSlugRedirect(
        subdomain,
        pathname,
        request.nextUrl.search,
        request.method
      );
      if (redirect) return NextResponse.redirect(redirect, 302);
    }
    return null;
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) return null;
  if (
    !isLocalhost(hostname) &&
    !pathname.startsWith('/api') &&
    !matchesMainAppRoute(pathname)
  ) {
    const redirect = await resolveRetiredSlugRedirect(
      subdomain,
      pathname,
      request.nextUrl.search,
      request.method
    );
    if (redirect) return NextResponse.redirect(redirect, 302);
  }
  if (pathname === '/favicon.ico')
    return buildStorefrontFaviconRewriteResponse({
      request,
      pathname,
      userAgent,
      hostname,
      routeIdentifier: subdomain,
      merchantSlug: subdomain,
    });
  if (matchesMainAppRoute(pathname))
    return NextResponse.redirect(new URL(pathname, `https://${ROOT_DOMAIN}`));
  if (
    !isLocalhost(hostname) &&
    !pathname.startsWith('/api') &&
    (request.method === 'GET' || request.method === 'HEAD')
  ) {
    const customDomain = await getCustomDomainForSlug(subdomain);
    const terms = buildLegacyTermsAliasRedirectResponse(
      request,
      pathname,
      customDomain ?? undefined
    );
    if (terms) return terms;
    if (customDomain) {
      return NextResponse.redirect(
        `https://${customDomain}${pathname}${request.nextUrl.search}`,
        301
      );
    }
  } else {
    const terms = buildLegacyTermsAliasRedirectResponse(request, pathname);
    if (terms) return terms;
  }
  if (pathname.startsWith('/api'))
    return buildSubdomainApiResponse(request, subdomain, hostname, userAgent);
  if (isPublicMachineReadablePath(pathname))
    return buildMerchantFeedPassThroughResponse({
      request,
      pathname,
      userAgent,
      hostname,
      merchantSlug: subdomain,
    });
  if (pathname === STOREFRONT_ROOT_SITEMAP_PATH)
    return buildStorefrontRootSitemapRewriteResponse({
      request,
      pathname,
      userAgent,
      hostname,
      routeIdentifier: subdomain,
      merchantSlug: subdomain,
    });
  if (pathname.endsWith('.md')) {
    const url = request.nextUrl.clone();
    url.pathname = toLlmApiPath(pathname, subdomain);
    const headers = buildProxyRequestHeaders(request);
    headers.set('x-merchant-slug', subdomain);
    return NextResponse.rewrite(url, { request: { headers } });
  }
  const preflight = await runStorefrontPreflight({
    request,
    pathname,
    hostname,
    userAgent,
    merchantIdentifier: subdomain,
  });
  if (preflight) return preflight;
  const url = request.nextUrl.clone();
  url.pathname = `/${subdomain}${pathname}`;
  if (
    shouldPartitionStorefrontMetadataCache(
      pathname,
      hostname,
      getRouteType(pathname)
    )
  )
    setStorefrontMetadataCacheBucketSearchParam(url, request);
  const headers = buildProxyRequestHeaders(request);
  headers.set('x-merchant-slug', subdomain);
  return decorate(
    NextResponse.rewrite(url, { request: { headers } }),
    request,
    pathname,
    hostname,
    userAgent
  );
}
