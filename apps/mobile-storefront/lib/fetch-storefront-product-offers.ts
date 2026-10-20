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

interface ProductOfferRpcRow {
  compare_at_price?: number | null;
  condition?: string | null;
  condition_notes?: string | null;
  grade?: string | null;
  images?: unknown;
  offer_id?: unknown;
  price?: number | null;
  stock_quantity?: number | null;
}

/**
 * Active condition offers through the anon-executable get_product_offers
 * RPC. The nested product_offers table select its callers replace reads
 * empty for shoppers (staff-only SELECT policy), while this SECURITY
 * DEFINER RPC returns active rows only. Single-product RPC, so one call
 * per id in bounded batches of 10 (mirroring the web cart validator):
 * a large checkout-valid cart can name up to 200 distinct products and
 * one unbounded burst, multiplied by retries, would time out the
 * pre-checkout reprice. Same retry and fail-soft shape as the sibling
 * fetches.
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

  const results: { data: unknown; error: unknown; productId: string }[] = [];
  for (let index = 0; index < uniqueProductIds.length; index += 10) {
    const batch = await Promise.all(
      uniqueProductIds.slice(index, index + 10).map(async (productId) => {
        const { data, error } = await withSupabaseRetry(
          async () =>
            await supabase.rpc('get_product_offers', {
              p_product_id: productId,
            }),
          {
            maxRetries: 3,
            onRetry: (attempt, err) => {
              log.warn(`Product offers rpc retry ${attempt}: ${err.message}`);
            },
          }
        );
        return { data, error, productId };
      })
    );
    results.push(...batch);
  }

  const failed = results.find((result) => result.error);
  if (failed) {
    log.error('Failed to fetch storefront product offers', {
      error: failed.error,
      productIds: uniqueProductIds,
    });
    return null;
  }

  const offersByProductId: Record<
    string,
    StorefrontProductConditionOfferRow[]
  > = {};
  for (const result of results) {
    offersByProductId[result.productId] = (
      (result.data ?? []) as ProductOfferRpcRow[]
    ).flatMap((row) =>
      typeof row?.offer_id === 'string'
        ? [
            {
              compare_at_price: row.compare_at_price ?? null,
              condition: row.condition ?? null,
              condition_notes: row.condition_notes ?? null,
              grade: row.grade ?? null,
              id: row.offer_id,
              images: row.images,
              price: row.price ?? null,
              stock_quantity: row.stock_quantity ?? null,
            },
          ]
        : []
    );
  }

  return offersByProductId;
}
