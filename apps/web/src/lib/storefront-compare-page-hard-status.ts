import type { NextRequest, NextResponse } from 'next/server';
import { getInternalApiSecret } from '@/lib/internal-api-secret';
import { storefrontComparePageStatus } from '@/lib/storefront-compare-page-status';

type StorefrontRouteType = 'admin' | 'auth' | 'storefront' | 'api';

interface StorefrontComparePageHardStatusDependencies {
  isEligibleForHardStatusPreflight: (
    request: NextRequest,
    pathname: string
  ) => boolean;
  getRouteType: (pathname: string) => StorefrontRouteType;
  getStorefrontContentSegments: (
    pathname: string,
    hostname: string | undefined,
    routeType: StorefrontRouteType
  ) => string[];
  nonCacheableStorefrontFirstSegments: ReadonlySet<string>;
  buildHardStatusStorefrontResponse: (
    status: 404 | 410,
    request: NextRequest,
    pathname: string,
    userAgent: string,
    hostname: string | undefined,
    homePath?: string
  ) => NextResponse;
}

function safeDecodeSegment(segment: string | undefined): string {
  if (!segment) {
    return '';
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Creates the compare-page hard-status preflight used by the proxy's three
 * storefront host shapes. The proxy supplies routing/security primitives and
 * keeps ownership of the final HTML response; this module owns the compare
 * URL eligibility and status-read policy.
 */
export function createStorefrontComparePageHardStatusResolver(
  dependencies: StorefrontComparePageHardStatusDependencies
) {
  return async function resolveStorefrontComparePageHardStatus(
    request: NextRequest,
    pathname: string,
    hostname: string | undefined,
    userAgent: string,
    identifier: string,
    publicPathPrefix = ''
  ): Promise<NextResponse | null> {
    if (!dependencies.isEligibleForHardStatusPreflight(request, pathname)) {
      return null;
    }
    // Preserve attribution/filter/query variants for the route itself; only a
    // clean canonical document gets a crawler-facing hard status.
    if (request.nextUrl.search.length > 0) {
      return null;
    }

    const routeType = dependencies.getRouteType(pathname);
    const contentSegments = dependencies.getStorefrontContentSegments(
      pathname,
      hostname,
      routeType
    );
    if (contentSegments.length !== 3) {
      return null;
    }

    const categorySlug = safeDecodeSegment(contentSegments[0]);
    const subroute = safeDecodeSegment(contentSegments[1]).toLowerCase();
    const comparisonSlug = safeDecodeSegment(contentSegments[2]);
    if (
      !categorySlug ||
      dependencies.nonCacheableStorefrontFirstSegments.has(
        categorySlug.toLowerCase()
      ) ||
      subroute !== 'compare' ||
      !comparisonSlug
    ) {
      return null;
    }

    const resolution = await storefrontComparePageStatus.resolve({
      origin: request.nextUrl.origin,
      identifier,
      categorySlug,
      comparisonSlug,
      secret: getInternalApiSecret(),
    });
    if (resolution.kind !== 'missing') {
      return null;
    }

    return dependencies.buildHardStatusStorefrontResponse(
      404,
      request,
      pathname,
      userAgent,
      hostname,
      publicPathPrefix || '/'
    );
  };
}
