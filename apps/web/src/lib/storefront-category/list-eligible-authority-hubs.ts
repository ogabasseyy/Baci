import { authorityHubEligibility } from '@/lib/storefront-category/authority-hub-eligibility';
import { brandAuthorityPublicData } from '@/lib/storefront-category/brand-authority-public-data';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { getCachedBrandAuthorityInventory } from '@/lib/storefront-category/get-cached-brand-authority-inventory';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';

export interface EligibleAuthorityHub {
  categorySlug: string;
  brandKey: string;
  familyKeys: string[];
  latestUpdatedAt: string | null;
}

/**
 * Lists a merchant's indexable brand authority hubs and their eligible model
 * families, using the same eligibility rules the hub pages render with. Shared
 * by the brand-authority sitemap and the hub routes' `generateStaticParams`,
 * so the URLs we advertise and the URLs we prerender cannot drift apart.
 * A category or brand whose lookup fails is skipped (and logged) rather than
 * failing the whole listing.
 */
export async function listEligibleAuthorityHubs(
  merchantId: string
): Promise<EligibleAuthorityHub[]> {
  const eligibleCategories = await Promise.all(
    brandAuthorityTaxonomy
      .getSupportedCategories()
      .map(async (categorySlug) => {
        try {
          const categoryData = await brandAuthorityPublicData.getCategory(
            merchantId,
            categorySlug
          );
          return categoryData ? categorySlug : null;
        } catch (error) {
          console.warn('Failed to load brand authority hub category', {
            merchantId,
            categorySlug,
            error,
          });
          return null;
        }
      })
  );

  const hubs = await Promise.all(
    eligibleCategories.flatMap((categorySlug) =>
      categorySlug === null
        ? []
        : brandAuthorityTaxonomy
            .getEntries(categorySlug)
            .map(async (entry): Promise<EligibleAuthorityHub[]> => {
              try {
                const inventory = await getCachedBrandAuthorityInventory(
                  merchantId,
                  categorySlug,
                  entry
                );
                const eligibility =
                  authorityHubEligibility.resolveBrandAuthorityEligibility(
                    inventory.products ?? [],
                    categorySlug,
                    entry
                  );
                if (!eligibility.eligible) {
                  return [];
                }
                const familyKeys = modelFamilyAuthorityTaxonomy
                  .getEntries(categorySlug, entry.brandKey)
                  .filter(
                    (family) =>
                      authorityHubEligibility.resolveFamilyAuthorityEligibility(
                        eligibility.products,
                        family
                      ).eligible
                  )
                  .map((family) => family.familyKey);
                return [
                  {
                    categorySlug: entry.categorySlug,
                    brandKey: entry.brandKey,
                    familyKeys,
                    latestUpdatedAt: inventory.latestUpdatedAt ?? null,
                  },
                ];
              } catch (error) {
                console.warn('Failed to load brand authority hub', {
                  merchantId,
                  categorySlug,
                  brandKey: entry.brandKey,
                  error,
                });
                return [];
              }
            })
    )
  );

  return hubs.flat();
}
