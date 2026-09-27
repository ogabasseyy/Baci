import {
  STOREFRONT_PUBLIC_CACHE_POLICIES,
  type StorefrontPublicCachePolicy,
} from '@/config/storefront-cache';
import {
  extractLocalhostSubdomain,
  extractSubdomain,
  isLocalhost,
  isPlatformHost,
  isValidCustomDomain,
  isValidSubdomain,
  normalizeHostname,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import { safeDecodeSegment } from '@/lib/proxy/request-classification';
import { PLATFORM_ROOT_ROUTE_SEGMENTS } from '@/lib/proxy/routing-constants';
import { isSlugPrefixedStorefrontRequest } from '@/lib/proxy/routing-policy';
import { getStorefrontPublicationCacheTag } from '@/lib/storefront-publication-cache-tag';

export const STOREFRONT_CACHE_POLICIES_BY_SLUG = new Map<
  string,
  StorefrontPublicCachePolicy
>(
  STOREFRONT_PUBLIC_CACHE_POLICIES.map((policy) => [
    policy.slug.toLowerCase(),
    policy,
  ])
);

export const STOREFRONT_CACHE_POLICIES_BY_HOSTNAME = new Map<
  string,
  StorefrontPublicCachePolicy
>(
  STOREFRONT_PUBLIC_CACHE_POLICIES.flatMap((policy) =>
    policy.customHostnames.map(
      (hostname) => [normalizeHostname(hostname), policy] as const
    )
  )
);

export const CACHEABLE_PUBLIC_STOREFRONT_CATEGORY_SEGMENTS_BY_SLUG = new Map<
  string,
  Set<string>
>(
  STOREFRONT_PUBLIC_CACHE_POLICIES.map((policy) => [
    policy.slug.toLowerCase(),
    new Set<string>(
      policy.cacheableCategorySegments.map((segment) => segment.toLowerCase())
    ),
  ])
);

export function getStorefrontSlugFromRequest(
  pathname: string,
  hostname: string | undefined
): string | null {
  if (!hostname) {
    return null;
  }

  const normalizedHostname = hostname ? normalizeHostname(hostname) : '';
  const customDomainPolicy =
    STOREFRONT_CACHE_POLICIES_BY_HOSTNAME.get(normalizedHostname);
  if (customDomainPolicy) {
    return customDomainPolicy.slug.toLowerCase();
  }

  const localhostSubdomain = extractLocalhostSubdomain(normalizedHostname);
  if (localhostSubdomain) {
    return localhostSubdomain;
  }

  const rootDomainSubdomain = extractSubdomain(normalizedHostname, ROOT_DOMAIN);
  if (rootDomainSubdomain && !RESERVED_SUBDOMAINS.has(rootDomainSubdomain)) {
    return rootDomainSubdomain;
  }

  if (!isSlugPrefixedStorefrontRequest(hostname)) {
    return null;
  }

  return pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? null;
}

export function getStorefrontPublicCachePolicy(
  pathname: string,
  hostname: string | undefined
) {
  const storefrontSlug = getStorefrontSlugFromRequest(pathname, hostname);
  if (!storefrontSlug) {
    return null;
  }

  return STOREFRONT_CACHE_POLICIES_BY_SLUG.get(storefrontSlug) ?? null;
}

export function getStorefrontPublicationResponseCacheTag(
  pathname: string,
  hostname: string | undefined
): string | null {
  if (!hostname || isLocalhost(hostname)) {
    return null;
  }

  const normalizedHostname = normalizeHostname(hostname);
  if (isPlatformHost(normalizedHostname)) {
    const slug = safeDecodeSegment(
      pathname.split('/').filter(Boolean)[0]
    ).toLowerCase();
    if (
      !slug ||
      !isValidSubdomain(slug) ||
      RESERVED_SUBDOMAINS.has(slug) ||
      PLATFORM_ROOT_ROUTE_SEGMENTS.has(slug)
    ) {
      return null;
    }

    return getStorefrontPublicationCacheTag({ kind: 'slug', value: slug });
  }

  const merchantSubdomain = extractSubdomain(normalizedHostname, ROOT_DOMAIN);
  if (merchantSubdomain && !RESERVED_SUBDOMAINS.has(merchantSubdomain)) {
    return getStorefrontPublicationCacheTag({
      kind: 'slug',
      value: merchantSubdomain,
    });
  }

  return isValidCustomDomain(normalizedHostname)
    ? getStorefrontPublicationCacheTag({
        kind: 'hostname',
        value: normalizedHostname,
      })
    : null;
}
