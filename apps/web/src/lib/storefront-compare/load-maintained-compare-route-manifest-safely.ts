import { getCachedMaintainedCompareRouteManifest } from './get-cached-maintained-compare-route-manifest';

/**
 * Optional-content fallback around the maintained compare-route manifest.
 * Product compare links are supplemental SEO content — a transient manifest
 * failure degrades to no approved pairs (no product compare link) instead of
 * erroring the page or emitting an unmaintained route.
 */
export async function loadMaintainedCompareRouteManifestSafely(args: {
  merchantId: string;
  categorySlug: string;
  storeSlug: string;
  storeUrl: string;
}): Promise<ReadonlySet<string>> {
  try {
    const slugs = await getCachedMaintainedCompareRouteManifest(
      args.merchantId,
      args.categorySlug,
      args.storeSlug,
      args.storeUrl
    );
    return new Set(slugs);
  } catch (error) {
    console.warn('Failed to load maintained compare route manifest', {
      categorySlug: args.categorySlug,
      merchantId: args.merchantId,
      error,
    });
    return new Set();
  }
}
