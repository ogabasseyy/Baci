import { type NextRequest, NextResponse } from 'next/server';
import type { BlogListingStatusIntent } from '@/lib/cached-storefront-blog-listing-status';
import { getInternalApiSecret } from '@/lib/internal-api-secret';
import {
  buildHardStatusStorefrontResponse,
  isEligibleForHardStatusPreflight,
} from '@/lib/proxy/preflight-common';
import { safeDecodeSegment } from '@/lib/proxy/request-classification';
import { BLOG_STATUS_PREFLIGHT_EXCLUDED_SLUGS } from '@/lib/proxy/routing-constants';
import {
  getRouteType,
  getStorefrontContentSegments,
} from '@/lib/proxy/routing-policy';
import { resolveStorefrontBlogListingStatus } from '@/lib/storefront-blog-listing-status';
import { resolveStorefrontBlogPostStatus } from '@/lib/storefront-blog-post-status';

export async function resolveStorefrontBlogPostHardStatus(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  userAgent: string,
  identifier: string,
  publicPathPrefix = ''
): Promise<NextResponse | null> {
  if (!isEligibleForHardStatusPreflight(request, pathname)) {
    return null;
  }

  const routeType = getRouteType(pathname);
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 2) {
    return null;
  }

  const firstSegment = safeDecodeSegment(contentSegments[0]).toLowerCase();
  const postSlug = safeDecodeSegment(contentSegments[1]);
  const normalizedPostSlug = postSlug.toLowerCase();
  if (
    firstSegment !== 'blog' ||
    !postSlug ||
    BLOG_STATUS_PREFLIGHT_EXCLUDED_SLUGS.has(normalizedPostSlug)
  ) {
    return null;
  }

  const resolution = await resolveStorefrontBlogPostStatus({
    origin: request.nextUrl.origin,
    identifier,
    postSlug,
    secret: getInternalApiSecret(),
  });

  if (resolution.kind === 'redirect') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = `${publicPathPrefix}${resolution.redirectPath}`;
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (resolution.kind !== 'missing') {
    return null;
  }

  return buildHardStatusStorefrontResponse(
    404,
    request,
    pathname,
    userAgent,
    hostname,
    publicPathPrefix || '/'
  );
}

export const MAX_BLOG_LISTING_PAGE = 10_000;

export function parseBlogListingPageParam(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return Math.min(parsed, MAX_BLOG_LISTING_PAGE);
}

export function buildBlogListingIntent(
  contentSegments: string[],
  searchParams: URLSearchParams
): BlogListingStatusIntent | null {
  if (
    !contentSegments.length ||
    safeDecodeSegment(contentSegments[0]).toLowerCase() !== 'blog'
  ) {
    return null;
  }

  const category = searchParams.get('category')?.trim() || undefined;
  // Search variants of the listing/category routes stay noindex and are left
  // for the route to render — a hard redirect that rebuilds/drops the search
  // term would be wrong. The author route ignores ?search=, so its hard-status
  // checks still run (handled per-branch below).
  const hasSearch = Boolean(searchParams.get('search')?.trim());
  const page = parseBlogListingPageParam(searchParams.get('page'));

  if (contentSegments.length === 1) {
    if (hasSearch) {
      return null;
    }
    // /blog — canonicalize a known ?category= (page 1), else clamp out-of-range
    // ?page= (the category, when present, stays on the query URL).
    if (category && (page ?? 1) === 1) {
      return { kind: 'category-query', category };
    }
    if (page && page > 1) {
      return { kind: 'listing-page', page, ...(category ? { category } : {}) };
    }
    return null;
  }

  if (contentSegments.length === 3) {
    const second = safeDecodeSegment(contentSegments[1]).toLowerCase();
    const third = safeDecodeSegment(contentSegments[2]);
    if (second === 'category' && third && !hasSearch && page && page > 1) {
      return { kind: 'category-page', categorySlug: third, page };
    }
    if (second === 'author' && third) {
      // Author pages ignore ?search=, so the no-posts 404 / page clamp still
      // runs even with a stray search param.
      return { kind: 'author', authorSlug: third, page: page ?? 1 };
    }
  }

  return null;
}

export async function resolveStorefrontBlogListingHardStatus(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  userAgent: string,
  identifier: string,
  publicPathPrefix = ''
): Promise<NextResponse | null> {
  if (!isEligibleForHardStatusPreflight(request, pathname)) {
    return null;
  }

  const routeType = getRouteType(pathname);
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  const intent = buildBlogListingIntent(
    contentSegments,
    request.nextUrl.searchParams
  );
  if (!intent) {
    return null;
  }

  const resolution = await resolveStorefrontBlogListingStatus({
    origin: request.nextUrl.origin,
    identifier,
    intent,
    secret: getInternalApiSecret(),
  });

  if (resolution.kind === 'redirect') {
    // redirectPath may carry its own query (e.g. /blog?page=3); split it so the
    // originating ?category=/?page= filters are replaced, not appended.
    const target = new URL(resolution.redirectPath, request.nextUrl.origin);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = `${publicPathPrefix}${target.pathname}`;
    redirectUrl.search = target.search;
    // Preserve non-filter params (utm_*, ref, tag=a&tag=b, ...) that the
    // resolver target drops — matching the in-route param-preservation rule,
    // including repeated (array) values. Only the target's own keys are kept.
    const targetKeys = new Set(redirectUrl.searchParams.keys());
    for (const [key, value] of request.nextUrl.searchParams) {
      if (
        key !== 'category' &&
        key !== 'page' &&
        key !== 'search' &&
        !targetKeys.has(key)
      ) {
        redirectUrl.searchParams.append(key, value);
      }
    }
    return NextResponse.redirect(redirectUrl, resolution.status);
  }

  if (resolution.kind === 'notFound') {
    return buildHardStatusStorefrontResponse(
      404,
      request,
      pathname,
      userAgent,
      hostname,
      publicPathPrefix || '/'
    );
  }

  return null;
}
