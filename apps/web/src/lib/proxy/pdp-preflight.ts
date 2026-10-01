import { type NextRequest, NextResponse } from 'next/server';
import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import { getInternalApiSecret } from '@/lib/internal-api-secret';
import { buildHardStatusStorefrontResponse } from '@/lib/proxy/preflight-common';
import { safeDecodeSegment } from '@/lib/proxy/request-classification';
import { CATEGORY_LISTING_HUB_SEGMENTS } from '@/lib/proxy/routing-constants';
import {
  getRouteType,
  getStorefrontContentSegments,
  isSlugPrefixedStorefrontRequest,
  normalizePathnameForCompare,
} from '@/lib/proxy/routing-policy';
import { resolveStorefrontCompareHubStatus } from '@/lib/storefront-compare-hub-status';
import { isStorefrontDocumentNavigation } from '@/lib/storefront-document-navigation';
import { getStorefrontPdpFirstSegmentGate } from '@/lib/storefront-pdp-first-segment-gate';
import { getStorefrontProductCanonicalRedirectResult } from '@/lib/storefront-product-canonical-redirect';
import { resolveStorefrontProductSlugResolution } from '@/lib/storefront-product-slug-membership';

export const UUID_SHAPED_SLUG =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveStorefrontPdpHardNotFound(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  userAgent: string,
  identifier: string
): Promise<NextResponse | null> {
  if (!isStorefrontDocumentNavigation(request.method, request.headers)) {
    return null;
  }
  // Param URLs should not become hard 404s, but redirectable legacy aliases
  // should still canonicalize while preserving attribution/search params.
  const hasSearchParams = request.nextUrl.search.length > 0;

  const routeType = getRouteType(pathname);
  if (routeType !== 'storefront') {
    return null;
  }

  // Only the exact 2-segment PDP shape; category listings, nested subroutes
  // (compare/best-under), and reserved segments fall through.
  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 2) {
    return null;
  }
  // Path segments arrive percent-encoded (e.g. `dell-%E2%80%93-xps`); the DB
  // slug is decoded, so we MUST decode before comparing membership/reserved —
  // otherwise an encoded-but-real slug looks absent and gets falsely 404ed.
  const firstSegmentGate = getStorefrontPdpFirstSegmentGate(
    contentSegments,
    storefrontRouteSegments.NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS
  );
  const { firstSegment, isNonPdpFirstSegment, isProductsFallbackPdp } =
    firstSegmentGate;
  const productSlug = safeDecodeSegment(contentSegments[1]);
  // `/products/{slug}` (plural) is the categoryless PDP fallback that
  // getProductUrl emits and the `(pdp)/products/[productSlug]` route serves — a
  // real PDP surface, so it MUST be checked even though `products` is a reserved
  // first segment. (The singular `/product/{slug}` is a legacy redirect, not a
  // PDP, so it stays excluded below.)
  // Otherwise the first segment must be a real category — non-PDP first segments
  // (blog, account, my-account, receipts, pages, cart, checkout, …) have their
  // own App Router pages (incl. `/my-account/[...path]` catch-alls) and must
  // never be hard-404ed. Use the BROADER non-cacheable first-segment set, not
  // just RESERVED, so authenticated route groups are excluded too.
  if (isNonPdpFirstSegment) {
    return null;
  }
  if (
    !productSlug ||
    storefrontRouteSegments.RESERVED_STOREFRONT_SEGMENTS.has(
      productSlug.toLowerCase()
    )
  ) {
    return null;
  }
  // `/{category}/compare` is the category compare hub route, not a PDP — it
  // must never be resolved (and hard-404ed) as a product slug. The categoryless
  // `/products/{slug}` fallback stays checked: `products` beats the dynamic
  // `[category]` segment in route precedence, so `/products/compare` has no hub
  // route and `compare` there can only be a genuine product slug.
  //
  // Confirmed-EMPTY hubs (anti-thin-page guard) get the same hard 404 as
  // missing PDPs: the page's own thin-hub notFound() only yields a PPR
  // soft-404 (200 + noindex shell). The verdict is the page's own criterion
  // served by /api/internal/compare-hub-status, fails open on any uncertainty,
  // and is skipped for param URLs — mirroring the PDP hasSearchParams rule —
  // so a hub that gains eligible products serves 200 on the next clean crawl.
  if (
    !isProductsFallbackPdp &&
    CATEGORY_LISTING_HUB_SEGMENTS.has(productSlug.toLowerCase())
  ) {
    if (hasSearchParams) {
      return null;
    }
    const hubStatus = await resolveStorefrontCompareHubStatus({
      origin: request.nextUrl.origin,
      identifier,
      categorySlug: firstSegment,
      secret: getInternalApiSecret(),
    });
    if (hubStatus.kind !== 'empty') {
      return null;
    }
    return buildHardStatusStorefrontResponse(
      404,
      request,
      pathname,
      userAgent,
      hostname
    );
  }
  // UUID product URLs (`/{category}/{productId}`) resolve through the page's
  // id-based lookup + canonical 308; the slug set only holds slugs, so a
  // UUID-shaped segment must never be hard-404ed.
  if (UUID_SHAPED_SLUG.test(productSlug)) {
    return null;
  }

  const resolution = await resolveStorefrontProductSlugResolution({
    origin: request.nextUrl.origin,
    identifier,
    productSlug,
    secret: getInternalApiSecret(),
  });

  if (resolution.kind === 'redirect') {
    const redirectUrl = request.nextUrl.clone();
    const redirectPath = isSlugPrefixedStorefrontRequest(hostname)
      ? `/${identifier}${resolution.redirectPath}`
      : resolution.redirectPath;
    redirectUrl.pathname = redirectPath;
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (resolution.kind !== 'missing' || hasSearchParams) {
    return null;
  }

  return buildHardStatusStorefrontResponse(
    404,
    request,
    pathname,
    userAgent,
    hostname
  );
}

