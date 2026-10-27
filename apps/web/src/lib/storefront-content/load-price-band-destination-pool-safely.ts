import {
  getCachedPriceBandDestinationProjection,
  type PriceBandDestinationProduct,
} from './get-cached-price-band-destination-projection';

export type { PriceBandDestinationProduct } from './get-cached-price-band-destination-projection';

/** Optional links fail closed; the reader bounds both work and transport. */
export async function loadPriceBandDestinationPoolSafely(args: {
  merchantId: string;
  merchantSlug: string;
  categorySlug: string;
}): Promise<PriceBandDestinationProduct[] | null> {
  try {
    return await getCachedPriceBandDestinationProjection(
      args.merchantId,
      args.categorySlug
    );
  } catch (error) {
    console.warn('Failed to load price band destination pool', {
      categorySlug: args.categorySlug,
      merchantId: args.merchantId,
      error,
    });
    return null;
  }
}
