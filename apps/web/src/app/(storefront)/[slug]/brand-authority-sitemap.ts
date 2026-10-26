import type { MetadataRoute } from 'next';
import { brandAuthorityPublicData } from '@/lib/storefront-category/brand-authority-public-data';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { getCachedBrandAuthorityInventory } from '@/lib/storefront-category/get-cached-brand-authority-inventory';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import { isStorefrontSitemapPublished } from '@/lib/storefront-seo/is-storefront-sitemap-published';
import type { StorefrontSitemapContext } from './sitemap-data';

export async function getBrandAuthoritySitemapEntries({
  merchant,
  storeUrl,
}: StorefrontSitemapContext): Promise<MetadataRoute.Sitemap> {
  if (!isStorefrontSitemapPublished(merchant)) {
    return [];
  }

  const eligibleCategories = await Promise.all(
    brandAuthorityTaxonomy
      .getSupportedCategories()
      .map(async (categorySlug) => {
        try {
          const categoryData = await brandAuthorityPublicData.getCategory(
            merchant.id,
            categorySlug
          );
          return categoryData ? categorySlug : null;
        } catch (error) {
          console.warn('Failed to load brand authority sitemap category', {
            merchantId: merchant.id,
            categorySlug,
            error,
          });
          return null;
        }
      })
  );
  const categoryEntries = await Promise.all(
    eligibleCategories.flatMap((categorySlug) =>
      categorySlug === null
        ? []
        : brandAuthorityTaxonomy.getEntries(categorySlug).map(async (entry) => {
            try {
              const inventory = await getCachedBrandAuthorityInventory(
                merchant.id,
                categorySlug,
                entry
              );
              if (inventory.productCount < entry.minimumProducts) {
                return [];
              }
              const brandEntry = {
                url: `${storeUrl}/${entry.categorySlug}/brands/${entry.brandKey}`,
                lastModified: inventory.latestUpdatedAt
                  ? new Date(inventory.latestUpdatedAt)
                  : undefined,
                changeFrequency: 'daily' as const,
                priority: 0.7,
              };
              const familyEntries = modelFamilyAuthorityTaxonomy
                .getEntries(categorySlug, entry.brandKey)
                .flatMap((family) => {
                  const matchingProducts = (inventory.products ?? []).filter(
                    (product) =>
                      modelFamilyAuthorityTaxonomy.matchesProduct(
                        family,
                        product.name
                      )
                  );
                  if (matchingProducts.length < family.minimumProducts) {
                    return [];
                  }
                  return [
                    {
                      url: `${brandEntry.url}/families/${family.familyKey}`,
                      lastModified: brandEntry.lastModified,
                      changeFrequency: 'daily' as const,
                      priority: 0.65,
                    },
                  ];
                });
              return [brandEntry, ...familyEntries];
            } catch (error) {
              console.warn('Failed to load brand authority sitemap entry', {
                merchantId: merchant.id,
                categorySlug,
                brandKey: entry.brandKey,
                error,
              });
              return [];
            }
          })
    )
  );
  return categoryEntries.flat();
}
