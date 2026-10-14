import { buildOfferResolutionMap } from '@baci/shared/lib';
import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('FetchStorefrontProductOffers');

export interface StorefrontProductConditionOfferRow {
  compare_at_price?: number | null;
  condition?: string | null;
  condition_notes?: string | null;
  grade?: string | null;
  id: string;
  images?: unknown;
  price?: number | null;
  stock_quantity?: number | null;
}

/**
 * Active condition offers through the single offer-resolution
 * authority (anon-executable, active rows only). One batched call for
 * every id — no per-product fan-out. Prices read the live basis and
 * quantities the allocatable stock (policy-capped,
 * parent-inherited): exactly what checkout enforces. Unbounded rows
 * keep a null quantity (purchasable with no finite count). Same retry
 * and fail-soft shape as the sibling fetches: null on failure so
 * callers skip offer lines instead of corrupting prices.
 */
export async function getStorefrontProductOffersByProductIds(
  productIds: string[]
) {
  const uniqueProductIds = Array.from(
    new Set(productIds.filter((id): id is string => Boolean(id)))
  );

  if (uniqueProductIds.length === 0) {
    return {} as Record<string, StorefrontProductConditionOfferRow[]>;
  }

  const { data, error } = await withSupabaseRetry(
    async () =>
      await supabase.rpc('get_storefront_offer_resolution', {
        p_merchant_id: null,
        p_product_ids: uniqueProductIds,
      }),
    {
      maxRetries: 3,
      onRetry: (attempt, err) => {
        log.warn(`Product offers rpc retry ${attempt}: ${err.message}`);
      },
    }
  );

  if (error) {
    log.error('Failed to fetch storefront product offers', {
      error,
      productIds: uniqueProductIds,
    });
    return null;
  }

  const offersByProductId: Record<
    string,
    StorefrontProductConditionOfferRow[]
  > = {};
  for (const productId of uniqueProductIds) {
    offersByProductId[productId] = [];
  }
  for (const resolution of buildOfferResolutionMap(data).values()) {
    offersByProductId[resolution.productId]?.push({
      compare_at_price: resolution.compareAtPrice ?? null,
      condition: resolution.condition,
      condition_notes: resolution.conditionNotes ?? null,
      grade: resolution.grade ?? null,
      id: resolution.offerId,
      images: resolution.images,
      price: resolution.priceBasis,
      stock_quantity: resolution.allocatableStock,
    });
  }

  return offersByProductId;
}
