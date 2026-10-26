import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { loadBrandAuthorityInventorySafely } from '@/lib/storefront-category/load-brand-authority-inventory-safely';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import type { ResolvedEligibleCategoryHubDestinations } from './eligible-hub-destinations';

/**
 * Re-checks resolver hubs against the destination pages' own hydrated
 * inventory. The semantic pool counts raw stock columns, while brand/family
 * pages count hydrated public availability, so a hub is only kept when the
 * destination loader's inventory meets the same minimums.
 */
export async function verifyEligibleHubsAgainstDestination(args: {
  merchantId: string;
  categorySlug: string;
  hubs: ResolvedEligibleCategoryHubDestinations;
}): Promise<ResolvedEligibleCategoryHubDestinations> {
  const brandHubs: ResolvedEligibleCategoryHubDestinations['brandHubs'] = [];
  const familyHubs: ResolvedEligibleCategoryHubDestinations['familyHubs'] = [];
  const inventoryNamesByBrand = new Map<string, string[]>();

  for (const hub of args.hubs.brandHubs) {
    if (!hub.brand_key) continue;
    const entry = brandAuthorityTaxonomy.getEntry(
      args.categorySlug,
      hub.brand_key
    );
    if (!entry) continue;
    const inventory = await loadBrandAuthorityInventorySafely({
      merchantId: args.merchantId,
      categorySlug: args.categorySlug,
      entry,
    });
    if (!inventory || inventory.productCount < entry.minimumProducts) {
      continue;
    }
    brandHubs.push(hub);
    inventoryNamesByBrand.set(
      hub.brand_key,
      inventory.products.map((product) => product.name)
    );
  }

  for (const hub of args.hubs.familyHubs) {
    if (!hub.brand_key || !hub.family_key) continue;
    const names = inventoryNamesByBrand.get(hub.brand_key);
    if (!names) continue;
    const familyEntry = modelFamilyAuthorityTaxonomy.getEntry(
      args.categorySlug,
      hub.brand_key,
      hub.family_key
    );
    if (!familyEntry) continue;
    const count = names.filter((name) =>
      modelFamilyAuthorityTaxonomy.matchesProduct(familyEntry, name)
    ).length;
    if (count >= familyEntry.minimumProducts) {
      familyHubs.push(hub);
    }
  }

  return { brandHubs, familyHubs };
}
