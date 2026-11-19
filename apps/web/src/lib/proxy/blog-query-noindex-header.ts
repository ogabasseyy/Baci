import type { NextResponse } from 'next/server';
import { getStorefrontContentSegments } from '@/lib/proxy/routing-policy';

type StorefrontBlogListingRouteKind = 'root' | 'category' | 'author';

function getStorefrontBlogListingRouteKind(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api'
): StorefrontBlogListingRouteKind | null {
  if (routeType !== 'storefront') {
    return null;
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  const pathSegments = pathname.split('/').filter(Boolean);

  const matchSegments = (
    segments: string[]
  ): StorefrontBlogListingRouteKind | null => {
    const first = segments[0]?.toLowerCase();
    if (first !== 'blog') {
      return null;
    }
    if (segments.length === 1) {
      return 'root';
    }
    const second = segments[1]?.toLowerCase();
    if (segments.length === 3 && second === 'category' && segments[2]) {
      return 'category';
    }
    if (segments.length === 3 && second === 'author' && segments[2]) {
      return 'author';
    }
    return null;
  };

  const directMatch = matchSegments(contentSegments);
  if (directMatch) {
    return directMatch;
  }

  if (!hostname && pathSegments.length >= 2) {
    return matchSegments(pathSegments.slice(1));
  }

  return null;
}

function shouldSetStorefrontBlogQueryNoIndexHeader(
  pathname: string,
  hostname: string | undefined,
  routeType: 'admin' | 'auth' | 'storefront' | 'api',
  searchParams: URLSearchParams | undefined
): boolean {
  if (!searchParams) {
    return false;
  }

  const routeKind = getStorefrontBlogListingRouteKind(
    pathname,
    hostname,
    routeType
  );
  if (!routeKind) {
    return false;
  }

  const rawPage = searchParams.get('page')?.trim() ?? '';
  const parsedPage = Number.parseInt(rawPage, 10);
  const hasPaginatedQuery =
    (Number.isFinite(parsedPage) && parsedPage > 1) ||
    (rawPage.length > 0 && rawPage !== '1');

  const rawSearch = searchParams.get('search')?.trim() ?? '';
  const hasSearchQuery = rawSearch.length > 0;

  const rawCategory = searchParams.get('category')?.trim() ?? '';
  const hasRootCategoryQuery = routeKind === 'root' && rawCategory.length > 0;

  return hasPaginatedQuery || hasSearchQuery || hasRootCategoryQuery;
}

export function applyBlogQueryNoindexHeader(
  target: NextResponse | Response | { headers: Headers } | Headers,
  pathname: string,
  hostname?: string,
  routeType: 'admin' | 'auth' | 'storefront' | 'api' = 'storefront',
  searchParams?: URLSearchParams
): boolean {
  const qIndex = pathname.indexOf('?');
  const cleanPathname = qIndex >= 0 ? pathname.slice(0, qIndex) : pathname;
  const embeddedQuery = qIndex >= 0 ? pathname.slice(qIndex + 1) : '';
  let params = searchParams;
  if (qIndex >= 0) {
    const queryParams = new URLSearchParams(embeddedQuery);
    if (!params) {
      params = queryParams;
    } else {
      const merged = new URLSearchParams(params);
      queryParams.forEach((value, key) => {
        if (!merged.has(key)) {
          merged.set(key, value);
        }
      });
      params = merged;
    }
  }

  const headers = 'headers' in target ? target.headers : target;
  if (headers.has('X-Robots-Tag')) {
    return false;
  }

  if (
    shouldSetStorefrontBlogQueryNoIndexHeader(
      cleanPathname,
      hostname,
      routeType,
      params
    )
  ) {
    headers.set('X-Robots-Tag', 'noindex, follow');
    return true;
  }

  return false;
}
