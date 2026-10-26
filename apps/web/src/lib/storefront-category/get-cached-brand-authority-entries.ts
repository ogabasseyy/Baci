import { cacheLife, cacheTag } from 'next/cache';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { getCachedBrandAuthorityInventory } from '@/lib/storefront-category/get-cached-brand-authority-inventory';
import { resolveBrandAuthorityEligibility } from './authority-hub-eligibility';

async function getCachedBrandAuthorityEntriesRead(
  merchantId: string,
  categorySlug: string
) {
  'use cache';
  try {
    cacheLife('products');
    cacheTag('products', `products-${merchantId}`);
  } catch {
    // Unit tests run without Cache Components enabled.
  }

  const entries = brandAuthorityTaxonomy.getEntries(categorySlug);
  const counts = await Promise.all(
    entries.map(async (entry) => {
      const inventory = await getCachedBrandAuthorityInventory(
        merchantId,
        categorySlug,
        entry
      );
      const eligibility = resolveBrandAuthorityEligibility(
        inventory.products,
        categorySlug,
        entry
      );
      return {
        entry,
        eligible: eligibility.eligible,
        productCount: eligibility.productCount,
        productCountIsLowerBound: inventory.productCountIsLowerBound,
      };
    })
  );

  return counts.flatMap(
    ({ entry, eligible, productCount, productCountIsLowerBound }) =>
      eligible ? [{ ...entry, productCount, productCountIsLowerBound }] : []
  );
}

export async function getCachedBrandAuthorityEntries(
  merchantId: string,
  categorySlug: string
) {
  if (!brandAuthorityTaxonomy.supportsCategory(categorySlug)) {
    return [];
  }

  try {
    return await getCachedBrandAuthorityEntriesRead(merchantId, categorySlug);
  } catch (error) {
    console.warn('Failed to load category brand authority entries', {
      merchantId,
      categorySlug,
      error,
    });
    return [];
  }
}
