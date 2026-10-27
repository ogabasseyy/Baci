import { authorityHubEligibility } from '@/lib/storefront-category/authority-hub-eligibility';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import {
  getCachedBrandAuthorityInventory,
  OPTIONAL_AUTHORITY_INVENTORY_MAX_PRODUCTS,
} from '@/lib/storefront-category/get-cached-brand-authority-inventory';
import type { EligibleHubProductInput } from '@/lib/storefront-content/eligible-hub-destinations';

export interface LoadPdpBrandHubEligibilityInventorySafelyInput {
  merchantId: string;
  categorySlug: string;
  productBrand: string | null | undefined;
  timeoutMs?: number;
}

export const PDP_BRAND_HUB_ELIGIBILITY_BELOW_FOLD_TIMEOUT_MS = 1_000;

/** Reuse the destination's scope, hydration and eligibility; never warm a scan after timeout. */
export async function loadPdpBrandHubEligibilityInventorySafely(
  input: LoadPdpBrandHubEligibilityInventorySafelyInput
): Promise<EligibleHubProductInput[]> {
  const rawBrand = input.productBrand?.trim() ?? '';
  if (!rawBrand) return [];
  try {
    const entry = brandAuthorityTaxonomy
      .getEntries(input.categorySlug)
      .find((candidate) =>
        brandAuthorityTaxonomy.matchesBrand(candidate, rawBrand)
      );
    if (!entry) return [];
    const inventory = await getCachedBrandAuthorityInventory(
      input.merchantId,
      input.categorySlug,
      entry,
      {
        maxProducts: OPTIONAL_AUTHORITY_INVENTORY_MAX_PRODUCTS,
        timeoutMs:
          input.timeoutMs ?? PDP_BRAND_HUB_ELIGIBILITY_BELOW_FOLD_TIMEOUT_MS,
      }
    );
    const eligibility =
      authorityHubEligibility.resolveBrandAuthorityEligibility(
        inventory.products,
        input.categorySlug,
        entry
      );
    if (!eligibility.eligible) return [];
    return eligibility.products.map((product) => ({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      price: product.price,
      availability: product.availability,
      stock: product.stock,
      category_slug: input.categorySlug,
      product_key_specs: product.product_key_specs ?? null,
    }));
  } catch (error) {
    console.warn('Failed to load PDP brand hub eligibility inventory', {
      merchantId: input.merchantId,
      categorySlug: input.categorySlug,
      productBrand: rawBrand,
      error,
    });
    return [];
  }
}
