import { normalizeProduct, type RawDbProduct } from '@/lib/normalize-product';
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

  const authorityEntry = brandAuthorityTaxonomy
    .getEntries(input.categorySlug)
    .find((entry) => brandAuthorityTaxonomy.matchesBrand(entry, rawBrand));

  if (!authorityEntry) {
    return [];
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rawProducts = await Promise.race([
      getCachedBrandAuthorityProducts(
        input.merchantId,
        input.categorySlug,
        authorityEntry,
        { limit: null }
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error('PDP brand hub eligibility inventory timeout')),
          input.timeoutMs ?? PDP_BRAND_HUB_ELIGIBILITY_TIMEOUT_MS
        );
      }),
    ]);

    return rawProducts
      .filter(isRawDbProduct)
      .map((product) =>
        normalizeProduct(product, { preferredCategorySlug: input.categorySlug })
      )
      .filter(
        (product) =>
          brandAuthorityTaxonomy.matchesBrand(
            authorityEntry,
            product.brand ?? null
          ) && product.availability === 'InStock'
      )
      .map((product) => ({
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        price: product.price,
        availability: 'InStock' as const,
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
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
