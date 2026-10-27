import { getCachedCategoryPageData } from '@/lib/cached-data';
import { normalizeProduct, type RawDbProduct } from '@/lib/normalize-product';

export interface PriceBandDestinationProduct {
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
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

/**
 * Loads the exact pool the price-band destination derives from
 * (getCachedCategoryPageData -> normalizeProduct), bounded so a stall
 * degrades to no band links instead of erroring the article.
 */
export async function loadPriceBandDestinationPoolSafely(args: {
  merchantId: string;
  merchantSlug: string;
  categorySlug: string;
}): Promise<PriceBandDestinationProduct[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const categoryData = await Promise.race([
      getCachedCategoryPageData(
        args.merchantId,
        args.categorySlug,
        args.merchantSlug
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('price band destination timeout')),
          3_000
        );
      }),
    ]);
    if (!categoryData || categoryData.isCollection) {
      return null;
    }
    if (
      categoryData.categoryQueryFailed ||
      categoryData.productsQueryFailed ||
      categoryData.productIdsQueryFailed
    ) {
      return null;
    }
    return ((categoryData.products ?? []) as unknown[])
      .filter(isRawDbProduct)
      .map((product) =>
        normalizeProduct(product, { preferredCategorySlug: args.categorySlug })
      )
      .map((product) => ({
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        price: product.price,
      }));
  } catch (error) {
    console.warn('Failed to load price band destination pool', {
      categorySlug: args.categorySlug,
      merchantId: args.merchantId,
      error,
    });
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
