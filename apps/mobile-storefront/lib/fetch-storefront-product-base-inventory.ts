import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('FetchStorefrontProductBaseInventory');

export interface StorefrontProductBaseInventoryRow {
  product_id: string;
  effective_policy?: string | null;
  available_units?: number | null;
}

/** Server-side array cap: the RPC rejects more than 500 ids per call. */
const BASE_INVENTORY_RPC_MAX_IDS = 500;

export async function getStorefrontProductBaseInventoryByProductIds(
  productIds: string[]
) {
  const uniqueProductIds = Array.from(
    new Set(productIds.filter((id): id is string => Boolean(id)))
  );

  if (uniqueProductIds.length === 0) {
    return {} as Record<string, StorefrontProductBaseInventoryRow>;
  }

  // One row per product at most, but the RPC caps arrays at 500 ids:
  // chunk sequentially (mirroring the offers fetch) so a 500+ product
  // cart still reprices instead of failing the whole lookup. Same
  // retry and fail-soft shape as the sibling fetches.
  const inventoryByProductId: Record<
    string,
    StorefrontProductBaseInventoryRow
  > = {};
  for (
    let index = 0;
    index < uniqueProductIds.length;
    index += BASE_INVENTORY_RPC_MAX_IDS
  ) {
    const chunk = uniqueProductIds.slice(
      index,
      index + BASE_INVENTORY_RPC_MAX_IDS
    );
    const { data, error } = await withSupabaseRetry(
      async () =>
        await supabase.rpc('get_storefront_product_base_inventory', {
          p_product_ids: chunk,
        }),
      {
        maxRetries: 3,
        onRetry: (attempt, err) => {
          log.warn(`Base inventory rpc retry ${attempt}: ${err.message}`);
        },
      }
    );

    if (error) {
      log.error('Failed to fetch storefront product base inventory', {
        error,
        productIds: uniqueProductIds,
      });
      return null;
    }

    for (const row of (data ?? []) as StorefrontProductBaseInventoryRow[]) {
      if (typeof row?.product_id === 'string') {
        inventoryByProductId[row.product_id] = row;
      }
    }
  }

  return inventoryByProductId;
}
