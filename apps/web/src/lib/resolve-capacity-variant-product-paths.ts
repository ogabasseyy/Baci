import { getCachedProductCanonicalPaths } from '@/lib/cached-product-canonical-paths';

const CAPACITY_VARIANT_SUFFIX_REGEX =
  /^(.+?)-(?:\d+gb-)?\d+(?:gb|tb)(-(?:5g|4g))?$/i;

export function getCapacityBaseSlugs(candidate: string): string[] {
  const match = CAPACITY_VARIANT_SUFFIX_REGEX.exec(candidate);
  if (!match?.[1]) {
    return [];
  }
  return match[2]
    ? [`${match[1]}${match[2].toLowerCase()}`, match[1]]
    : [match[1]];
}

export async function resolveCapacityVariantProductPaths(
  merchantId: string,
  slugCandidates: string[],
  existingProductPaths: Readonly<Record<string, string>>
): Promise<Record<string, string>> {
  const baseSlugsByCandidate = new Map<string, string[]>();
  for (const candidate of slugCandidates) {
    if (Object.hasOwn(existingProductPaths, candidate)) {
      continue;
    }
    const baseSlugs = getCapacityBaseSlugs(candidate);
    if (baseSlugs.length > 0) {
      baseSlugsByCandidate.set(candidate, baseSlugs);
    }
  }
  if (baseSlugsByCandidate.size === 0) {
    return {};
  }

  const baseSlugsToLookup = Array.from(
    new Set(Array.from(baseSlugsByCandidate.values()).flat())
  ).filter((baseSlug) => !Object.hasOwn(existingProductPaths, baseSlug));

  const basePaths = baseSlugsToLookup.length
    ? await getCachedProductCanonicalPaths(merchantId, baseSlugsToLookup, {
        throwOnQueryError: true,
      })
    : {};

  const resolvedPaths: Record<string, string> = {};
  for (const [candidate, baseSlugs] of baseSlugsByCandidate) {
    for (const baseSlug of baseSlugs) {
      const basePath = Object.hasOwn(existingProductPaths, baseSlug)
        ? existingProductPaths[baseSlug]
        : Object.hasOwn(basePaths, baseSlug)
          ? basePaths[baseSlug]
          : undefined;
      if (basePath) {
        resolvedPaths[candidate] = basePath;
        break;
      }
    }
  }

  return resolvedPaths;
}
