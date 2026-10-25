import type { NextRequest, NextResponse } from 'next/server';
import {
  resolveStorefrontBlogListingHardStatus,
  resolveStorefrontBlogPostHardStatus,
} from '@/lib/proxy/blog-preflight';
import { resolveStorefrontComparePageHardStatus } from '@/lib/proxy/compare-preflight';
import {
  resolveStorefrontPdpCanonicalRedirect,
  resolveStorefrontPdpHardNotFound,
} from '@/lib/proxy/pdp-preflight';
import {
  buildHardStatusStorefrontResponse,
  isEligibleForHardStatusPreflight,
} from '@/lib/proxy/preflight-common';
import { safeDecodeSegment } from '@/lib/proxy/request-classification';
import {
  getRouteType,
  getStorefrontContentSegments,
} from '@/lib/proxy/routing-policy';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import {
  GAMING_LAPTOPS_CATEGORY_SLUG,
  getGamingLaptopGraphicsHub,
} from '@/lib/storefront-category/gaming-laptop-graphics-hubs';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';
import { isStorefrontDocumentNavigation } from '@/lib/storefront-document-navigation';
import { storefrontInternalPreflight } from '@/lib/storefront-internal-preflight';
import { callStorefrontPreflightRpc } from '@/lib/storefront-preflight-rpc';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import {
  STOREFRONT_AUTH_MERCHANT_RPC,
  storefrontAuthMerchantRowSchema,
} from '@/schemas/storefront-preflight-rpc';

type StorefrontPreflightParams = {
  request: NextRequest;
  pathname: string;
  hostname: string;
  userAgent: string;
  merchantIdentifier: string;
  homePathPrefix?: string;
};

function checkBrandAuthorityEntry(
  categorySlug: string,
  brandSlug: string
): boolean {
  return Boolean(brandAuthorityTaxonomy.getEntry(categorySlug, brandSlug));
}

function checkModelFamilyAuthorityEntry(
  categorySlug: string,
  brandSlug: string,
  familySlug: string
): boolean {
  return Boolean(
    modelFamilyAuthorityTaxonomy.getEntry(categorySlug, brandSlug, familySlug)
  );
}

function checkCuratedPriceBand(
  categorySlug: string,
  priceBandSlug: string
): boolean {
  return getCuratedPriceBands(categorySlug).some(
    (band) => band.slug === priceBandSlug
  );
}

function checkGamingGraphicsHub(
  categorySlug: string,
  graphicsSlug: string
): boolean {
  if (categorySlug !== GAMING_LAPTOPS_CATEGORY_SLUG) {
    return false;
  }
  return Boolean(getGamingLaptopGraphicsHub(graphicsSlug));
}

