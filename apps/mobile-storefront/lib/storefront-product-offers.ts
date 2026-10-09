import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { ProductRowWithId } from './storefront-product-variants';

const log = createLogger('StorefrontProductOffers');

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
 * per id; same retry and fail-soft shape as the sibling fetches.
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

  const results = await Promise.all(
    uniqueProductIds.map(async (productId) => {
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

export async function hydrateProductRowsWithConditionOffers<
  TRow extends ProductRowWithId,
>(rows: TRow[]) {
  const offersByProductId = await getStorefrontProductOffersByProductIds(
    rows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string')
  );

  if (offersByProductId === null) {
    return rows;
  }

  return rows.map((row) => {
    if (typeof row.id !== 'string') {
      return row;
    }

    return {
      ...row,
      offers: offersByProductId[row.id] ?? [],
    };
  });
}
