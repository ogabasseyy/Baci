import { cacheLife, cacheTag } from 'next/cache';
import { buildCuratedCompareSlugSet } from './compare-indexability-policy';
import { getCachedCompareCategoryInventory } from './get-cached-compare-category-inventory';
import { getMaintainedCompareRouteManifest } from './get-maintained-compare-route-manifest';

/**
 * Locally caches the complete maintained product-comparison manifest for one
 * merchant/category/store snapshot. Product comparison URL segments are
 * deliberately excluded from its cache key.
 */
export async function getCachedMaintainedCompareRouteManifest(
  merchantId: string,
  categorySlug: string,
  storeSlug: string,
  storeUrl: string
): Promise<string[]> {
  'use cache';
  try {
    cacheLife('products');
    cacheTag(
      `products-${merchantId}`,
      `categories-${merchantId}`,
      `features-${merchantId}`,
      'merchants',
      `merchant-id-${merchantId}`,
      `merchant-${storeSlug}`
    );
  } catch {
    // Unit tests do not run with Next cacheComponents enabled.
  }

  const inventory = await getCachedCompareCategoryInventory(
    merchantId,
    categorySlug
  );

  if (inventory.isCollection) {
    return [];
  }

  const categoryName = inventory.fallbackName || categorySlug;
  const curatedSlugs = buildCuratedCompareSlugSet({
    storeUrl,
    categorySlug,
    categoryName,
    products: inventory.products,
  });

  return [
    ...getMaintainedCompareRouteManifest({
      storeUrl,
      categorySlug,
      categoryName,
      products: inventory.products,
      curatedSlugs,
    }),
  ];
}
