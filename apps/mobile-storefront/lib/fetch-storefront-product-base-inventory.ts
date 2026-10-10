import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('FetchStorefrontProductBaseInventory');

export interface StorefrontProductBaseInventoryRow {
  product_id: string;
  effective_policy?: string | null;
  available_units?: number | null;
}

export async function getStorefrontProductBaseInventoryByProductIds(
  productIds: string[]
) {
  const uniqueProductIds = Array.from(
    new Set(productIds.filter((id): id is string => Boolean(id)))
  );

  if (uniqueProductIds.length === 0) {
    return {} as Record<string, StorefrontProductBaseInventoryRow>;
  }

  // One row per product at most: no pagination, but the same retry and
  // fail-soft shape as the variants fetch so callers keep their rows.
  const { data, error } = await withSupabaseRetry(
    async () =>
      await supabase.rpc('get_storefront_product_base_inventory', {
        p_product_ids: uniqueProductIds,
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

  const inventoryByProductId: Record<
    string,
    StorefrontProductBaseInventoryRow
  > = {};

  for (const row of (data ?? []) as StorefrontProductBaseInventoryRow[]) {
    if (typeof row?.product_id === 'string') {
      inventoryByProductId[row.product_id] = row;
    }
  }

  return inventoryByProductId;
}
