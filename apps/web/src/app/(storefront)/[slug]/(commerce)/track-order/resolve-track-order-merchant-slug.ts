import { extractPlatformSubdomainSlug } from '@/lib/platform-subdomain';

export function resolveTrackOrderMerchantSlug(
  resolvedMerchantSlug: string | null | undefined,
  routeSlugParam: string | string[] | undefined
): string | undefined {
  if (resolvedMerchantSlug) {
    return resolvedMerchantSlug;
  }

  const rawSlug = Array.isArray(routeSlugParam)
    ? routeSlugParam[0]
    : routeSlugParam;
  if (!rawSlug) {
    return undefined;
  }

  return extractPlatformSubdomainSlug(rawSlug.toLowerCase()) ?? rawSlug;
}
