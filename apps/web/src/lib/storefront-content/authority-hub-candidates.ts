import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import type { ResolvedEligibleCategoryHubDestinations } from './eligible-hub-destinations';

/** Relevance selects candidates; only destination inventory grants eligibility. */
export function buildAuthorityHubCandidates(
  categorySlug: string,
  brands: readonly string[],
  storeUrl: string
): ResolvedEligibleCategoryHubDestinations {
  const base = storeUrl.replace(/\/+$/, '');
  const entries = brandAuthorityTaxonomy
    .getEntries(categorySlug)
    .filter((entry) =>
      brands.some((brand) => brandAuthorityTaxonomy.matchesBrand(entry, brand))
    );
  return {
    brandHubs: entries.map((entry) => ({
      href: `${base}/${entry.categorySlug}/brands/${entry.brandKey}`,
      label: `Explore ${entry.displayName}`,
      category_slug: entry.categorySlug,
      brand_key: entry.brandKey,
    })),
    familyHubs: entries.flatMap((entry) =>
      modelFamilyAuthorityTaxonomy
        .getEntries(entry.categorySlug, entry.brandKey)
        .map((family) => ({
          href: `${base}/${entry.categorySlug}/brands/${entry.brandKey}/families/${family.familyKey}`,
          label: `Explore ${family.displayName}`,
          category_slug: entry.categorySlug,
          brand_key: entry.brandKey,
          family_key: family.familyKey,
        }))
    ),
  };
}
