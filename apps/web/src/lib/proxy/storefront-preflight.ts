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
import { isStorefrontDocumentNavigation } from '@/lib/storefront-document-navigation';

type StorefrontPreflightParams = {
  request: NextRequest;
  pathname: string;
  hostname: string;
  userAgent: string;
  merchantIdentifier: string;
  homePathPrefix?: string;
};

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
  // prefetches and mutations before scheduling the five async helpers.
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
