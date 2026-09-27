import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import {
  isPlatformHost,
  isValidSubdomain,
  RESERVED_SUBDOMAINS,
} from '@/lib/proxy/host';
import {
  MAIN_APP_ROUTES,
  NESTED_PRODUCT_SUBROUTE_EXCLUSIONS,
  PLATFORM_ROOT_ROUTE_SEGMENTS,
  PUBLIC_MACHINE_READABLE_PATHS,
  STATIC_FILES_REGEX,
  STOREFRONT_METADATA_CACHE_NON_HTML_EXTENSIONS_REGEX,
  STOREFRONT_METADATA_CACHE_NON_HTML_ROUTE_SEGMENTS,
  STOREFRONT_METADATA_CACHE_NON_HTML_SEGMENTS,
  STOREFRONT_METADATA_CACHE_NON_SEO_SEGMENTS,
} from '@/lib/proxy/routing-constants';

export function isPublicMachineReadablePath(pathname: string): boolean {
  return PUBLIC_MACHINE_READABLE_PATHS.has(pathname);
}

export function isSlugPrefixedStorefrontRequest(
  hostname: string | undefined
): boolean {
  return hostname ? isPlatformHost(hostname) : false;
}

export function getStorefrontContentSegments(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): string[] {
  if (routeType !== 'storefront') {
    return [];
  }

  const pathSegments = pathname.split('/').filter(Boolean);
  return isSlugPrefixedStorefrontRequest(hostname)
    ? pathSegments.slice(1)
    : pathSegments;
}

export function normalizePathnameForCompare(pathname: string): string {
  return (pathname.replace(/\/+$/g, '') || '/').toLowerCase();
}

export function getNestedProductSubrouteSegment(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): string | null {
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 3) {
    return null;
  }

  return contentSegments[1] ?? null;
}

export function isStorefrontNestedListingPath(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  const subrouteSegment = getNestedProductSubrouteSegment(
    pathname,
    hostname,
    routeType
  );
  return (
    subrouteSegment !== null &&
    NESTED_PRODUCT_SUBROUTE_EXCLUSIONS.has(subrouteSegment)
  );
}

export function isStorefrontProductPagePath(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length === 2) {
    return true;
  }

  const subrouteSegment = getNestedProductSubrouteSegment(
    pathname,
    hostname,
    routeType
  );
  if (subrouteSegment === null) {
    return false;
  }

  return !NESTED_PRODUCT_SUBROUTE_EXCLUSIONS.has(subrouteSegment);
}

export function shouldPartitionStorefrontMetadataCache(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): boolean {
  if (routeType !== 'storefront') {
    return false;
  }

  const lowerPathname = pathname.toLowerCase();
  if (
    isPublicMachineReadablePath(pathname) ||
    STATIC_FILES_REGEX.test(lowerPathname) ||
    STOREFRONT_METADATA_CACHE_NON_HTML_EXTENSIONS_REGEX.test(lowerPathname)
  ) {
    return false;
  }

  const pathSegments = pathname.split('/').filter(Boolean);
  if (isSlugPrefixedStorefrontRequest(hostname)) {
    const slugSegment = pathSegments[0]?.toLowerCase();
    if (
      !slugSegment ||
      !isValidSubdomain(slugSegment) ||
      RESERVED_SUBDOMAINS.has(slugSegment) ||
      storefrontRouteSegments.RESERVED_STOREFRONT_SEGMENTS.has(slugSegment) ||
      PLATFORM_ROOT_ROUTE_SEGMENTS.has(slugSegment)
    ) {
      return false;
    }
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  const firstSegment = contentSegments[0]?.toLowerCase();

  if (
    firstSegment &&
    (STOREFRONT_METADATA_CACHE_NON_HTML_SEGMENTS.has(firstSegment) ||
      STOREFRONT_METADATA_CACHE_NON_SEO_SEGMENTS.has(firstSegment))
  ) {
    return false;
  }

  return !contentSegments.some((segment) =>
    STOREFRONT_METADATA_CACHE_NON_HTML_ROUTE_SEGMENTS.has(segment.toLowerCase())
  );
}

export function matchesMainAppRoute(pathname: string): boolean {
  return MAIN_APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export function isNonHtmlStorefrontDocumentPath(pathname: string): boolean {
  const lowerPathname = pathname.toLowerCase();
  return (
    isPublicMachineReadablePath(pathname) ||
    STATIC_FILES_REGEX.test(lowerPathname) ||
    STOREFRONT_METADATA_CACHE_NON_HTML_EXTENSIONS_REGEX.test(lowerPathname) ||
    pathname
      .split('/')
      .filter(Boolean)
      .some((segment) =>
        STOREFRONT_METADATA_CACHE_NON_HTML_ROUTE_SEGMENTS.has(
          segment.toLowerCase()
        )
      )
  );
}

export function getRouteType(
  pathname: string
): 'admin' | 'auth' | 'storefront' | 'api' {
  if (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/builder') ||
    pathname.startsWith('/onboarding')
  ) {
    return 'admin';
  }

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/reset-password')
  ) {
    return 'auth';
  }

  if (pathname.startsWith('/api')) {
    return 'api';
  }

  return 'storefront';
}
