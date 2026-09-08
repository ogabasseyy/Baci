import { getCachedMaintainedCompareRouteManifest } from '@/lib/storefront-compare/get-cached-maintained-compare-route-manifest';

interface HasMaintainedProductCompareRouteInput {
  merchantId: string;
  merchantSlug: string;
  categorySlug: string;
  comparisonSlug: string;
  storeUrl: string;
}

export async function hasMaintainedProductCompareRoute({
  merchantId,
  merchantSlug,
  categorySlug,
  comparisonSlug,
  storeUrl,
}: HasMaintainedProductCompareRouteInput): Promise<boolean> {
  const manifest = await getCachedMaintainedCompareRouteManifest(
    merchantId,
    categorySlug,
    merchantSlug,
    storeUrl
  );

  return manifest.includes(comparisonSlug);
}
