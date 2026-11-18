import { getEffectiveProductStock } from '@/lib/product-stock';
import { authorityHubEligibility } from '@/lib/storefront-category/authority-hub-eligibility';
import { isExpectedBrandAuthorityInventoryRejection } from '@/lib/storefront-category/brand-authority-inventory-rejection';
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
      authorityHubEligibility.resolveAvailableBrandAuthorityEligibility(
        inventory.products,
        entry
      );
    if (!eligibility.eligible) return [];
    return eligibility.products.map((product) => ({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      condition:
        typeof product.condition === 'string' ? product.condition : null,
      price: product.price,
      availability:
        product.availability === 'InStock' ||
        product.availability === 'OutOfStock'
          ? product.availability
          : null,
      stock: typeof product.stock === 'number' ? product.stock : null,
      stock_quantity: getEffectiveProductStock(product),
      manage_stock: product.manage_stock ?? null,
      is_parent: product.is_parent ?? null,
      parent_product_id: product.parent_product_id ?? null,
      category_slug: input.categorySlug,
      product_key_specs:
        product.product_key_specs &&
        typeof product.product_key_specs === 'object' &&
        !Array.isArray(product.product_key_specs)
          ? (product.product_key_specs as Record<string, unknown>)
          : null,
    }));
  } catch (error) {
    if (!isExpectedBrandAuthorityInventoryRejection(error)) {
      console.warn('Failed to load PDP brand hub eligibility inventory', {
        merchantId: input.merchantId,
        categorySlug: input.categorySlug,
        productBrand: rawBrand,
        error,
      });
    }
    return [];
  }
}
