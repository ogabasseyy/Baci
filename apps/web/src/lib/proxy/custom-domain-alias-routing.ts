import { type NextRequest, NextResponse } from 'next/server';
import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import type { CustomDomainContext } from '@/lib/proxy/custom-domain-context';
import { isValidSubdomain } from '@/lib/proxy/host';
import { normalizeStorefrontTermsAliasPath } from '@/lib/proxy/terms-redirects';

export function getCustomDomainAliasPrefix(
  method: string,
  segments: string[]
): string | null {
  const prefix = segments[0]?.toLowerCase();
  if (
    !prefix ||
    (method !== 'GET' && method !== 'HEAD') ||
    segments[1]?.toLowerCase() === 'api' ||
    !isValidSubdomain(prefix) ||
    !storefrontRouteSegments.shouldStripRetiredSlugPrefix(
      prefix,
      segments.length
    )
  ) {
    return null;
  }
  return prefix;
}

/** Applies custom-domain slug-prefix canonicalization before API routing. */
export function runCustomDomainAliasRouting(
  request: NextRequest,
  pathname: string,
  context: CustomDomainContext
): NextResponse | null {
  const {
    domain,
    domainMerchantSlug,
    domainPathSegments,
    pathAliasCurrentSlug,
  } = context;
  const firstSegment = domainPathSegments[0];
  const prefix = getCustomDomainAliasPrefix(request.method, domainPathSegments);
  if (
    !prefix ||
    !domainMerchantSlug ||
    prefix === domainMerchantSlug.toLowerCase() ||
    pathAliasCurrentSlug?.toLowerCase() !== domainMerchantSlug.toLowerCase()
  ) {
    return null;
  }
  const stripped = pathname.slice(`/${firstSegment}`.length) || '/';
  return NextResponse.redirect(
    `https://${domain}${normalizeStorefrontTermsAliasPath(stripped)}${request.nextUrl.search}`,
    301
  );
}

/** Canonicalizes a current slug prefix after machine-readable paths pass through. */
export function runCustomDomainCurrentSlugCanonicalization(
  request: NextRequest,
  pathname: string,
  context: CustomDomainContext
): NextResponse | null {
  const { domain, domainMerchantSlug, domainPathSegments } = context;
  const firstSegment = domainPathSegments[0];
  const isSafeMethod = request.method === 'GET' || request.method === 'HEAD';
  if (
    !domainMerchantSlug ||
    !firstSegment ||
    firstSegment.toLowerCase() !== domainMerchantSlug.toLowerCase() ||
    !isSafeMethod
  ) {
    return null;
  }
  const stripped = pathname.slice(firstSegment.length + 1) || '/';
  const normalized = normalizeStorefrontTermsAliasPath(stripped);
  const url = `https://${domain}${normalized}${request.nextUrl.search}`;
  return url === request.nextUrl.href ? null : NextResponse.redirect(url, 301);
}
