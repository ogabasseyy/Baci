import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export type JumiaVariantPriceMapping = {
  id: string;
  jumia_sku: string;
  jumia_price: number | null;
  update_token: string | null;
};

export interface JumiaSubmittedPriceOverrides {
  jumia_price?: number;
  jumia_sale_price?: number | null;
  jumia_sale_start?: string | null;
  jumia_sale_end?: string | null;
  jumia_prices?: Record<string, number>;
}

const ACCEPTED_FEED_RETRY_GUIDANCE =
  'Refresh before retrying to avoid a duplicate submission.';

/**
 * Persists price/sale overrides only for SKUs the Jumia feed accepted. A
 * per-SKU `jumia_prices` subset must not stamp sale metadata on omitted
 * variants, and a failed feed must persist nothing.
 *
 * The scalar sale write and the per-variant price write commit in a single
 * transactional RPC: every row must still carry its load-time baseline
 * token, and any miss raises 40001 and rolls back every row, so a
 * superseded save can never leave a product half-claimed.
 */
export async function persistSubmittedJumiaPriceUpdate(args: {
  supabase: SupabaseClient;
  merchantId: string;
  mappings: readonly JumiaVariantPriceMapping[];
  overrides: JumiaSubmittedPriceOverrides;
  submittedSkus: readonly string[];
  updatedAt: string;
  updateToken: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    supabase,
    merchantId,
    mappings,
    overrides,
    submittedSkus,
    updatedAt,
    updateToken,
  } = args;
  const submittedMappings = mappings.filter((mapping) =>
    submittedSkus.includes(mapping.jumia_sku)
  );
  const scalarValues: Record<string, unknown> = {};
  if (Object.hasOwn(overrides, 'jumia_price')) {
    scalarValues.jumia_price = overrides.jumia_price;
  }
  if (Object.hasOwn(overrides, 'jumia_sale_price')) {
    scalarValues.jumia_sale_price = overrides.jumia_sale_price;
  }
  if (Object.hasOwn(overrides, 'jumia_sale_start')) {
    scalarValues.jumia_sale_start = overrides.jumia_sale_start;
  }
  if (Object.hasOwn(overrides, 'jumia_sale_end')) {
    scalarValues.jumia_sale_end = overrides.jumia_sale_end;
  }
  const scalarTargets =
    Object.keys(scalarValues).length > 0 && submittedMappings.length > 0
      ? submittedMappings.map((mapping) => ({
          id: mapping.id,
          expected_token: mapping.update_token,
        }))
      : [];
  if (scalarTargets.length > 0) {
    scalarValues.updated_at = updatedAt;
  }
  const submittedPrices = Object.fromEntries(
    Object.entries(overrides.jumia_prices ?? {}).filter(([sku]) =>
      submittedSkus.includes(sku)
    )
  );
  const priceUpdates = [];
  for (const mapping of mappings) {
    const price = submittedPrices[mapping.jumia_sku];
    if (price == null) continue;
    priceUpdates.push({
      id: mapping.id,
      price,
      expected_token: mapping.update_token,
    });
  }
  if (scalarTargets.length === 0 && priceUpdates.length === 0) {
    return { ok: true };
  }

  const { error: submittedPriceError } = await supabase.rpc(
    'apply_jumia_submitted_price_updates',
    {
      p_merchant_id: merchantId,
      p_scalar: { values: scalarValues, targets: scalarTargets },
      p_updates: priceUpdates,
      p_update_token: updateToken,
    }
  );
  if (submittedPriceError) {
    logger.error({
      message: 'Local submitted-price update failed',
      error: submittedPriceError,
    });
    if (submittedPriceError.code === '40001') {
      return {
        ok: false,
        error: `Another save updated this product while the Jumia feed was submitting. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
      };
    }
    return {
      ok: false,
      error: `Jumia accepted the price feed but the local details could not be saved. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
    };
  }

  return { ok: true };
}
