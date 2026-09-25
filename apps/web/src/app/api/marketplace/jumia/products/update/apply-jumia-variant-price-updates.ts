import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export type JumiaVariantPriceMapping = {
  id: string;
  jumia_sku: string;
  jumia_price: number | null;
};

/**
 * Persists per-variant local prices atomically through a single RPC: the
 * database updates every row in one transaction and fails closed when any
 * target is missing, so a failure leaves all rows untouched instead of
 * committing a partial set the provider feed never received.
 *
 * A partial-row upsert cannot provide this: PostgreSQL validates the
 * candidate rows' NOT NULL columns before resolving the id conflict, so
 * omitting columns like product_id would fail every call.
 */
export async function applyJumiaVariantPriceUpdates(args: {
  supabase: SupabaseClient;
  merchantId: string;
  mappings: readonly JumiaVariantPriceMapping[];
  prices: Record<string, number>;
  expectedUpdateToken: string;
}): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const updates = [];
  for (const mapping of args.mappings) {
    const price = args.prices[mapping.jumia_sku];
    if (price == null) continue;
    updates.push({ id: mapping.id, price });
  }
  if (updates.length === 0) return { ok: true };

  const { error: priceUpdateError } = await args.supabase.rpc(
    'apply_jumia_variant_price_updates',
    {
      p_merchant_id: args.merchantId,
      p_updates: updates,
      p_expected_update_token: args.expectedUpdateToken,
    }
  );
  if (priceUpdateError) {
    logger.error({
      message: 'Local per-variant price update failed',
      error: priceUpdateError,
    });
    return {
      ok: false,
      error: 'Failed to update local mapping',
      code: priceUpdateError.code,
    };
  }
  return { ok: true };
}
