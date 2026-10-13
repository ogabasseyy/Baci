import { type NextRequest, NextResponse } from 'next/server';
import { isLocalhost } from '@/lib/proxy/host';
import {
  buildPostHogRelayRequestHeaders,
  buildProxyRequestHeaders,
} from '@/lib/proxy/request-headers';
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import { getRouteType } from '@/lib/proxy/routing-policy';

export const INDEXNOW_KEY_PATH = '/0751d5c882ab3d7c013ecbfe9e624d71.txt';

export const STOREFRONT_ROOT_SITEMAP_PATH = '/sitemap.xml';

export const STOREFRONT_ROOT_SITEMAP_REWRITE_PATH = '/sitemap/root.xml';

export function buildMerchantFeedPassThroughResponse({
  request,
  pathname,
  userAgent,
  hostname,
  customDomain,
  merchantSlug,
}: {
  request: NextRequest;
  pathname: string;
  userAgent: string;
  hostname: string;
  customDomain?: string;
  merchantSlug?: string | null;
}): NextResponse {
  const feedHeaders = buildProxyRequestHeaders(request);

  if (customDomain) {
    feedHeaders.set('x-custom-domain', customDomain);
    feedHeaders.set('x-merchant-domain', customDomain);
  }
  if (merchantSlug) {
    feedHeaders.set('x-merchant-slug', merchantSlug);
  }

  const response = NextResponse.next({
    request: {
      headers: feedHeaders,
    },
  });

  // Public machine-readable storefront contracts use the storefront security
  // profile: relaxed CSP is appropriate for storefront-scoped JSON/XML content.
  const routeType = getRouteType(pathname);
  const isLocal = isLocalhost(hostname);
  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    routeType,
    isLocal,
    undefined,
    request,
    hostname
  );
}

export function buildStorefrontRootSitemapRewriteResponse({
  request,
  pathname,
  userAgent,
  hostname,
  routeIdentifier,
  customDomain,
  merchantSlug,
}: {
  request: NextRequest;
  pathname: string;
  userAgent: string;
  hostname: string;
  routeIdentifier: string;
  customDomain?: string;
  merchantSlug?: string | null;
}): NextResponse {
  const sitemapUrl = request.nextUrl.clone();
  sitemapUrl.pathname = `/${routeIdentifier}${STOREFRONT_ROOT_SITEMAP_REWRITE_PATH}`;

  const sitemapHeaders = buildProxyRequestHeaders(request);
  if (customDomain) {
    sitemapHeaders.set('x-custom-domain', customDomain);
    sitemapHeaders.set('x-merchant-domain', customDomain);
  }
  if (merchantSlug) {
    sitemapHeaders.set('x-merchant-slug', merchantSlug);
  }

  const response = NextResponse.rewrite(sitemapUrl, {
    request: {
      headers: sitemapHeaders,
    },
  });

  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    'storefront',
    isLocalhost(hostname),
    undefined,
    request,
    hostname
  );
}

export function buildStorefrontFaviconRewriteResponse({
  request,
  pathname,
  userAgent,
  hostname,
  routeIdentifier,
  customDomain,
  merchantSlug,
}: {
  request: NextRequest;
  pathname: string;
  userAgent: string;
  hostname: string;
  routeIdentifier: string;
  customDomain?: string;
  merchantSlug?: string | null;
}): NextResponse {
  const faviconUrl = request.nextUrl.clone();
  faviconUrl.pathname = `/${routeIdentifier}/favicon.ico`;

  const faviconHeaders = buildProxyRequestHeaders(request);
  if (customDomain) {
    faviconHeaders.set('x-custom-domain', customDomain);
    faviconHeaders.set('x-merchant-domain', customDomain);
  }
  if (merchantSlug) {
    faviconHeaders.set('x-merchant-slug', merchantSlug);
  }

  const response = NextResponse.rewrite(faviconUrl, {
    request: {
      headers: faviconHeaders,
    },
  });

  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    'storefront',
    isLocalhost(hostname),
    undefined,
    request,
    hostname
  );
}

export function buildPostHogRelayPassThroughResponse(
  request: NextRequest,
  pathname: string,
  userAgent: string,
  hostname: string
): NextResponse {
  const requestHeaders = buildPostHogRelayRequestHeaders(request);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  return applySecurityHeaders(
    response,
    pathname,
    userAgent,
    'api',
    isLocalhost(hostname),
    undefined,
    request,
    hostname
  );
}

export function toLlmApiPath(pathname: string, slug: string): string {
  // Strip trailing /index.html.md or .md suffix to get the clean path
  let clean = pathname;
  if (clean.endsWith('/index.html.md')) {
    clean = clean.slice(0, -'/index.html.md'.length);
  } else if (clean.endsWith('.md')) {
    clean = clean.slice(0, -'.md'.length);
  }

  // Remove leading slash
  clean = clean.replace(/^\//, '');

  // Build the API path
  return clean ? `/api/llm/${slug}/${clean}` : `/api/llm/${slug}`;
}
