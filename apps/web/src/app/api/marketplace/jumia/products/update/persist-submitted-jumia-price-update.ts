import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  applyJumiaVariantPriceUpdates,
  type JumiaVariantPriceMapping,
} from './apply-jumia-variant-price-updates';

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
 */
export async function persistSubmittedJumiaPriceUpdate(args: {
  supabase: SupabaseClient;
  merchantId: string;
  mappings: readonly JumiaVariantPriceMapping[];
  overrides: JumiaSubmittedPriceOverrides;
  submittedSkus: readonly string[];
  updatedAt: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    supabase,
    merchantId,
    mappings,
    overrides,
    submittedSkus,
    updatedAt,
  } = args;
  const submittedPriceUpdate: Record<string, unknown> = {
    updated_at: updatedAt,
  };
  if (Object.hasOwn(overrides, 'jumia_price')) {
    submittedPriceUpdate.jumia_price = overrides.jumia_price;
  }
  if (Object.hasOwn(overrides, 'jumia_sale_price')) {
    submittedPriceUpdate.jumia_sale_price = overrides.jumia_sale_price;
  }
  if (Object.hasOwn(overrides, 'jumia_sale_start')) {
    submittedPriceUpdate.jumia_sale_start = overrides.jumia_sale_start;
  }
  if (Object.hasOwn(overrides, 'jumia_sale_end')) {
    submittedPriceUpdate.jumia_sale_end = overrides.jumia_sale_end;
  }
  const submittedMappingIds = mappings
    .filter((mapping) => submittedSkus.includes(mapping.jumia_sku))
    .map((mapping) => mapping.id);
  if (
    Object.keys(submittedPriceUpdate).length > 1 &&
    submittedMappingIds.length > 0
  ) {
    // Optimistic guard: only overwrite rows still stamped with this
    // request's pre-push timestamp. A concurrent save lands a newer stamp,
    // so a shortfall means this feed was superseded and must reconcile
    // instead of regressing the newer local values.
    const { data: updatedRows, error: submittedPriceError } = await supabase
      .from('jumia_product_mappings')
      .update(submittedPriceUpdate)
      .in('id', submittedMappingIds)
      .eq('merchant_id', merchantId)
      .eq('updated_at', updatedAt)
      .select('id');
    if (submittedPriceError) {
      logger.error({
        message: 'Local submitted-price update failed',
        error: submittedPriceError,
      });
      return {
        ok: false,
        error: `Jumia accepted the price feed but the local sale details could not be saved. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
      };
    }
    if (!updatedRows || updatedRows.length < submittedMappingIds.length) {
      return {
        ok: false,
        error: `Another save updated this product while the Jumia feed was submitting. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
      };
    }
  }

  if (overrides.jumia_prices) {
    const submittedPrices = Object.fromEntries(
      Object.entries(overrides.jumia_prices).filter(([sku]) =>
        submittedSkus.includes(sku)
      )
    );
    const priceResult = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId,
      mappings,
      prices: submittedPrices,
      expectedUpdatedAt: updatedAt,
    });
    if (!priceResult.ok) {
      if (priceResult.code === '40001') {
        return {
          ok: false,
          error: `Another save updated this product while the Jumia feed was submitting. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
        };
      }
      return {
        ok: false,
        error: `Jumia accepted the price feed but the local variant prices could not be saved. ${ACCEPTED_FEED_RETRY_GUIDANCE}`,
      };
    }
  }

  return { ok: true };
}
