import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export type JumiaVariantPriceMapping = {
  id: string;
  jumia_sku: string;
  jumia_price: number | null;
};

type AppliedPriceUpdate = {
  mappingId: string;
  previousPrice: number | null;
};

/**
 * Best-effort rollback of per-variant local prices after a partial
 * failure. Restores each applied row to its previous price so the local
 * mappings never report a mixed set Jumia never received. Never throws:
 * rollback failures are logged and reported, preserving the original
 * error response.
 */
async function rollbackAppliedPriceUpdates(
  supabase: SupabaseClient,
  merchantId: string,
  appliedUpdates: readonly AppliedPriceUpdate[]
): Promise<string[]> {
  const rollbackErrors: string[] = [];
  for (const applied of appliedUpdates) {
    const { error } = await supabase
      .from('jumia_product_mappings')
      .update({
        jumia_price: applied.previousPrice,
        updated_at: new Date().toISOString(),
      })
      .eq('id', applied.mappingId)
      .eq('merchant_id', merchantId);
    if (error) {
      logger.error({
        message: 'Local per-variant price rollback failed',
        error,
        mappingId: applied.mappingId,
      });
      rollbackErrors.push(applied.mappingId);
    }
  }
  return rollbackErrors;
}

/**
 * Persists per-variant local prices atomically from the caller's point
 * of view: when any row write fails, previously written rows are rolled
 * back to their previous prices before reporting failure, so a retry
 * never sees a partial write the provider feed did not include.
 */
export async function applyJumiaVariantPriceUpdates(args: {
  supabase: SupabaseClient;
  merchantId: string;
  mappings: readonly JumiaVariantPriceMapping[];
  prices: Record<string, number>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const appliedUpdates: AppliedPriceUpdate[] = [];
  for (const mapping of args.mappings) {
    const price = args.prices[mapping.jumia_sku];
    if (price == null) continue;
    const { error: priceUpdateError } = await args.supabase
      .from('jumia_product_mappings')
      .update({ jumia_price: price, updated_at: new Date().toISOString() })
      .eq('id', mapping.id)
      .eq('merchant_id', args.merchantId);
    if (priceUpdateError) {
      logger.error({
        message: 'Local per-variant price update failed',
        error: priceUpdateError,
      });
      await rollbackAppliedPriceUpdates(
        args.supabase,
        args.merchantId,
        appliedUpdates
      );
      return { ok: false, error: 'Failed to update local mapping' };
    }
    appliedUpdates.push({
      mappingId: mapping.id,
      previousPrice: mapping.jumia_price,
    });
  }
  return { ok: true };
}
