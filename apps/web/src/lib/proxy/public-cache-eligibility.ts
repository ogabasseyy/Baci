import type { NextRequest } from 'next/server';
import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import { isValidSubdomain, RESERVED_SUBDOMAINS } from '@/lib/proxy/host';
import {
  CACHEABLE_PUBLIC_STOREFRONT_CATEGORY_SEGMENTS_BY_SLUG,
  getStorefrontPublicCachePolicy,
} from '@/lib/proxy/public-cache-policy';
import {
  CACHEABLE_PUBLIC_STOREFRONT_FIRST_SEGMENTS,
  PLATFORM_ROOT_ROUTE_SEGMENTS,
} from '@/lib/proxy/routing-constants';
import {
  getStorefrontContentSegments,
  isNonHtmlStorefrontDocumentPath,
  isSlugPrefixedStorefrontRequest,
  isStorefrontProductPagePath,
} from '@/lib/proxy/routing-policy';
import { isStorefrontDocumentNavigation } from '@/lib/storefront-document-navigation';

export const NON_CACHEABLE_STOREFRONT_HTML_CACHE_CONTROL =
  'private, no-store, max-age=0, must-revalidate';

/** Only full-document GET/HEAD requests may receive public HTML cache headers. */
export function isCacheablePublicStorefrontDocumentRequest(
  request: NextRequest | undefined
): boolean {
  return (
    request !== undefined &&
    request.nextUrl.search.length === 0 &&
    isStorefrontDocumentNavigation(request.method, request.headers)
  );
}

export function isStorefrontHomeDocument(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  if (routeType !== 'storefront') {
    return false;
  }

  const pathSegments = pathname.split('/').filter(Boolean);
  if (!isSlugPrefixedStorefrontRequest(hostname)) {
    return pathSegments.length === 0;
  }

  const slugSegment = pathSegments[0]?.toLowerCase();
  return (
    pathSegments.length === 1 &&
    slugSegment !== undefined &&
    isValidSubdomain(slugSegment) &&
    !RESERVED_SUBDOMAINS.has(slugSegment) &&
    !storefrontRouteSegments.RESERVED_STOREFRONT_SEGMENTS.has(slugSegment) &&
    !PLATFORM_ROOT_ROUTE_SEGMENTS.has(slugSegment)
  );
}

export function isCacheablePublicStorefrontFirstSegment(
  pathname: string,
  hostname: string | undefined,
  firstSegment: string
): boolean {
  const cachePolicy = getStorefrontPublicCachePolicy(pathname, hostname);
  const cacheableCategorySegments = cachePolicy
    ? CACHEABLE_PUBLIC_STOREFRONT_CATEGORY_SEGMENTS_BY_SLUG.get(
        cachePolicy.slug.toLowerCase()
      )
    : undefined;

  return (
    CACHEABLE_PUBLIC_STOREFRONT_FIRST_SEGMENTS.has(firstSegment) ||
    cacheableCategorySegments?.has(firstSegment) === true
  );
}

export function isPublicReservedStorefrontDocument(
  pathname: string,
  hostname: string | undefined,
  contentSegments: string[]
): boolean {
  const firstSegment = contentSegments[0]?.toLowerCase();
  if (
    firstSegment === undefined ||
    !isCacheablePublicStorefrontFirstSegment(pathname, hostname, firstSegment)
  ) {
    return false;
  }

  if (firstSegment === 'blog') {
    return true;
  }

  return contentSegments.length === 1;
}

export function isCacheableSingleSegmentStorefrontDocument(
  pathname: string,
  hostname: string | undefined,
  contentSegments: string[]
): boolean {
  const firstSegment = contentSegments[0]?.toLowerCase();
  return (
    contentSegments.length === 1 &&
    firstSegment !== undefined &&
    isCacheablePublicStorefrontFirstSegment(pathname, hostname, firstSegment)
  );
}

export function isStorefrontPdpDocument(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 2) {
    return false;
  }

  const firstSegment = contentSegments[0]?.toLowerCase();
  if (firstSegment === 'products') {
    return true;
  }

  return (
    firstSegment !== undefined &&
    !storefrontRouteSegments.NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.has(
      firstSegment
    )
  );
}

export function canUseLongDownstreamStorefrontCache(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  if (isStorefrontHomeDocument(pathname, hostname, routeType)) {
    return true;
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  const firstSegment = contentSegments[0]?.toLowerCase();
  if (firstSegment === 'blog') {
    return true;
  }
  if (contentSegments.length !== 1 || firstSegment === undefined) {
    return false;
  }
  if (firstSegment === 'products') {
    return true;
  }

  const cachePolicy = getStorefrontPublicCachePolicy(pathname, hostname);
  const categorySegments = cachePolicy
    ? CACHEABLE_PUBLIC_STOREFRONT_CATEGORY_SEGMENTS_BY_SLUG.get(
        cachePolicy.slug.toLowerCase()
      )
    : undefined;
  return categorySegments?.has(firstSegment) === true;
}

export function isCacheablePublicStorefrontDocument(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api',
  hasQuery: boolean
): boolean {
  if (routeType !== 'storefront' || hasQuery) {
    return false;
  }
  if (isNonHtmlStorefrontDocumentPath(pathname)) {
    return false;
  }
  if (isStorefrontHomeDocument(pathname, hostname, routeType)) {
    return true;
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length === 0) {
    return false;
  }

  const firstSegment = contentSegments[0]?.toLowerCase();
  if (
    firstSegment !== undefined &&
    storefrontRouteSegments.NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.has(
      firstSegment
    )
  ) {
    return (
      isPublicReservedStorefrontDocument(pathname, hostname, contentSegments) ||
      (firstSegment === 'products' &&
        isStorefrontProductPagePath(pathname, hostname, routeType))
    );
  }

  if (
    isCacheableSingleSegmentStorefrontDocument(
      pathname,
      hostname,
      contentSegments
    )
  ) {
    return true;
  }

  return isStorefrontProductPagePath(pathname, hostname, routeType);
}

export function shouldSetStorefrontDocumentCacheControl(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  if (
    routeType !== 'storefront' ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/api') ||
    isNonHtmlStorefrontDocumentPath(pathname)
  ) {
    return false;
  }

  if (
    isCacheablePublicStorefrontDocument(pathname, hostname, routeType, false)
  ) {
    return true;
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  const firstSegment = contentSegments[0]?.toLowerCase();

  return (
    contentSegments.length === 1 ||
    (firstSegment !== undefined &&
      storefrontRouteSegments.NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.has(
        firstSegment
      ))
  );
}
