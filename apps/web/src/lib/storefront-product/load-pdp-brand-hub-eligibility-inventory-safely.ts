import { normalizeProduct, type RawDbProduct } from '@/lib/normalize-product';
import { brandAuthorityPublicData } from '@/lib/storefront-category/brand-authority-public-data';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { getCachedBrandAuthorityProducts } from '@/lib/storefront-category/get-cached-brand-authority-products';
import type { EligibleHubProductInput } from '@/lib/storefront-content/eligible-hub-destinations';

export interface LoadPdpBrandHubEligibilityInventorySafelyInput {
  merchantId: string;
  categorySlug: string;
  productBrand: string | null | undefined;
  timeoutMs?: number;
}

const PDP_BRAND_HUB_ELIGIBILITY_TIMEOUT_MS = 3_000;

/**
 * PDP below-fold callers pass this tighter budget: hub links are optional,
 * fail-closed enrichment, so the scan may add at most this much latency to
 * deferred semantic rendering. The raced-away scan still completes
 * server-side and warms the destination cache for later requests.
 */
export const PDP_BRAND_HUB_ELIGIBILITY_BELOW_FOLD_TIMEOUT_MS = 1_000;

function coerceStockQuantity(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRawDbProduct(value: unknown): value is RawDbProduct {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'name' in value &&
      'price' in value
  );
}

export async function loadPdpBrandHubEligibilityInventorySafely(
  input: LoadPdpBrandHubEligibilityInventorySafelyInput
): Promise<EligibleHubProductInput[]> {
  const rawBrand = input.productBrand?.trim() ?? '';
  if (!rawBrand) {
    return [];
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const authorityEntry = brandAuthorityTaxonomy
      .getEntries(input.categorySlug)
      .find((entry) => brandAuthorityTaxonomy.matchesBrand(entry, rawBrand));

    if (!authorityEntry) {
      return [];
    }
    const [categoryData, rawProducts] = await Promise.race([
      Promise.all([
        brandAuthorityPublicData.getCategory(
          input.merchantId,
          input.categorySlug
        ),
        getCachedBrandAuthorityProducts(
          input.merchantId,
          input.categorySlug,
          authorityEntry,
          { limit: null }
        ),
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error('PDP brand hub eligibility inventory timeout')),
          input.timeoutMs ?? PDP_BRAND_HUB_ELIGIBILITY_TIMEOUT_MS
        );
      }),
    ]);

    if (!categoryData) {
      return [];
    }

    // Carry the raw parity fields (manage_stock, stock_quantity, is_parent,
    // parent_product_id) through alongside the normalized row: the
    // eligibility resolver's destination-parity guards (variant exclusion,
    // explicitly-managed stock) can only execute on inputs that still carry
    // them, so an upstream inventory change that loosens its own filtering
    // cannot silently start counting variants or unknown-stock rows here.
    return rawProducts
      .filter(isRawDbProduct)
      .map((rawProduct) => ({
        rawProduct,
        product: normalizeProduct(rawProduct, {
          preferredCategorySlug: input.categorySlug,
        }),
      }))
      .filter(
        ({ product }) =>
          brandAuthorityTaxonomy.matchesBrand(
            authorityEntry,
            product.brand ?? null
          ) && product.availability === 'InStock'
      )
      .map(({ rawProduct, product }) => ({
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        price: product.price,
        availability: 'InStock' as const,
        stock: product.stock,
        stock_quantity: coerceStockQuantity(rawProduct.stock_quantity),
        manage_stock:
          typeof rawProduct.manage_stock === 'boolean'
            ? rawProduct.manage_stock
            : null,
        is_parent:
          typeof rawProduct.is_parent === 'boolean'
            ? rawProduct.is_parent
            : null,
        parent_product_id:
          typeof rawProduct.parent_product_id === 'string'
            ? rawProduct.parent_product_id
            : null,
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
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
