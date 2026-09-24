import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export type JumiaVariantPriceMapping = {
  id: string;
  jumia_sku: string;
  jumia_price: number | null;
};

/**
 * Persists per-variant local prices in a single statement, so the write
 * is all-or-nothing: a failure leaves every row untouched instead of
 * committing a partial set the provider feed never received. No
 * compensating rollback is needed, which also removes the risk of a
 * rollback overwriting a concurrent newer price with a stale snapshot.
 *
 * Row ids come from merchant-scoped mappings and each payload row carries
 * the merchant id, so RLS merchant scoping applies to the upsert.
 */
export async function applyJumiaVariantPriceUpdates(args: {
  supabase: SupabaseClient;
  merchantId: string;
  mappings: readonly JumiaVariantPriceMapping[];
  prices: Record<string, number>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const updatedAt = new Date().toISOString();
  const rows = [];
  for (const mapping of args.mappings) {
    const price = args.prices[mapping.jumia_sku];
    if (price == null) continue;
    rows.push({
      id: mapping.id,
      merchant_id: args.merchantId,
      jumia_price: price,
      updated_at: updatedAt,
    });
  }
  if (rows.length === 0) return { ok: true };

  const { error: priceUpdateError } = await args.supabase
    .from('jumia_product_mappings')
    .upsert(rows, { onConflict: 'id' });
  if (priceUpdateError) {
    logger.error({
      message: 'Local per-variant price update failed',
      error: priceUpdateError,
    });
    return { ok: false, error: 'Failed to update local mapping' };
  }
  return { ok: true };
}
