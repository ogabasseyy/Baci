import { type NextRequest, NextResponse } from 'next/server';
import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import type { CustomDomainContext } from '@/lib/proxy/custom-domain-context';
import { isValidSubdomain } from '@/lib/proxy/host';
import { normalizeStorefrontTermsAliasPath } from '@/lib/proxy/terms-redirects';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

/** Applies custom-domain slug-prefix canonicalization before API routing. */
export async function runCustomDomainAliasRouting(
  request: NextRequest,
  pathname: string,
  context: CustomDomainContext
): Promise<NextResponse | null> {
  const { domain, domainMerchantSlug, domainPathSegments } = context;
  const firstSegment = domainPathSegments[0];
  const isSafeMethod = request.method === 'GET' || request.method === 'HEAD';

  if (
    domainMerchantSlug &&
    firstSegment &&
    domainPathSegments[1]?.toLowerCase() !== 'api' &&
    isSafeMethod
  ) {
    const aliasPrefix = firstSegment.toLowerCase();
    if (
      aliasPrefix !== domainMerchantSlug.toLowerCase() &&
      isValidSubdomain(aliasPrefix) &&
      storefrontRouteSegments.shouldStripRetiredSlugPrefix(
        aliasPrefix,
        domainPathSegments.length
      )
    ) {
      const currentSlug = await getCurrentSlugForAlias(aliasPrefix);
      if (
        currentSlug &&
        currentSlug.toLowerCase() === domainMerchantSlug.toLowerCase()
      ) {
        const stripped = pathname.slice(`/${firstSegment}`.length) || '/';
        return NextResponse.redirect(
          `https://${domain}${normalizeStorefrontTermsAliasPath(stripped)}${request.nextUrl.search}`,
          302
        );
      }
    }
  }

  return null;
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
  const segments = stripped.split('/').filter(Boolean);
  const firstStripped = segments[0]?.toLowerCase();
  const normalizedTerms = normalizeStorefrontTermsAliasPath(stripped);
  const normalized =
    normalizedTerms !== stripped
      ? normalizedTerms
      : segments.length === 2 &&
          firstStripped &&
          !storefrontRouteSegments.RESERVED_STOREFRONT_SEGMENTS.has(
            firstStripped
          )
        ? `/products/${segments[segments.length - 1]}`
        : stripped;
  const url = `https://${domain}${normalized}${request.nextUrl.search}`;
  return url === request.nextUrl.href ? null : NextResponse.redirect(url, 301);
}