export interface StorefrontPdpCanonicalRedirectResolution {
  response: NextResponse | null;
  skipHardNotFound: boolean;
}

export async function resolveStorefrontPdpCanonicalRedirect(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  identifier: string,
  publicPathPrefix = ''
): Promise<StorefrontPdpCanonicalRedirectResolution> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return { response: null, skipHardNotFound: false };
  }
  if (
    request.headers.get('rsc') === '1' ||
    request.headers.has('next-router-prefetch') ||
    request.headers.has('next-router-state-tree')
  ) {
    return { response: null, skipHardNotFound: false };
  }
  const fetchDest = request.headers.get('sec-fetch-dest')?.toLowerCase();
  if (fetchDest && fetchDest !== 'document') {
    return { response: null, skipHardNotFound: false };
  }

  const routeType = getRouteType(pathname);
  if (routeType !== 'storefront') {
    return { response: null, skipHardNotFound: false };
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );
  if (contentSegments.length !== 2) {
    return { response: null, skipHardNotFound: false };
  }

  const firstSegment = safeDecodeSegment(contentSegments[0]).toLowerCase();
  const productSlug = safeDecodeSegment(contentSegments[1]);
  const isProductsFallbackPdp = firstSegment === 'products';

  if (
    !isProductsFallbackPdp &&
    (!firstSegment ||
      storefrontRouteSegments.NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS.has(
        firstSegment
      ))
  ) {
    return { response: null, skipHardNotFound: false };
  }
  if (
    !productSlug ||
    storefrontRouteSegments.RESERVED_STOREFRONT_SEGMENTS.has(
      productSlug.toLowerCase()
    )
  ) {
    return { response: null, skipHardNotFound: false };
  }
  // `/{category}/compare` is the category compare hub route, not a PDP — never
  // spend a canonical-alias lookup on it (a stale alias literally slugged
  // "compare" must not 308 the live hub away either). The categoryless
  // `/products/{slug}` fallback stays checked, mirroring the hard-404 gate.
  if (
    !isProductsFallbackPdp &&
    CATEGORY_LISTING_HUB_SEGMENTS.has(productSlug.toLowerCase())
  ) {
    return { response: null, skipHardNotFound: false };
  }
  const canonicalResult = await getStorefrontProductCanonicalRedirectResult({
    origin: request.nextUrl.origin,
    identifier,
    category: firstSegment,
    productSlug,
    secret: getInternalApiSecret(),
  });

  if (canonicalResult.kind === 'unknown') {
    return { response: null, skipHardNotFound: false };
  }

  if (canonicalResult.kind === 'checked-no-redirect') {
    return { response: null, skipHardNotFound: true };
  }

  const publicTargetPath = `${publicPathPrefix}${canonicalResult.redirectPath}`;
  if (
    normalizePathnameForCompare(publicTargetPath) ===
    normalizePathnameForCompare(pathname)
  ) {
    return { response: null, skipHardNotFound: true };
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = publicTargetPath;
  return {
    response: NextResponse.redirect(redirectUrl, 308),
    skipHardNotFound: true,
  };
}
