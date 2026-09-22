import {
  getCachedCategoryPageData,
  getCachedCategoryPageGraphicsOptionsStrict,
} from '@/lib/cached-data';
import {
  getGamingLaptopGraphicsHub,
  getGraphicsOptionsForHub,
} from '@/lib/storefront-category/gaming-laptop-graphics-hubs';
import { resolveCategoryGraphicsFilters } from './resolve-category-graphics-filters';

interface LoadFilteredCategoryPageDataOptions {
  category: string;
  merchantId: string;
  productLimit: number;
  productOffset: number;
  rawGraphics: string | string[] | undefined;
  storeSlug: string;
  /**
   * Trusted callers (curated hub pages) pass facet-derived graphics values,
   * not raw query strings, so the untrusted-request cardinality cap is
   * lifted for them (allowlist intersection still applies).
   */
  trustedGraphics?: boolean;
  /**
   * Hub token minted by a hub-originated transition. Validated against the
   * hub's facet set: when every requested value belongs to the hub, the
   * untrusted-request cap is lifted for the transition too.
   */
  trustedHubSlug?: string;
}

function isTrustedHubSelection(
  graphicsOptions: string[],
  trustedHubSlug: string | undefined,
  rawGraphics: string | string[] | undefined
): boolean {
  if (!trustedHubSlug) return false;
  const hub = getGamingLaptopGraphicsHub(trustedHubSlug);
  if (!hub) return false;
  const requested = Array.isArray(rawGraphics)
    ? rawGraphics
    : rawGraphics
      ? [rawGraphics]
      : [];
  if (requested.length === 0) return false;
  const matching = new Set(getGraphicsOptionsForHub(graphicsOptions, hub));
  return requested.every((value) => matching.has(value.trim()));
}

function hasRequestedGraphics(
  rawGraphics: string | string[] | undefined
): boolean {
  if (Array.isArray(rawGraphics)) {
    return rawGraphics.some((value) => value.trim().length > 0);
  }

  return typeof rawGraphics === 'string' && rawGraphics.trim().length > 0;
}

export async function loadFilteredCategoryPageData({
  category,
  merchantId,
  productLimit,
  productOffset,
  rawGraphics,
  storeSlug,
  trustedGraphics = false,
  trustedHubSlug,
}: LoadFilteredCategoryPageDataOptions) {
  const initialDataPromise = getCachedCategoryPageData(
    merchantId,
    category,
    storeSlug,
    productOffset,
    productLimit
  );
  const graphicsOptionsPromise = getCachedCategoryPageGraphicsOptionsStrict(
    merchantId,
    category
  );

  const [initialData, graphicsResult] = await Promise.all([
    initialDataPromise,
    graphicsOptionsPromise.then(
      (options) => ({ ok: true as const, options }),
      () => ({ ok: false as const })
    ),
  ]);

  // A transient facet-read failure is not an empty facet. When the shopper
  // requested a graphics filter we cannot validate it, so fail closed with
  // the established unavailable flags instead of falling back to the
  // unfiltered catalog. Without a requested filter the unfiltered listing is
  // still valid, served with an empty facet and a failure signal.
  if (!graphicsResult.ok) {
    if (hasRequestedGraphics(rawGraphics)) {
      return {
        data: {
          ...initialData,
          products: [],
          productSlots: [],
          productCount: 0,
          productsQueryFailed: true,
          productIdsQueryFailed: true,
        },
        graphicsOptions: [],
        selectedGraphics: [],
        graphicsOptionsFailed: true,
      };
    }

    return {
      data: initialData,
      graphicsOptions: [],
      selectedGraphics: [],
      graphicsOptionsFailed: true,
    };
  }

  const graphicsOptions = graphicsResult.options;
  const selectedGraphics = resolveCategoryGraphicsFilters(
    rawGraphics,
    graphicsOptions,
    {
      trustedSource:
        trustedGraphics ||
        isTrustedHubSelection(graphicsOptions, trustedHubSlug, rawGraphics),
    }
  );
  const data =
    selectedGraphics.length > 0
      ? await getCachedCategoryPageData(
          merchantId,
          category,
          storeSlug,
          productOffset,
          productLimit,
          { graphics: selectedGraphics }
        )
      : initialData;

  return { data, graphicsOptions, selectedGraphics };
}