export async function resolveStorefrontTaxonomySubrouteHardStatus(
  request: NextRequest,
  pathname: string,
  hostname: string | undefined,
  userAgent: string,
  merchantIdentifier: string,
  homePathPrefix = ''
): Promise<NextResponse | null> {
  if (!isEligibleForHardStatusPreflight(request, pathname)) {
    return null;
  }
  if (request.nextUrl.search.length > 0) {
    return null;
  }

  const routeType = getRouteType(pathname);
  if (routeType !== 'storefront') {
    return null;
  }

  const contentSegments = getStorefrontContentSegments(
    pathname,
    hostname,
    routeType
  );

  // Do NOT intercept 1-segment /{category} routes or 2-segment PDPs.
  let isKnownTaxonomySubroute = false;
  let isTaxonomyEntryValid = false;

  if (contentSegments.length === 3) {
    const categorySlug = safeDecodeSegment(contentSegments[0]);
    const subroute = safeDecodeSegment(contentSegments[1]).toLowerCase();
    const leafSlug = safeDecodeSegment(contentSegments[2]);

    if (subroute === 'brands') {
      isKnownTaxonomySubroute = true;
      isTaxonomyEntryValid =
        evaluateStorefrontSlugSafety(categorySlug).safe &&
        evaluateStorefrontSlugSafety(leafSlug).safe &&
        checkBrandAuthorityEntry(categorySlug, leafSlug);
    } else if (subroute === 'best-under') {
      isKnownTaxonomySubroute = true;
      isTaxonomyEntryValid =
        evaluateStorefrontSlugSafety(categorySlug).safe &&
        evaluateStorefrontSlugSafety(leafSlug).safe &&
        checkCuratedPriceBand(categorySlug, leafSlug);
    } else if (subroute === 'graphics') {
      isKnownTaxonomySubroute = true;
      isTaxonomyEntryValid =
        evaluateStorefrontSlugSafety(categorySlug).safe &&
        evaluateStorefrontSlugSafety(leafSlug).safe &&
        checkGamingGraphicsHub(categorySlug, leafSlug);
    }
  } else if (contentSegments.length === 5) {
    const categorySlug = safeDecodeSegment(contentSegments[0]);
    const subroute = safeDecodeSegment(contentSegments[1]).toLowerCase();
    const brandSlug = safeDecodeSegment(contentSegments[2]);
    const familySegment = safeDecodeSegment(contentSegments[3]).toLowerCase();
    const familySlug = safeDecodeSegment(contentSegments[4]);

    if (subroute === 'brands' && familySegment === 'families') {
      isKnownTaxonomySubroute = true;
      isTaxonomyEntryValid =
        evaluateStorefrontSlugSafety(categorySlug).safe &&
        evaluateStorefrontSlugSafety(brandSlug).safe &&
        evaluateStorefrontSlugSafety(familySlug).safe &&
        checkModelFamilyAuthorityEntry(categorySlug, brandSlug, familySlug);
    }
  }

  if (!isKnownTaxonomySubroute || isTaxonomyEntryValid) {
    return null;
  }

  const failOpenContext = {
    surface: 'compare-page-status' as const,
    identifier: merchantIdentifier,
    slug: safeDecodeSegment(contentSegments[0]),
  };
  const result = await callStorefrontPreflightRpc(
    STOREFRONT_AUTH_MERCHANT_RPC,
    { p_identifier: merchantIdentifier.toLowerCase() },
    {
      failOpenContext,
      emptyResult: 'unknown',
    }
  );
  if (result === null) {
    return null;
  }

  const parsed = storefrontAuthMerchantRowSchema.safeParse(result.data);
  if (!parsed.success) {
    if (result.attempt) {
      storefrontInternalPreflight.warnRpcFailOpen(
        failOpenContext,
        { ...result.attempt, outcome: 'parse-error' },
        'parse'
      );
    } else {
      storefrontInternalPreflight.warnFailOpen({
        ...failOpenContext,
        reason: 'parse',
      });
    }
    return null;
  }

  if (!parsed.data.is_published) {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: 'unknown-storefront',
    });
    return null;
  }

  return buildHardStatusStorefrontResponse(
    404,
    request,
    pathname,
    userAgent,
    hostname,
    homePathPrefix || '/'
  );
}

/**
 * Runs public document verdicts in their redirect-precedence order. A canonical
 * PDP resolution intentionally suppresses the following membership read.
 */
export async function runStorefrontPreflight({
  request,
  pathname,
  hostname,
  userAgent,
  merchantIdentifier,
  homePathPrefix,
}: StorefrontPreflightParams): Promise<NextResponse | null> {
  // Every verdict below requires a document navigation. Reject router data,
  // prefetches and mutations before scheduling the async helpers.
  if (!isStorefrontDocumentNavigation(request.method, request.headers)) {
    return null;
  }

  const blogPostHardStatus = await resolveStorefrontBlogPostHardStatus(
    request,
    pathname,
    hostname,
    userAgent,
    merchantIdentifier,
    homePathPrefix
  );
  if (blogPostHardStatus) return blogPostHardStatus;

  const blogListingHardStatus = await resolveStorefrontBlogListingHardStatus(
    request,
    pathname,
    hostname,
    userAgent,
    merchantIdentifier,
    homePathPrefix
  );
  if (blogListingHardStatus) return blogListingHardStatus;

  const comparePageHardStatus = await resolveStorefrontComparePageHardStatus(
    request,
    pathname,
    hostname,
    userAgent,
    merchantIdentifier,
    homePathPrefix
  );
  if (comparePageHardStatus) return comparePageHardStatus;

  const taxonomySubrouteHardStatus =
    await resolveStorefrontTaxonomySubrouteHardStatus(
      request,
      pathname,
      hostname,
      userAgent,
      merchantIdentifier,
      homePathPrefix
    );
  if (taxonomySubrouteHardStatus) return taxonomySubrouteHardStatus;

  const canonical = await resolveStorefrontPdpCanonicalRedirect(
    request,
    pathname,
    hostname,
    merchantIdentifier,
    homePathPrefix
  );
  if (canonical.response) return canonical.response;
  if (canonical.skipHardNotFound) return null;

  return resolveStorefrontPdpHardNotFound(
    request,
    pathname,
    hostname,
    userAgent,
    merchantIdentifier
  );
}
