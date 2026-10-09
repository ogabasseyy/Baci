import {
  hydrateRowsNeedingBaseInventory,
  hydrateRowsNeedingStorefrontVariants,
} from '@/hooks/product-hydration';
import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/types/product';
import { PRODUCT_SELECT } from './product-select';
import { transformProduct } from './product-transform';

const log = createLogger('ProductsBySlugs');

/**
 * Deterministically fetch active products by slug for a merchant, independent of
 * the newest-window paging. Mirrors `fetchProductsPage` (same `PRODUCT_SELECT`,
 * retry, variant hydration, transform) so the launch carousel always has its
 * pinned devices even when they fall outside the recent feed.
 */
export async function fetchProductsBySlugs(
  merchantId: string,
  slugs: readonly string[]
): Promise<Product[]> {
  if (slugs.length === 0) {
    return [];
  }

  const query = supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .in('slug', slugs as string[]);

  const result = await withSupabaseRetry(async () => await query, {
    maxRetries: 3,
    onRetry: (attempt, err) => {
      log.warn(`Retry ${attempt}: ${err.message}`);
    },
  });
  if (result.error) throw result.error;

  const hydratedRows = await hydrateRowsNeedingBaseInventory(
    await hydrateRowsNeedingStorefrontVariants(
      (result.data || []) as Record<string, unknown>[]
    )
  );
  return hydratedRows
    .map(transformProduct)
    .filter((product): product is Product => product !== null);
}
