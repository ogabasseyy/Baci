import { authorityHubEligibility } from '@/lib/storefront-category/authority-hub-eligibility';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { loadBrandAuthorityInventorySafely } from '@/lib/storefront-category/load-brand-authority-inventory-safely';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import type { ResolvedEligibleCategoryHubDestinations } from './eligible-hub-destinations';

/**
 * Resolves taxonomy candidates through the same hydrated inventory contract
 * used by destination pages. Preview stock/counts never decide live links.
 */
export async function verifyEligibleHubsAgainstDestination(args: {
  merchantId: string;
  categorySlug: string;
  hubs: ResolvedEligibleCategoryHubDestinations;
}): Promise<ResolvedEligibleCategoryHubDestinations> {
  if (args.hubs.brandHubs.length === 0 && args.hubs.familyHubs.length === 0) {
    return { brandHubs: [], familyHubs: [] };
  }
  // Each bounded shared read includes active-category validation under the
  // same deadline as inventory and hydration. Do not start a separate
  // category lookup whose work could outlive the verifier.
  const brandHubs: ResolvedEligibleCategoryHubDestinations['brandHubs'] = [];
  const familyHubs: ResolvedEligibleCategoryHubDestinations['familyHubs'] = [];
  const inventoryProductsByBrand = new Map<string, Array<{ name: string }>>();

  const verified = await Promise.all(
    args.hubs.brandHubs.map(async (hub) => {
      if (!hub.brand_key) return null;
      const entry = brandAuthorityTaxonomy.getEntry(
        args.categorySlug,
        hub.brand_key
      );
      if (!entry) return null;
      const inventory = await loadBrandAuthorityInventorySafely({
        merchantId: args.merchantId,
        categorySlug: args.categorySlug,
        entry,
      });
      if (!inventory) return null;
      const eligibility =
        authorityHubEligibility.resolveBrandAuthorityEligibility(
          inventory.products,
          args.categorySlug,
          entry
        );
      if (!eligibility.eligible) return null;
      return {
        hub: { ...hub, product_count: eligibility.productCount },
        products: eligibility.products,
      };
    })
  );
  for (const result of verified) {
    if (!result?.hub.brand_key) continue;
    brandHubs.push(result.hub);
    inventoryProductsByBrand.set(result.hub.brand_key, result.products);
  }

  for (const hub of args.hubs.familyHubs) {
    if (!hub.brand_key || !hub.family_key) continue;
    const products = inventoryProductsByBrand.get(hub.brand_key);
    if (!products) continue;
    const familyEntry = modelFamilyAuthorityTaxonomy.getEntry(
      args.categorySlug,
      hub.brand_key,
      hub.family_key
    );
    if (!familyEntry) continue;
    const eligibility =
      authorityHubEligibility.resolveFamilyAuthorityEligibility(
        products,
        familyEntry
      );
    if (eligibility.eligible) {
      familyHubs.push({ ...hub, product_count: eligibility.productCount });
    }
  }

  return { brandHubs, familyHubs };
}
